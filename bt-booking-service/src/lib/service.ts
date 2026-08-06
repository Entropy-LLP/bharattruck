import type { AuthenticatedUser, BookingStatus, BookingWithProfiles, CreateBookingBody, DbBooking } from './types.js'
import { BookingError } from './types.js'
import { assertFleetAssignmentReady, assertValidTransition } from './state.js'
import * as repo from './repository.js'
import {
  hasLiveVehicleAssignment,
  isEmployedDriver,
  stripCommercialFields,
  type PriceMasked,
} from './fleet.js'
import { defaultPricingClient, type PricingClient } from './pricing-client.js'
import * as notify from './notifications/emit.js'
import * as podRepo from './pod/repository.js'
import { evaluateOtpGate, type OtpGateResult } from './pod/service.js'

// -----------------------------------------------------------
// createBooking — the price quote-lock saga.
// Only shippers can create bookings. The shipper sends a quote_id (the
// price-lock handle), never a raw price. We read the locked quote from
// pricing (own-your-data: booking never touches the price_quotes table),
// validate it, set bookings.quoted_price SERVER-SIDE from the lock, insert,
// then atomically consume the quote so it can never be replayed.
//
// Every validation failure is a 4xx envelope, never a 500: a missing quote is
// NOT_FOUND, someone else's quote is FORBIDDEN, an expired quote is
// VALIDATION_ERROR, an already-consumed quote is INVALID_TRANSITION, and a
// pricing outage is UPSTREAM_ERROR (502) — all raised as BookingError.
//
// The true replay/expiry guard is the DB conditional UPDATE inside pricing's
// consumeQuote (WHERE consumed_at IS NULL AND expires_at > now()). The pre-checks
// below keep the happy path clean and give precise errors; step 5 is the
// concurrency-safe guard against a double-submit of one quote_id.
//
// Step 3 is the WHOLE POINT of the lock: the booking's route + cargo MUST match
// the coords/weight/load the quote was priced from, or the price SHOWN would not
// be the price for the trip actually booked (a shipper could quote a 1 km / 1 kg
// trip then book a 1400 km / 20 t trip on the same lock). distance_km is NOT
// checked directly — it is DERIVED from the coords server-side at quote time, so
// binding the coords binds the priced distance.
// -----------------------------------------------------------

// Coordinate match tolerance (~1 m). The shipper sends the SAME coords to the
// quote and the booking; the quote's coords come back rounded to the column's
// 6 dp, well inside this epsilon.
const COORD_EPSILON = 1e-5

// Weight is compared at the stored precision (price_quotes.weight_kg is
// numeric(12,2)): round both sides to 2 dp (integer hundredths) and match
// EXACTLY. This leaves no tolerance WINDOW that could be used to nudge the
// weight across a surcharge-tier boundary, while still tolerating the DB's 2-dp
// quantisation of the quote-time weight (a strict !== on the raw float would
// spuriously reject a >2-decimal input).
const weightHundredths = (kg: number): number => Math.round(kg * 100)

// Minimal structural logger (same shape used by payment-emit) so the route can
// pass req.log without service.ts depending on Fastify.
type Logger = { warn(obj: unknown, msg: string): void }

export async function createBooking(
  body: CreateBookingBody,
  actor: AuthenticatedUser,
  pricing: PricingClient = defaultPricingClient(),
  log?: Logger,
): Promise<DbBooking> {
  if (actor.role !== 'shipper') {
    throw new BookingError('Only shippers can create bookings', 'FORBIDDEN', 403)
  }

  // 1. Read the locked quote (internal call). A missing quote → NOT_FOUND (4xx).
  const quote = await pricing.getQuote(body.quote_id)

  // 2. Validate ownership / not-already-consumed / expiry — all 4xx.
  if (quote.shipper_id !== actor.userId) {
    throw new BookingError('Quote does not belong to you', 'FORBIDDEN', 403)
  }
  if (quote.consumed_at) {
    throw new BookingError('Quote already used', 'INVALID_TRANSITION', 409)
  }
  if (new Date(quote.expires_at).getTime() <= Date.now()) {
    throw new BookingError('Quote has expired — request a new quote', 'VALIDATION_ERROR', 400)
  }

  // 3. BIND the booking to the priced route + cargo. Any mismatch → 4xx; the
  //    locked price is only valid for the exact trip it was quoted for. route +
  //    weight + load_type + vehicle_type are ALL bound, so the priced trip and
  //    the booked trip are the same one. vehicle_type is load-bearing here: the
  //    rate card scales ~2.9x across classes, so without this bind a shipper
  //    could price a mini_truck and book a trailer on the same lock.
  //    (Weight-vs-vehicle-capacity validation — rejecting a class too small for
  //    the weight — is a deliberate follow-up in the pricing constant-harvest PR,
  //    which owns the capacity constants; it is intentionally NOT done here.)
  // Fail CLOSED on any non-finite numeric before the abs comparisons
  // (defense-in-depth: the only caller validates the body with Zod, but a NaN
  // would make `NaN > EPS === false` fail OPEN — the opposite of the string
  // checks, which fail closed on undefined).
  const nums = [
    body.source_lat, body.source_lng, body.dest_lat, body.dest_lng, body.weight_kg,
    quote.source_lat, quote.source_lng, quote.dest_lat, quote.dest_lng, quote.weight_kg,
  ]
  if (
    nums.some((n) => !Number.isFinite(n)) ||
    Math.abs(body.source_lat - quote.source_lat) > COORD_EPSILON ||
    Math.abs(body.source_lng - quote.source_lng) > COORD_EPSILON ||
    Math.abs(body.dest_lat   - quote.dest_lat)   > COORD_EPSILON ||
    Math.abs(body.dest_lng   - quote.dest_lng)   > COORD_EPSILON ||
    weightHundredths(body.weight_kg) !== weightHundredths(quote.weight_kg) ||
    body.load_type    !== quote.load_type ||
    body.vehicle_type !== quote.vehicle_type
  ) {
    throw new BookingError(
      'Booking route or cargo does not match the locked quote — request a new quote',
      'VALIDATION_ERROR',
      400,
    )
  }

  // 4. Insert the booking with the SERVER-SIDE locked price (client price is gone).
  const booking = await repo.createBooking(body, actor, quote.quoted_price)

  // 5. Atomically consume the quote (DB-enforced replay/expiry guard). On any
  //    failure — including a concurrent double-submit that loses the race and
  //    gets a 409 — compensate by removing the just-created, not-yet-accepted
  //    booking so it never becomes visible to anyone, then re-throw the 4xx.
  //    The delete nulls consumed_by_booking_id but NOT consumed_at, so a
  //    consumed quote stays consumed (no replay).
  //
  //    A failing compensation is logged (never silently swallowed) so an orphan
  //    is observable and reconcilable by ops.
  //
  //    Residual narrow race (known, accepted, NON-financial): a transport-only
  //    consume failure — the quote WAS consumed server-side but the reply was
  //    lost — racing a concurrent driver-accept leaves an 'accepted' booking the
  //    guarded delete can no longer remove. Price integrity still holds: the
  //    booking carries the correct server-locked quoted_price and the quote is
  //    correctly consumed (no replay); only the shipper's client sees a spurious
  //    error. We do NOT redesign the state machine to close this here.
  try {
    await pricing.consumeQuote(body.quote_id, booking.id)
  } catch (err) {
    try {
      await repo.deleteBooking(booking.id)
    } catch (cleanupErr) {
      log?.warn(
        { err: cleanupErr, booking_id: booking.id, quote_id: body.quote_id },
        'quote-lock compensation failed — booking may be orphaned (reconcile in ops)',
      )
    }
    throw err
  }

  return booking
}

// -----------------------------------------------------------
// resolveDriverScope — who the calling driver is, in the two terms the rest of
// this file needs: their drivers.id, and whether a fleet employs them.
//
// drivers.id (NOT the JWT's users.id) is what bookings.driver_id references, so
// this lookup is the only way to ask "is this booking mine?".
//
// PRICE HIDING (founder Q16) is the rule this flag gates — the one rule in this
// slice that reaches into an EXISTING driver payload, so it stays gated as
// narrowly as possible. A driver EMPLOYED by a fleet is not the commercial
// party on the trip: their owner bid and their owner gets paid, so they must
// not see quoted_price, final_price or min_acceptable.
//
// "Employed" is now affiliation AND owning no truck, not affiliation alone
// (docs/ARCHITECTURE_UNIFIED_IDENTITY.md §1.1). The old check masked the money
// from an owner-driver whose truck is attached to a fleet, and took away their
// load board — but they carry that truck's EMI, fuel and downtime, so they are
// a stakeholder in what the trip earns, not staff.
//
// Everything else still resolves to the untouched solo payload: a non-driver
// role, no drivers row, no affiliation row, or a database without the fleet
// tables.
// -----------------------------------------------------------

async function resolveDriverScope(actor: AuthenticatedUser): Promise<repo.DriverListScope | null> {
  if (actor.role !== 'driver') return null
  const driverRow = await repo.getDriverByUserId(actor.userId)
  if (!driverRow) return null
  return { driverId: driverRow.id, employed: await isEmployedDriver(driverRow.id) }
}

// -----------------------------------------------------------
// getBooking
// Returns booking with driver profile joined.
// Shippers can only fetch their own bookings.
//
// A FLEET-AFFILIATED driver is scoped to the trips assigned to them, exactly
// like listBookings. Masking the money alone was not enough: the list said
// "assignments only" while a direct fetch by id still returned ANY booking, so
// an employed driver could read the whole marketplace one UUID at a time — and
// the app, seeing a readable booking with no quote of their own, offered them
// the bid form for it. Scoping the read is what makes the two agree.
//
// Answered as 404 (not 403) so a fleet driver cannot probe which booking ids
// exist. Solo drivers are untouched: the open pending load board is their
// product, and browsing it is exactly what they are meant to do.
// -----------------------------------------------------------

export async function getBooking(
  id: string,
  actor: AuthenticatedUser,
): Promise<PriceMasked<BookingWithProfiles>> {
  const booking = await repo.getBookingById(id)
  if (!booking) {
    throw new BookingError(`Booking ${id} not found`, 'NOT_FOUND', 404)
  }
  if (actor.role === 'shipper' && booking.shipper_id !== actor.userId) {
    throw new BookingError('Forbidden', 'FORBIDDEN', 403)
  }

  // Shipper/admin keep the payload they have always had — assigned_to_me is a
  // driver-facing field and they are not drivers.
  if (actor.role !== 'driver') return booking

  // One driver lookup answers both questions below.
  const driverRow = await repo.getDriverByUserId(actor.userId)
  const assignedToMe = !!driverRow && booking.driver_id === driverRow.id

  // Employed = affiliated AND owns no truck. An owner-driver attached to a fleet
  // falls through to the solo path below: they keep the open load board and they
  // keep the money, because the truck's cost sits with them.
  if (driverRow && (await isEmployedDriver(driverRow.id))) {
    if (!assignedToMe) {
      throw new BookingError(`Booking ${id} not found`, 'NOT_FOUND', 404)
    }
    return { ...stripCommercialFields(booking), assigned_to_me: true }
  }

  return { ...booking, assigned_to_me: assignedToMe }
}

// -----------------------------------------------------------
// listBookings
// Role-scoped filtering is handled inside the repository; this layer only
// resolves WHICH driver is calling and whether to mask the money.
//
// A FLEET-AFFILIATED driver has no load board (founder Q14) — they cannot
// self-select work, so the open 'pending' list is replaced by the trips their
// owner has actually assigned to them, with the money masked.
//
// A SOLO driver keeps the pending load board, unmasked, and now also sees the
// trips already assigned to them — without that they had no route into their
// own accepted/in_transit trip at all (BIBLE §5.4 item 3).
// -----------------------------------------------------------

export async function listBookings(actor: AuthenticatedUser): Promise<PriceMasked<DbBooking>[]> {
  const scope = await resolveDriverScope(actor)
  const bookings = await repo.listBookings(actor, scope ?? undefined)
  return scope?.employed ? bookings.map(stripCommercialFields) : bookings
}

// -----------------------------------------------------------
// acceptBooking
// Only drivers can accept. Validates transition, resolves
// drivers.id from users.id, then performs the DB update.
// -----------------------------------------------------------

export async function acceptBooking(
  bookingId: string,
  actor: AuthenticatedUser,
  log?: Logger,
): Promise<DbBooking> {
  if (actor.role !== 'driver') {
    throw new BookingError('Only drivers can accept bookings', 'FORBIDDEN', 403)
  }

  const booking = await repo.getBookingById(bookingId)
  if (!booking) {
    throw new BookingError(`Booking ${bookingId} not found`, 'NOT_FOUND', 404)
  }

  assertValidTransition(booking.status, 'accepted')

  const driverRow = await repo.getDriverByUserId(actor.userId)
  if (!driverRow) {
    throw new BookingError('Driver profile not found', 'NOT_FOUND', 404)
  }

  // Self-accepting an open booking IS load-board self-selection, so it is
  // closed to a fleet-EMPLOYED driver for the same reason bidding is (Q14):
  // their work is assigned by their owner.
  //
  // An owner-driver attached to a fleet is NOT closed out. They own the truck,
  // so self-selecting work with it is exactly what they are entitled to do —
  // the fleet is one source of work for them, not the only one. Solo drivers
  // are unaffected either way.
  if (await isEmployedDriver(driverRow.id)) {
    throw new BookingError(
      'You drive for a fleet — your fleet owner takes loads and assigns them to you',
      'FORBIDDEN',
      403,
    )
  }

  const updated = await repo.acceptBooking(bookingId, driverRow.id)
  if (!updated) {
    // Another driver accepted between our read and write
    throw new BookingError(
      'Booking was already accepted by another driver',
      'INVALID_TRANSITION',
      409,
    )
  }

  await notify.emitBookingAccepted(updated, log)
  return updated
}

// -----------------------------------------------------------
// startBooking
// Drives the trip lifecycle forward for the assigned driver:
//   accepted → in_transit   (driver starts the trip)
// Completion (in_transit → completed) is DELIBERATELY NOT a
// driver-facing transition — there is no driver self-complete path.
// It is closed only by the receiver-OTP POD flow
// (completeBookingViaPod) or an ops force-complete (forceCompleteBooking).
// Only the assigned driver (drivers.id via getDriverByUserId) may start.
// The state machine (assertValidTransition) enforces legal moves
// server-side and rejects illegal ones with a 4xx envelope, never a 500.
// -----------------------------------------------------------

export async function startBooking(
  bookingId: string,
  actor: AuthenticatedUser,
  log?: Logger,
): Promise<DbBooking> {
  const updated = await transitionAssignedBooking(bookingId, actor, 'in_transit')
  await notify.emitTripStarted(updated, log)
  return updated
}

async function transitionAssignedBooking(
  bookingId: string,
  actor: AuthenticatedUser,
  to: 'in_transit',
): Promise<DbBooking> {
  // Only drivers transition trips; a shipper/admin hitting these gets 403.
  if (actor.role !== 'driver') {
    throw new BookingError('Only the assigned driver can transition a trip', 'FORBIDDEN', 403)
  }

  const booking = await repo.getBookingById(bookingId)
  if (!booking) {
    throw new BookingError(`Booking ${bookingId} not found`, 'NOT_FOUND', 404)
  }

  const driverRow = await repo.getDriverByUserId(actor.userId)
  if (!driverRow) {
    throw new BookingError('Driver profile not found', 'NOT_FOUND', 404)
  }

  // Assigned-driver-only: a driver who is not this booking's driver gets 403.
  if (booking.driver_id !== driverRow.id) {
    throw new BookingError('You are not assigned to this booking', 'FORBIDDEN', 403)
  }

  // Server-side state-machine guard: illegal moves → 409, not 500.
  assertValidTransition(booking.status, to)

  // Fleet-won trips carry a truck of record. Solo bookings have
  // fleet_owner_id NULL and skip this entirely — no extra query, no new
  // failure mode on the path that exists today.
  if (booking.fleet_owner_id) {
    assertFleetAssignmentReady(await hasLiveVehicleAssignment(bookingId))
  }

  const updated = await repo.transitionBookingStatus(bookingId, driverRow.id, booking.status, to)
  if (!updated) {
    // Status changed between our read and write (concurrent transition).
    throw new BookingError(
      `Booking could not be moved to '${to}' — its status changed concurrently`,
      'INVALID_TRANSITION',
      409,
    )
  }
  return updated
}

// -----------------------------------------------------------
// setReceiverEmail
//
// Lets the shipper (or ops) supply the consignee inbox on an EXISTING booking.
//
// Why this exists: receiver_email is required at creation today, but the column
// is nullable and most live bookings predate that rule — 10 of 11 in-transit
// trips have no receiver email. Without an address the driver's POD request has
// nowhere to send the code, so the trip cannot reach 'completed' at all and the
// payout it gates never happens. The driver app already told the shipper to
// "add one before delivery can be confirmed"; this is the route that makes that
// instruction actionable instead of a dead end.
//
// WHO: the owning shipper, or ops/admin (who unstick trips on both parties'
// behalf). Deliberately NOT the driver: the consignee is the shipper's
// counterparty, and letting the carrier redirect where the delivery code goes
// would hand them both halves of the proof-of-delivery check.
//
// WHEN: any non-terminal status. Editing it on a completed/paid booking would
// rewrite the audit trail of an already-proven delivery; cancelled has nothing
// left to deliver.
// -----------------------------------------------------------

const RECEIVER_EMAIL_EDITABLE_STATUSES: BookingStatus[] = [
  'pending', 'negotiating', 'accepted', 'in_transit',
]

export async function setReceiverEmail(
  bookingId: string,
  receiverEmail: string,
  actor: AuthenticatedUser,
): Promise<DbBooking> {
  const booking = await repo.getBookingById(bookingId)
  if (!booking) {
    throw new BookingError(`Booking ${bookingId} not found`, 'NOT_FOUND', 404)
  }

  if (actor.role === 'shipper') {
    if (booking.shipper_id !== actor.userId) {
      throw new BookingError('Forbidden', 'FORBIDDEN', 403)
    }
  } else if (actor.role !== 'admin') {
    throw new BookingError(
      'Only the shipper who owns this booking (or ops) can set the receiver email',
      'FORBIDDEN',
      403,
    )
  }

  if (!RECEIVER_EMAIL_EDITABLE_STATUSES.includes(booking.status)) {
    throw new BookingError(
      `The receiver email cannot be changed on a '${booking.status}' booking`,
      'INVALID_TRANSITION',
      409,
    )
  }

  const updated = await repo.setReceiverEmail(
    bookingId,
    receiverEmail,
    RECEIVER_EMAIL_EDITABLE_STATUSES,
  )
  if (!updated) {
    throw new BookingError(
      'Booking could not be updated — its status changed concurrently',
      'INVALID_TRANSITION',
      409,
    )
  }
  return updated
}

// -----------------------------------------------------------
// getPodContext
// Authorizes a driver's request to issue a receiver-OTP POD and
// returns the context bt-cargo-ledger needs (status + the
// consignee receiver_email). Assigned-driver-only; the trip must
// be in_transit (POD closes an in-progress trip). Owned here
// because bookings + driver identity live in this service.
//
// PriceMasked by construction: PodContext carries no commercial field, so the
// Q16 price-hiding rule needs nothing here — a fleet driver's POD flow is the
// solo driver's POD flow. Keep it that way if this payload ever grows.
// -----------------------------------------------------------

export type PodGeofence = {
  // true when the truck's position corroborates it is at the drop; false when we had
  // no trustworthy signal and issued anyway (the documented weaker path).
  gated: boolean
  verdict: 'inside' | 'outside' | 'unknown'
  distance_m: number | null
  source: 'telemetry' | 'geofence_event' | 'none'
}

export type PodContext = {
  booking_id: string
  status: BookingStatus
  receiver_email: string | null
  // Present ONLY when migration 0025 is live and the geofence gate ran. Absent on a
  // pre-0025 database, so the payload is byte-identical to today there. bt-cargo-ledger
  // reads only receiver_email, so this is additive for it; the driver app uses it to
  // show whether the code will be a corroborated (strong) or degraded (weak) proof.
  geofence?: PodGeofence
}

export async function getPodContext(
  bookingId: string,
  actor: AuthenticatedUser,
  log?: Logger,
): Promise<PodContext> {
  if (actor.role !== 'driver') {
    throw new BookingError('Only the assigned driver can request a POD OTP', 'FORBIDDEN', 403)
  }

  const booking = await repo.getBookingById(bookingId)
  if (!booking) {
    throw new BookingError(`Booking ${bookingId} not found`, 'NOT_FOUND', 404)
  }

  const driverRow = await repo.getDriverByUserId(actor.userId)
  if (!driverRow) {
    throw new BookingError('Driver profile not found', 'NOT_FOUND', 404)
  }

  if (booking.driver_id !== driverRow.id) {
    throw new BookingError('You are not assigned to this booking', 'FORBIDDEN', 403)
  }

  if (booking.status !== 'in_transit') {
    throw new BookingError(
      `POD OTP can only be requested while the trip is 'in_transit' (booking is '${booking.status}')`,
      'INVALID_TRANSITION',
      409,
    )
  }

  // The driver is standing at the drop with no address to send the code to, and
  // the shipper is the ONLY party who can fix it — but nothing in the product
  // tells them. Returning the empty context and leaving both sides waiting is how
  // a trip silently dead-ends short of 'completed' (and short of the payout it
  // gates). Emit is idempotent per booking, so a driver retrying the button does
  // not spam the shipper.
  if (!booking.receiver_email) {
    await notify.emitReceiverEmailMissing(booking, log)
  }

  // GEOFENCE-GATED OTP (§5.5, D-14). This runs ONLY when migration 0025 is live —
  // otherwise the existing email-OTP POD must behave EXACTLY as today, so we return
  // the same three-field context and never gate. The gate is what closes the "driver
  // phones ahead and gets the code 40 km out" hole: a live fix clearly away from the
  // drop BLOCKS issuance (a 409 that bt-cargo-ledger surfaces before it emails a code),
  // while no-signal DEGRADES to the documented weaker path rather than hard-blocking a
  // legitimate delivery where tracking was not running.
  const base: PodContext = { booking_id: booking.id, status: booking.status, receiver_email: booking.receiver_email }
  if (!(await podRepo.podFeatureAvailable(log))) {
    return base
  }

  const gate: OtpGateResult = await evaluateOtpGate(booking, log)
  if (gate.decision === 'block') {
    await podRepo.appendAudit(
      { booking_id: booking.id, action: 'otp_gate_block', actor_user_id: actor.userId, actor_role: actor.role,
        detail: { distance_m: gate.distance_m, source: gate.source } },
      log,
    )
    const km = gate.distance_m !== null ? ` (~${(gate.distance_m / 1000).toFixed(1)} km away)` : ''
    throw new BookingError(
      `You are not at the delivery location yet${km} — the delivery code is issued only from the drop point`,
      'INVALID_TRANSITION',
      409,
    )
  }

  await podRepo.appendAudit(
    { booking_id: booking.id, action: gate.decision === 'degrade' ? 'otp_gate_degraded' : 'otp_gate_pass',
      actor_user_id: actor.userId, actor_role: actor.role,
      detail: { verdict: gate.verdict, distance_m: gate.distance_m, source: gate.source } },
    log,
  )

  return { ...base, geofence: { gated: gate.decision === 'pass', verdict: gate.verdict, distance_m: gate.distance_m, source: gate.source } }
}

// -----------------------------------------------------------
// completeBookingViaPod
// Trusted internal transition in_transit → completed, driven by a
// verified receiver OTP in bt-cargo-ledger. Reuses the SAME state
// machine + repository path as the driver flow (assertValidTransition
// + transitionBookingStatus) — the state machine is NOT forked. The
// authority here is the OTP verification upstream, so there is no
// driver actor; we transition on the booking's own driver_id.
// -----------------------------------------------------------

export async function completeBookingViaPod(bookingId: string, log?: Logger): Promise<DbBooking> {
  const booking = await repo.getBookingById(bookingId)
  if (!booking) {
    throw new BookingError(`Booking ${bookingId} not found`, 'NOT_FOUND', 404)
  }
  if (!booking.driver_id) {
    throw new BookingError('Booking has no assigned driver', 'INVALID_TRANSITION', 409)
  }

  assertValidTransition(booking.status, 'completed')

  const updated = await repo.transitionBookingStatus(bookingId, booking.driver_id, booking.status, 'completed')
  if (!updated) {
    throw new BookingError(
      'Booking could not be completed — its status changed concurrently',
      'INVALID_TRANSITION',
      409,
    )
  }

  // POD hardening consequences of a CONFIRMED delivery (migration 0025). All three are
  // BEST-EFFORT and swallow a missing relation: the trip is already 'completed' upstream,
  // so on a pre-0025 database this path is byte-identical to what shipped before —
  // pod_state/consignee-ack/audit simply do not exist to write to.
  //   * pod_strength='confirmed' — the receiver held the secret, the strongest tier.
  //   * consignee_ack — the second half of a dual-ack discrepancy, landed by the OTP the
  //     consignee just entered (the driver was already on record at submission).
  //   * an append-only audit line, so the confirmation is on the trail like everything else.
  await podRepo.setConfirmedBestEffort(bookingId, 'receiver_otp', log)
  await podRepo.stampConsigneeAckBestEffort(bookingId, 'receiver_otp', log)
  await podRepo.appendAudit(
    { booking_id: bookingId, action: 'pod_confirmed', detail: { via: 'receiver_otp' } },
    log,
  )

  // The one notification the trip cannot be considered closed without: both sides
  // learn the receiver's OTP landed. Idempotent on the booking, so the payout saga
  // replaying this internal call cannot double-mail anyone.
  await notify.emitTripCompleted(updated, log)
  return updated
}

// -----------------------------------------------------------
// markBookingPaid
// Trusted internal transition completed → paid, driven by a
// recorded cash/direct settlement in bt-payment-service. Same
// state machine + repository path as the driver flow (the state
// machine is NOT forked). No driver actor — the authority is the
// settlement recorded upstream — so we transition on the booking's
// own driver_id. Idempotency is upstream (payment-service unique
// per booking); here the optimistic WHERE status='completed' guard
// means a replay after the flip returns 409, never a double-apply.
// -----------------------------------------------------------

export type SettlementDetail = {
  amount?: number | null
  method?: string | null
  paymentId?: string | null
  payoutStatus?: string | null
}

export async function markBookingPaid(
  bookingId: string,
  detail?: SettlementDetail,
  log?: Logger,
): Promise<DbBooking> {
  const booking = await repo.getBookingById(bookingId)
  if (!booking) {
    throw new BookingError(`Booking ${bookingId} not found`, 'NOT_FOUND', 404)
  }
  if (!booking.driver_id) {
    throw new BookingError('Booking has no assigned driver', 'INVALID_TRANSITION', 409)
  }

  assertValidTransition(booking.status, 'paid')

  const updated = await repo.transitionBookingStatus(bookingId, booking.driver_id, booking.status, 'paid')
  if (!updated) {
    throw new BookingError(
      'Booking could not be marked paid — its status changed concurrently',
      'INVALID_TRANSITION',
      409,
    )
  }

  // Receipt to the payer, payout notice to the payee. The amount is taken from the
  // settlement the caller actually recorded when supplied; it falls back to the
  // booking's own price so an older bt-payment-service that posts no body still
  // produces a truthful receipt rather than none at all.
  const amount = detail?.amount ?? updated.final_price ?? updated.quoted_price
  await notify.emitPaymentSettled(
    updated,
    { amount, method: detail?.method ?? null, paymentId: detail?.paymentId ?? null },
    log,
  )
  await notify.emitPayoutRecorded(updated, { amount, status: detail?.payoutStatus ?? null }, log)

  return updated
}

// -----------------------------------------------------------
// Ops overrides (admin/ops only) — force-complete a stuck trip and
// reassign a booking's driver. These are the manual exception-handling
// tools for the ops console (PRD Part 11 DoD). They bypass the
// assigned-driver guard because ops acts on behalf of the platform, but
// still keep the booking_status enum authoritative.
//
// NOTE (design, flagged to CTO): force-complete allows a source of
// 'accepted' OR 'in_transit'. 'accepted'→'completed' is NOT a legal move
// in the normal state machine (assertValidTransition would 409 it, and
// drivers must go via in_transit), so this ops-only path validates against
// an explicit source allowlist rather than assertValidTransition. The
// in_transit→completed case is the same target the normal machine allows.
// -----------------------------------------------------------

// 'delivery_asserted' is the ops-close source for the no-confirmation POD branch: the
// driver captured evidence and asserted delivery, and ops confirms it into 'completed'
// (migration 0025). The pod_state row keeps pod_strength='asserted' across the close —
// ops closing an asserted trip does NOT upgrade it to a confirmed proof (§6.3). Adding
// the source is inert on a pre-0025 database, where no booking can be in this state.
const OPS_FORCE_COMPLETE_SOURCES: BookingStatus[] = ['accepted', 'in_transit', 'delivery_asserted']

function assertOps(actor: AuthenticatedUser): void {
  if (actor.role !== 'admin') {
    throw new BookingError('Ops override requires an ops/admin role', 'FORBIDDEN', 403)
  }
}

export async function forceCompleteBooking(
  bookingId: string,
  actor: AuthenticatedUser,
  log?: Logger,
): Promise<{ booking: DbBooking; fromStatus: BookingStatus }> {
  assertOps(actor)

  const booking = await repo.getBookingById(bookingId)
  if (!booking) {
    throw new BookingError(`Booking ${bookingId} not found`, 'NOT_FOUND', 404)
  }
  if (!OPS_FORCE_COMPLETE_SOURCES.includes(booking.status)) {
    throw new BookingError(
      `Cannot force-complete a booking in '${booking.status}' status (only accepted or in_transit)`,
      'INVALID_TRANSITION',
      409,
    )
  }

  const fromStatus = booking.status
  const updated = await repo.forceTransitionByStatus(bookingId, OPS_FORCE_COMPLETE_SOURCES, 'completed')
  if (!updated) {
    throw new BookingError(
      'Booking could not be force-completed — its status changed concurrently',
      'INVALID_TRANSITION',
      409,
    )
  }

  // Closing an ASSERTED delivery is the ops half of the delivery_asserted branch. Stamp
  // who/when on pod_state (pod_strength stays 'asserted') and audit it. Guarded on the
  // source so a plain in_transit/accepted force-complete adds ZERO new DB calls — that
  // path is byte-identical to before. Both writes are best-effort (0025 may be absent).
  if (fromStatus === 'delivery_asserted') {
    await podRepo.markOpsClosedBestEffort(bookingId, actor.userId, log)
    await podRepo.appendAudit(
      { booking_id: bookingId, action: 'ops_closed', actor_user_id: actor.userId, actor_role: actor.role,
        detail: { from_status: fromStatus } },
      log,
    )
  }

  // Someone's trip just changed underneath them with neither party acting. Both
  // sides are told — an unexplained override is how a support fix becomes a
  // support ticket.
  await notify.emitOpsOverride(updated, 'force_complete', log)
  return { booking: updated, fromStatus }
}

export async function reassignBooking(
  bookingId: string,
  driverId: string,
  actor: AuthenticatedUser,
  log?: Logger,
): Promise<{ booking: DbBooking; fromDriverId: string | null }> {
  assertOps(actor)

  const booking = await repo.getBookingById(bookingId)
  if (!booking) {
    throw new BookingError(`Booking ${bookingId} not found`, 'NOT_FOUND', 404)
  }

  const driver = await repo.getDriverById(driverId)
  if (!driver) {
    throw new BookingError(`Driver ${driverId} not found`, 'NOT_FOUND', 404)
  }

  const fromDriverId = booking.driver_id
  const updated = await repo.reassignDriver(bookingId, driverId)
  if (!updated) {
    throw new BookingError(`Booking ${bookingId} not found`, 'NOT_FOUND', 404)
  }

  await notify.emitOpsOverride(updated, 'reassign', log)
  return { booking: updated, fromDriverId }
}

// -----------------------------------------------------------
// cancelBooking
// Shipper can cancel their own booking; driver can cancel
// only a booking assigned to them. Both can cancel from
// pending or accepted status.
// -----------------------------------------------------------

export async function cancelBooking(
  bookingId: string,
  actor: AuthenticatedUser,
  log?: Logger,
): Promise<DbBooking> {
  const booking = await repo.getBookingById(bookingId)
  if (!booking) {
    throw new BookingError(`Booking ${bookingId} not found`, 'NOT_FOUND', 404)
  }

  if (actor.role === 'shipper' && booking.shipper_id !== actor.userId) {
    throw new BookingError('Forbidden', 'FORBIDDEN', 403)
  }

  if (actor.role === 'driver') {
    const driverRow = await repo.getDriverByUserId(actor.userId)
    if (!driverRow || booking.driver_id !== driverRow.id) {
      throw new BookingError('Forbidden', 'FORBIDDEN', 403)
    }
  }

  assertValidTransition(booking.status, 'cancelled')

  const updated = await repo.cancelBooking(bookingId, ['pending', 'accepted'])
  if (!updated) {
    throw new BookingError(
      'Booking could not be cancelled — status may have changed',
      'INVALID_TRANSITION',
      409,
    )
  }

  // Tell whoever did NOT cancel. `updated` has already been nulled of nothing here —
  // driver_id survives the cancel — so the carrier is still resolvable. An admin
  // cancelling is treated as the shipper side, since the carrier is the party who
  // needs to stop planning for the load.
  await notify.emitBookingCancelled(updated, actor.role === 'driver' ? 'driver' : 'shipper', log)
  return updated
}
