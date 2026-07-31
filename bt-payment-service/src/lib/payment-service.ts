import type { BookingClient } from './booking-client.js'
import type { PaymentStore, PaymentMode, PayoutPayee } from './payment-store.js'
import { PaymentError } from './errors.js'
import { emitTripEconomics } from './fleet-emit.js'
import type { AuthenticatedUser } from '../plugins/auth.js'

// -----------------------------------------------------------
// PaymentService — cash-recorded settlement (NO escrow, NO Razorpay).
// Records a direct/UPI/cash settlement against a COMPLETED booking,
// records the driver payout, and asks booking-service to run
// completed → paid. Fully idempotent + self-healing on booking_id:
// a retried settle never double-records and heals a partial (payment
// recorded but the paid-flip lost). Deps are injected for verification.
// -----------------------------------------------------------

export type PaymentDeps = {
  booking: BookingClient
  store: PaymentStore
  logger?: { warn(obj: unknown, msg: string): void }
}

export type SettleArgs = {
  bookingId: string
  amount: number
  mode: PaymentMode
  reference: string | null
}

// resolvePayee — the payout follows the BID, not the steering wheel (Q15).
// A fleet-won booking still carries driver_id (the assigned driver of record
// for tracking/POD), but that driver is the fleet's employee and is paid by
// the fleet, so fleet_owner_id wins whenever it is set. Returns null when the
// booking names no bidder at all; callers decide whether that is fatal.
export function resolvePayee(booking: { driver_id: string | null; fleet_owner_id?: string | null }): PayoutPayee | null {
  if (booking.fleet_owner_id) {
    return { payee_type: 'fleet_owner', fleet_owner_id: booking.fleet_owner_id, driver_id: null }
  }
  if (booking.driver_id) {
    return { payee_type: 'driver', driver_id: booking.driver_id, fleet_owner_id: null }
  }
  return null
}

export async function settle(args: SettleArgs, actor: AuthenticatedUser, bearer: string, deps: PaymentDeps) {
  // Only ops/admin or the paying shipper may record a settlement; never a driver.
  if (actor.role !== 'admin' && actor.role !== 'shipper') {
    throw new PaymentError('Only an authorized actor (ops/admin or the shipper) can record a settlement', 'FORBIDDEN', 403)
  }

  // Read the booking with the actor's JWT — booking-service also enforces
  // shipper-ownership here (a shipper reading someone else's booking → 403).
  const booking = await deps.booking.getBooking(args.bookingId, bearer)
  const existing = await deps.store.getPayment(args.bookingId)

  // Idempotent full-retry: already settled + already flipped to paid.
  if (booking.status === 'paid' && existing) {
    const payout = await deps.store.getPayout(args.bookingId)
    return { booking_id: args.bookingId, status: 'paid', already_settled: true, payment: existing, payout }
  }

  if (booking.status !== 'completed') {
    throw new PaymentError(
      `Settlement can only be recorded for a 'completed' trip (booking is '${booking.status}')`,
      'INVALID_STATE',
      409,
    )
  }

  // Record the money (hard write — must persist). Skip if already recorded
  // (idempotent) and fall through to healing the paid-flip below.
  if (!existing) {
    // Resolved BEFORE the payment insert: a booking with no payee cannot be
    // paid out, and migration 016's CHECK would reject the payout row anyway —
    // better to refuse up front than to record money we cannot disburse.
    const payee = resolvePayee(booking)
    if (!payee) {
      throw new PaymentError('Booking has no payee (neither a driver nor a fleet owner)', 'INVALID_STATE', 409)
    }

    // ORDER MATTERS: payout FIRST, payment second.
    //
    // `existing` (the payments row) is what short-circuits this whole block on a
    // retry. If the payment were written first and the payout write then failed,
    // the retry would find `existing` non-null, skip the block entirely, flip the
    // booking to 'paid' and return 200 — leaving the payee's payout row missing
    // forever, recoverable only by hand. Writing the payout first inverts that:
    // a failure here leaves NO payments row, so the retry re-runs both writes.
    // upsertPayout is idempotent on booking_id, so the replay is safe.
    await deps.store.upsertPayout({
      booking_id: args.bookingId,
      ...payee,
      amount: args.amount, // pilot: no platform fee — payout = settled amount
      mode: args.mode,
      status: 'recorded',
      recorded_by: actor.userId,
    })
    await deps.store.insertPayment({
      booking_id: args.bookingId,
      amount: args.amount,
      mode: args.mode,
      reference: args.reference,
      recorded_by: actor.userId,
      // 'settled' — NOT 'recorded'. The live payments table carries
      // CHECK (status IN ('pending','captured','settled','failed','refunded'))
      // from its original gateway-style schema; 'recorded' violated it and every
      // cash settlement 500'd on the payments insert (payments_status_check),
      // which is why payments has zero rows in prod. The payouts table uses a
      // different vocabulary that DOES allow 'recorded', so the payout wrote and
      // the payment did not — the drift is per-table. 'settled' is the terminal
      // state in the payments vocabulary. (The Map-backed test fake never enforced
      // the CHECK, so this passed CI — see the added assertion in payment.e2e.mts.)
      status: 'settled',
    })
  }

  // Flip completed → paid (state machine stays in booking-service). A 409
  // means it is already paid (concurrent/retry) — that is success here.
  try {
    // `mode` is the payments vocabulary for how it was paid (cash/UPI/direct) and
    // `reference` is the operator-supplied receipt handle — both are what a shipper
    // needs to recognise the payment on their own records. `payment`/`payout` are
    // read back further down, after this flip, so they are deliberately not used here.
    await deps.booking.markPaid(args.bookingId, {
      amount: args.amount,
      method: args.mode,
      payment_id: args.reference ?? undefined,
    })
  } catch (err) {
    if (!(err instanceof PaymentError && err.httpStatus === 409)) throw err
  }

  // Revenue is now known, so fold the trip into the owner's per-asset P&L.
  // Fleet-only: a solo-driver booking has no fleet assets to roll up, and this
  // path must stay byte-identical to the pre-fleet behaviour for those.
  if (booking.fleet_owner_id) emitTripEconomics(args.bookingId, deps.logger)

  const payment = existing ?? (await deps.store.getPayment(args.bookingId))
  const payout = await deps.store.getPayout(args.bookingId)
  return { booking_id: args.bookingId, status: 'paid', already_settled: !!existing, payment, payout }
}

// -----------------------------------------------------------
// onTripCompleted — outbox/saga consumer. When a trip completes,
// booking-service best-effort emits `trip_completed`; this idempotently
// pre-creates a 'pending' payout keyed on booking_id (retriable, at most
// one payout per booking). NOT a cross-service RPC coupling tables. The
// settle path is self-healing, so a lost event never blocks settlement.
// -----------------------------------------------------------

export async function onTripCompleted(
  args: { booking_id: string; driver_id: string | null; fleet_owner_id?: string | null; amount: number },
  deps: PaymentDeps,
) {
  const payee = resolvePayee(args)
  if (!payee) {
    // Nothing to pre-create — settle() resolves the payee from the booking
    // itself and self-heals, so a payee-less event costs nothing but a log line.
    deps.logger?.warn({ booking_id: args.booking_id }, 'trip_completed carried no payee; skipping pending payout')
    return { booking_id: args.booking_id, payout_pending: false }
  }

  await deps.store.insertPendingPayoutIfAbsent({
    booking_id: args.booking_id,
    ...payee,
    amount: args.amount,
    mode: null,
    status: 'pending',
    recorded_by: null,
  })
  return { booking_id: args.booking_id, payout_pending: true }
}
