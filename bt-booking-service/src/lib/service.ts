import type { AuthenticatedUser, BookingStatus, BookingWithProfiles, CreateBookingBody, DbBooking } from './types.js'
import { BookingError } from './types.js'
import { assertValidTransition } from './state.js'
import * as repo from './repository.js'

// -----------------------------------------------------------
// createBooking
// Only shippers can create bookings.
// -----------------------------------------------------------

export async function createBooking(
  body: CreateBookingBody,
  actor: AuthenticatedUser,
): Promise<DbBooking> {
  if (actor.role !== 'shipper') {
    throw new BookingError('Only shippers can create bookings', 'FORBIDDEN', 403)
  }
  return repo.createBooking(body, actor)
}

// -----------------------------------------------------------
// getBooking
// Returns booking with driver profile joined.
// Shippers can only fetch their own bookings.
// -----------------------------------------------------------

export async function getBooking(
  id: string,
  actor: AuthenticatedUser,
): Promise<BookingWithProfiles> {
  const booking = await repo.getBookingById(id)
  if (!booking) {
    throw new BookingError(`Booking ${id} not found`, 'NOT_FOUND', 404)
  }
  if (actor.role === 'shipper' && booking.shipper_id !== actor.userId) {
    throw new BookingError('Forbidden', 'FORBIDDEN', 403)
  }
  return booking
}

// -----------------------------------------------------------
// listBookings
// Role-scoped filtering is handled inside the repository.
// -----------------------------------------------------------

export async function listBookings(actor: AuthenticatedUser): Promise<DbBooking[]> {
  return repo.listBookings(actor)
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
// startBooking / completeBooking
// Drive the trip lifecycle forward:
//   accepted   → in_transit   (driver starts the trip)
//   in_transit → completed    (transition exposed now; the
//                              POD/receiver-OTP-driven closure
//                              that *calls* this lands later)
// Only the assigned driver (drivers.id via getDriverByUserId)
// may transition. The state machine (assertValidTransition)
// enforces legal moves server-side and rejects illegal ones
// with a 4xx envelope, never a 500.
// -----------------------------------------------------------

export async function startBooking(
  bookingId: string,
  actor: AuthenticatedUser,
): Promise<DbBooking> {
  return transitionAssignedBooking(bookingId, actor, 'in_transit')
}

export async function completeBooking(
  bookingId: string,
  actor: AuthenticatedUser,
): Promise<DbBooking> {
  return transitionAssignedBooking(bookingId, actor, 'completed')
}

async function transitionAssignedBooking(
  bookingId: string,
  actor: AuthenticatedUser,
  to: 'in_transit' | 'completed',
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
