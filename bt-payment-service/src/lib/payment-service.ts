import type { BookingClient } from './booking-client.js'
import type { PaymentStore, PaymentMode, PayoutPayee, PayoutRecord } from './payment-store.js'
import { PaymentError } from './errors.js'
import { emitTripEconomics } from './fleet-emit.js'
import type { AuthenticatedUser } from '../plugins/auth.js'

// -----------------------------------------------------------
// PaymentService — cash-recorded settlement (NO escrow, NO Razorpay).
// Records a direct/UPI/cash settlement against a COMPLETED booking,
// records the payout(s) — one per payee, since a fleet trip may split
// the freight with its driver (D-7) — and asks booking-service to run
// completed → paid. Fully idempotent + self-healing: a retried settle
// never double-records and heals a partial (payment recorded but the
// paid-flip lost). Deps are injected for verification.
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

// agreedPrice — what this booking is contractually worth, using the SAME
// precedence as every other consumer of a booking's money (booking-service's
// mark-paid receipt and payment-emit both read `final_price ?? quoted_price`):
// a negotiated/auction-won price supersedes the original quote.
//
// Returns null when the booking names no usable price at all. That is not a
// settlement blocker — refusing to settle a priced-at-nothing booking would
// strand the trip in `completed` forever with no operator recourse, which is
// exactly the kind of dead-end the receiver-email gap already taught us to
// avoid. Callers skip reconciliation and log instead.
export function agreedPrice(booking: { quoted_price?: number | null; final_price?: number | null }): number | null {
  const agreed = booking.final_price ?? booking.quoted_price
  return typeof agreed === 'number' && Number.isFinite(agreed) && agreed > 0 ? agreed : null
}

// Whole rupees everywhere upstream (the pricing engine Math.ceil()s every
// component), so this only absorbs float representation noise — never a real
// discount. One paisa.
const AMOUNT_EPSILON = 0.01

// A payee and what they are owed out of one settlement. Deliberately free of
// booking_id/mode/status so a later disbursement layer (Razorpay Route, D-12 —
// NOT this slice) can consume the same shape without going near the ledger.
export type PayoutSplit = PayoutPayee & { amount: number }

// resolvePayees — who gets paid, and how much, for ONE settled trip.
//
// The contract with the shipper is still with WHOEVER MADE THE BID (Q15): a
// solo driver, or the fleet owner who bid on their fleet's behalf. What D-7
// adds is that the bid money may then be shared with the driver who actually
// ran the trip, per `fleet_drivers.revenue_share_pct` — a standing term of the
// affiliation, set by the owner.
//
//   solo booking                 -> [driver 100%]
//   fleet booking, share = 0     -> [fleet_owner 100%]   (salaried; today's behaviour)
//   fleet booking, share = 30    -> [fleet_owner 70%, driver 30%]
//   fleet booking, share = 100   -> [driver 100%]
//
// Returns [] when the booking names no bidder at all; callers decide whether
// that is fatal. A payee whose share works out to nothing is dropped rather
// than written as a ₹0 row — an empty payout is not a fact about the trip, it
// is noise in the ledger and a disbursement the bank would reject.
//
// `driverSharePct` is a parameter, not a lookup, so this stays pure: the whole
// split is testable without a database, and the caller decides whether reading
// the affiliation is even appropriate (the saga path deliberately does not —
// see onTripCompleted).
export function resolvePayees(
  booking: { driver_id: string | null; fleet_owner_id?: string | null },
  amount: number,
  driverSharePct = 0,
): PayoutSplit[] {
  if (booking.fleet_owner_id) {
    const owner: PayoutPayee = { payee_type: 'fleet_owner', fleet_owner_id: booking.fleet_owner_id, driver_id: null }

    // Clamped rather than trusted: the DB CHECK holds 0..100 today, but this
    // number decides who gets the money and a bad one would either overpay the
    // driver or hand the owner a negative payout.
    const pct = Number.isFinite(driverSharePct) ? Math.min(Math.max(driverSharePct, 0), 100) : 0
    if (pct === 0 || !booking.driver_id) return [{ ...owner, amount }]

    // Split in whole PAISE, which is the precision `payouts.amount numeric(12,2)`
    // actually stores. Doing it in rupee floats lets a 33.33% share land on a
    // fraction of a paisa that the column then rounds independently per row —
    // and two independently-rounded rows do not have to add up.
    const totalPaise = Math.round(amount * 100)
    const driverPaise = Math.round((totalPaise * pct) / 100)

    // The OWNER absorbs the rounding remainder — always, in the same direction.
    // Two reasons. The driver's cut is the number they were promised and can
    // check on a calculator, so it is the one that should be exact; and the
    // owner set the split, holds the shipper relationship and is the residual
    // claimant on the trip, so the sub-paisa belongs on their side of the line.
    // Taking it as a subtraction (not a second rounding) is what makes the two
    // rows sum to the settled amount exactly rather than usually.
    const ownerPaise = totalPaise - driverPaise
    if (ownerPaise === 0) return [{ payee_type: 'driver', driver_id: booking.driver_id, fleet_owner_id: null, amount }]

    return [
      { ...owner, amount: ownerPaise / 100 },
      { payee_type: 'driver', driver_id: booking.driver_id, fleet_owner_id: null, amount: driverPaise / 100 },
    ]
  }

  // No fleet: the driver bid and the driver is paid, at the settled amount
  // untouched — no paise round-trip, so this stays byte-identical to pre-split.
  if (booking.driver_id) {
    return [{ payee_type: 'driver', driver_id: booking.driver_id, fleet_owner_id: null, amount }]
  }
  return []
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
    const payouts = await deps.store.getPayouts(args.bookingId)
    return { booking_id: args.bookingId, status: 'paid', already_settled: true, payment: existing, ...payoutView(booking, payouts) }
  }

  if (booking.status !== 'completed') {
    throw new PaymentError(
      `Settlement can only be recorded for a 'completed' trip (booking is '${booking.status}')`,
      'INVALID_STATE',
      409,
    )
  }

  // ── Money integrity ───────────────────────────────────────────────────────
  // The settled amount is caller-supplied, so without this a shipper could POST
  // amount: 1 against a ₹36,000 trip: the booking would flip to 'paid', the
  // payout would be written for ₹1, and the driver/fleet would carry the loss
  // with the platform's own records agreeing that they were paid in full.
  //
  // The split is deliberate and mirrors the authorization split above:
  //   • A SHIPPER is a party to the deal, so they may only confirm the price
  //     that was agreed. They cannot self-discount.
  //   • ADMIN/OPS may record a different figure, because real cash settlements
  //     genuinely differ — detention, a damage deduction, a part payment the
  //     shipper and carrier settled between themselves. Removing that escape
  //     hatch would strand those trips in `completed` with no way to close
  //     them. It is logged so the deviation is visible in the ledger.
  //
  // Checked BEFORE the writes and on every call (not just the first): a heal
  // retry carrying a wrong amount would otherwise slip through `existing` and
  // put the wrong number on the shipper's receipt via markPaid.
  const agreed = agreedPrice(booking)
  if (agreed === null) {
    deps.logger?.warn(
      { booking_id: args.bookingId, amount: args.amount },
      'booking carries no usable price; settling without amount reconciliation',
    )
  } else if (Math.abs(args.amount - agreed) > AMOUNT_EPSILON) {
    if (actor.role === 'admin') {
      deps.logger?.warn(
        { booking_id: args.bookingId, amount: args.amount, agreed_price: agreed, actor: actor.userId },
        'ops override: settled amount differs from the agreed price',
      )
    } else {
      throw new PaymentError(
        `Settled amount ₹${args.amount} does not match the agreed price ₹${agreed} for this booking`,
        'AMOUNT_MISMATCH',
        422,
      )
    }
  }

  // Record the money (hard write — must persist). Skip if already recorded
  // (idempotent) and fall through to healing the paid-flip below.
  if (!existing) {
    // Resolved BEFORE the payment insert: a booking with no payee cannot be
    // paid out, and migration 016's CHECK would reject the payout row anyway —
    // better to refuse up front than to record money we cannot disburse.
    //
    // The D-7 share is read here and only here. It governs how the freight is
    // divided, so it must be the share in force when the money is recorded —
    // not one cached from trip completion, by which time the owner may have
    // renegotiated it. Reading it costs one indexed lookup on a path that
    // already makes two cross-service HTTP calls.
    const sharePct = booking.fleet_owner_id && booking.driver_id
      ? await deps.store.getDriverRevenueSharePct(booking.fleet_owner_id, booking.driver_id)
      : 0
    const payees = resolvePayees(booking, args.amount, sharePct) // pilot: no platform fee — the payees split the whole settled amount
    if (payees.length === 0) {
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
    // upsertPayout is idempotent on (booking_id, payee_type), so the replay is safe.
    //
    // A split writes the payees one row at a time and is therefore not atomic
    // ACROSS them — which the same inversion covers: a crash between the two
    // still leaves no payments row, so the retry re-upserts BOTH onto the rows
    // it already wrote. That is precisely why the uniqueness anchor had to move
    // to (booking_id, payee_type) in 0023 and not merely be dropped; under a
    // weaker anchor this loop is what would double-pay on retry.
    for (const payee of payees) {
      await deps.store.upsertPayout({
        booking_id: args.bookingId,
        ...payee,
        mode: args.mode,
        status: 'recorded',
        recorded_by: actor.userId,
      })
    }
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
  const payouts = await deps.store.getPayouts(args.bookingId)
  return { booking_id: args.bookingId, status: 'paid', already_settled: !!existing, payment, ...payoutView(booking, payouts) }
}

// payoutView — the settlement's payouts, shaped for the wire.
//
// `payouts` (the full list) is the new truth. `payout` stays because the
// shipper app already reads it as a single object (shipper/src/lib/api.ts
// PaymentStatus); dropping it would blank the settlement panel on a deploy
// this slice is not allowed to coordinate with. It names the BIDDER's row —
// the party the shipper actually contracted with — so the number the shipper
// sees keeps meaning what it meant before splits existed, rather than becoming
// whichever row the database happened to return first.
export function payoutView(
  booking: { fleet_owner_id?: string | null },
  payouts: PayoutRecord[],
): { payout: PayoutRecord | null; payouts: PayoutRecord[] } {
  const bidderType = booking.fleet_owner_id ? 'fleet_owner' : 'driver'
  return { payout: payouts.find((p) => p.payee_type === bidderType) ?? payouts[0] ?? null, payouts }
}

// -----------------------------------------------------------
// onTripCompleted — outbox/saga consumer. When a trip completes,
// booking-service best-effort emits `trip_completed`; this idempotently
// pre-creates a 'pending' payout for the bidder (retriable, at most one
// payout per payee per booking). NOT a cross-service RPC coupling tables. The
// settle path is self-healing, so a lost event never blocks settlement.
// -----------------------------------------------------------

export async function onTripCompleted(
  args: { booking_id: string; driver_id: string | null; fleet_owner_id?: string | null; amount: number },
  deps: PaymentDeps,
) {
  // No D-7 share here on purpose — the pre-created row is the BIDDER's, exactly
  // as before splits existed. Two reasons. The amount is provisional anyway (it
  // is the trip's price, and ops may settle a different figure), so a split of
  // it would be a provisional split of a provisional number. And a pre-created
  // driver row that settle() then decides against — because the owner changed
  // the share between completion and payment — would be orphaned at 'pending'
  // forever, since settle() upserts rather than reconciles. Passing 0 keeps
  // this path emitting exactly one row, which settle() always overwrites.
  const [payee] = resolvePayees(args, args.amount, 0)
  if (!payee) {
    // Nothing to pre-create — settle() resolves the payee from the booking
    // itself and self-heals, so a payee-less event costs nothing but a log line.
    deps.logger?.warn({ booking_id: args.booking_id }, 'trip_completed carried no payee; skipping pending payout')
    return { booking_id: args.booking_id, payout_pending: false }
  }

  await deps.store.insertPendingPayoutIfAbsent({
    booking_id: args.booking_id,
    ...payee,
    mode: null,
    status: 'pending',
    recorded_by: null,
  })
  return { booking_id: args.booking_id, payout_pending: true }
}
