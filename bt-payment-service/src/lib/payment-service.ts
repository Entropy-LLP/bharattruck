import type { BookingClient } from './booking-client.js'
import type { PaymentStore, PaymentMode } from './payment-store.js'
import { PaymentError } from './errors.js'
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
    await deps.store.insertPayment({
      booking_id: args.bookingId,
      amount: args.amount,
      mode: args.mode,
      reference: args.reference,
      recorded_by: actor.userId,
      status: 'recorded',
    })
    await deps.store.upsertPayout({
      booking_id: args.bookingId,
      driver_id: booking.driver_id,
      amount: args.amount, // pilot: no platform fee — driver payout = settled amount
      mode: args.mode,
      status: 'recorded',
      recorded_by: actor.userId,
    })
  }

  // Flip completed → paid (state machine stays in booking-service). A 409
  // means it is already paid (concurrent/retry) — that is success here.
  try {
    await deps.booking.markPaid(args.bookingId)
  } catch (err) {
    if (!(err instanceof PaymentError && err.httpStatus === 409)) throw err
  }

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
  args: { booking_id: string; driver_id: string | null; amount: number },
  deps: PaymentDeps,
) {
  await deps.store.insertPendingPayoutIfAbsent({
    booking_id: args.booking_id,
    driver_id: args.driver_id,
    amount: args.amount,
    mode: null,
    status: 'pending',
    recorded_by: null,
  })
  return { booking_id: args.booking_id, payout_pending: true }
}
