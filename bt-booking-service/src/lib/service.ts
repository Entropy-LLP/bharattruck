import type { AuthenticatedUser, BookingStatus, BookingWithProfiles, CreateBookingBody, DbBooking } from './types.js'
import { BookingError } from './types.js'
import { assertFleetAssignmentReady, assertValidTransition } from './state.js'
import * as repo from './repository.js'
import {
  hasLiveVehicleAssignment,
  isFleetAffiliatedDriver,
  stripCommercialFields,
  type PriceMasked,
} from './fleet.js'
import { defaultPricingClient, type PricingClient } from './pricing-client.js'

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
// PRICE HIDING (founder Q16) — the one rule in this slice that reaches into an
// EXISTING driver payload, so it is gated as narrowly as possible.
//
// A driver employed by a fleet is not the commercial party on the trip: their
// owner bid and their owner gets paid, so they must not see quoted_price,
// final_price or min_acceptable. A SOLO driver is the commercial party and
// their payload must stay exactly as it is today — which is why the mask is
// applied only behind an explicit, positive isFleetAffiliatedDriver() answer
// (active affiliation only). No affiliation row, no drivers row, a non-driver
// role, or a database without the fleet tables all resolve to "solo" and
// return the untouched booking.
// -----------------------------------------------------------

async function fleetAffiliatedDriverId(actor: AuthenticatedUser): Promise<string | null> {
  if (actor.role !== 'driver') return null
  const driverRow = await repo.getDriverByUserId(actor.userId)
  if (!driverRow) return null
  return (await isFleetAffiliatedDriver(driverRow.id)) ? driverRow.id : null
}

// -----------------------------------------------------------
// getBooking
// Returns booking with driver profile joined.
// Shippers can only fetch their own bookings.
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
  if (await fleetAffiliatedDriverId(actor)) {
    return stripCommercialFields(booking)
  }
  return booking
}

// -----------------------------------------------------------
// listBookings
// Role-scoped filtering is handled inside the repository.
//
// One exception: a FLEET-AFFILIATED driver has no load board (founder Q14) —
// they cannot self-select work, so the open 'pending' list is replaced by the
// trips their owner has actually assigned to them, with the money masked. A
// solo driver still gets the same pending load board, unmasked.
// -----------------------------------------------------------

export async function listBookings(actor: AuthenticatedUser): Promise<PriceMasked<DbBooking>[]> {
  const fleetDriverId = await fleetAffiliatedDriverId(actor)
  if (!fleetDriverId) {
    return repo.listBookings(actor)
  }
  const assigned = await repo.listBookings(actor, fleetDriverId)
  return assigned.map(stripCommercialFields)
}

// -----------------------------------------------------------
// acceptBooking
// Only drivers can accept. Validates transition, resolves
// drivers.id from users.id, then performs the DB update.
// -----------------------------------------------------------

export async function acceptBooking(
  bookingId: string,
  actor: AuthenticatedUser,
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
  // closed to a fleet-employed driver for the same reason bidding is (Q14):
  // their work is assigned by their owner. Solo drivers are unaffected.
  if (await isFleetAffiliatedDriver(driverRow.id)) {
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
): Promise<DbBooking> {
  return transitionAssignedBooking(bookingId, actor, 'in_transit')
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

export type PodContext = {
  booking_id: string
  status: BookingStatus
  receiver_email: string | null
}

export async function getPodContext(
  bookingId: string,
  actor: AuthenticatedUser,
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

  return { booking_id: booking.id, status: booking.status, receiver_email: booking.receiver_email }
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

export async function completeBookingViaPod(bookingId: string): Promise<DbBooking> {
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

export async function markBookingPaid(bookingId: string): Promise<DbBooking> {
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

const OPS_FORCE_COMPLETE_SOURCES: BookingStatus[] = ['accepted', 'in_transit']

function assertOps(actor: AuthenticatedUser): void {
  if (actor.role !== 'admin') {
    throw new BookingError('Ops override requires an ops/admin role', 'FORBIDDEN', 403)
  }
}

export async function forceCompleteBooking(
  bookingId: string,
  actor: AuthenticatedUser,
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
  return { booking: updated, fromStatus }
}

export async function reassignBooking(
  bookingId: string,
  driverId: string,
  actor: AuthenticatedUser,
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
  return updated
}
