import type { AuthenticatedUser, BookingWithProfiles, CreateBookingBody, DbBooking } from './types.js'
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
