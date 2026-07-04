// ============================================================
// src/lib/quote-service.ts
//
// Responsibility: all business logic for the auction &
// negotiation layer. Orchestrates quote-repository.ts and
// the existing repository.ts (for booking lookups / driver
// resolution). Every public function enforces role checks,
// ownership, and state-machine guards before touching the DB.
// ============================================================

import type {
  AuthenticatedUser,
  CounterQuoteBody,
  DbBooking,
  DbNegotiation,
  DbQuote,
  SubmitQuoteBody,
} from './types.js'
import { BookingError } from './types.js'
import { assertValidQuoteTransition } from './state.js'
import * as repo from './repository.js'
import * as quoteRepo from './quote-repository.js'
import * as jobs from './jobs.js'

// -----------------------------------------------------------
// submitQuote
// A driver submits a price quote on a pending/open booking.
// For auction bookings the deadline is enforced server-side.
// For direct bookings the target_driver_id (if set) must match.
// -----------------------------------------------------------

export async function submitQuote(
  bookingId: string,
  body: SubmitQuoteBody,
  actor: AuthenticatedUser,
): Promise<DbQuote> {
  if (actor.role !== 'driver') {
    throw new BookingError('Only drivers can submit quotes', 'FORBIDDEN', 403)
  }

  const booking = await repo.getBookingById(bookingId)
  if (!booking) {
    throw new BookingError(`Booking ${bookingId} not found`, 'NOT_FOUND', 404)
  }

  if (booking.status !== 'pending' && booking.status !== 'negotiating') {
    throw new BookingError('Booking is not accepting quotes', 'AUCTION_CLOSED', 409)
  }

  if (booking.booking_type === 'auction' && booking.auction_deadline) {
    if (new Date(booking.auction_deadline) < new Date()) {
      throw new BookingError('Auction deadline has passed', 'AUCTION_CLOSED', 409)
    }
  }

  const driverRow = await repo.getDriverByUserId(actor.userId)
  if (!driverRow) {
    throw new BookingError('Driver profile not found', 'NOT_FOUND', 404)
  }

  if (booking.booking_type === 'direct' && booking.target_driver_id) {
    if (booking.target_driver_id !== driverRow.id) {
      throw new BookingError('This booking is assigned to a different driver', 'FORBIDDEN', 403)
    }
  }

  const quote = await quoteRepo.createQuote(
    bookingId,
    driverRow.id,
    body.amount,
    body.message ?? null,
  )

  await quoteRepo.createNegotiationEntry({
    quote_id:   quote.id,
    booking_id: bookingId,
    actor_id:   actor.userId,
    actor_role: 'driver',
    amount:     body.amount,
    message:    body.message ?? null,
  })

  // Fire-and-forget notification
  jobs.notifyShipper(bookingId, 'NEW_QUOTE')

  return quote
}

// -----------------------------------------------------------
// counterQuote
// Either party (shipper or driver) proposes a new price on
// an existing quote. Creates a negotiation entry and notifies
// the other party.
// -----------------------------------------------------------

export async function counterQuote(
  bookingId: string,
  quoteId: string,
  body: CounterQuoteBody,
  actor: AuthenticatedUser,
): Promise<DbQuote> {
  if (actor.role !== 'shipper' && actor.role !== 'driver') {
    throw new BookingError('Only shippers or drivers can counter quotes', 'FORBIDDEN', 403)
  }

  const quote = await quoteRepo.getQuoteById(quoteId)
  if (!quote || quote.booking_id !== bookingId) {
    throw new BookingError(`Quote ${quoteId} not found`, 'QUOTE_NOT_FOUND', 404)
  }

  const booking = await repo.getBookingById(bookingId)
  if (!booking) {
    throw new BookingError(`Booking ${bookingId} not found`, 'NOT_FOUND', 404)
  }

  if (actor.role === 'shipper' && booking.shipper_id !== actor.userId) {
    throw new BookingError('Forbidden', 'FORBIDDEN', 403)
  }

  if (actor.role === 'driver') {
    const driverRow = await repo.getDriverByUserId(actor.userId)
    if (!driverRow || quote.driver_id !== driverRow.id) {
      throw new BookingError('Forbidden', 'FORBIDDEN', 403)
    }
  }

  assertValidQuoteTransition(quote.status, 'countered')

  const updated = await quoteRepo.updateQuoteStatus(quoteId, 'countered', body.amount)
  if (!updated) {
    throw new BookingError('Quote could not be updated — it may have changed', 'INVALID_TRANSITION', 409)
  }

  await quoteRepo.createNegotiationEntry({
    quote_id:   quoteId,
    booking_id: bookingId,
    actor_id:   actor.userId,
    actor_role: actor.role as 'shipper' | 'driver',
    amount:     body.amount,
    message:    body.message ?? null,
  })

  // Notify the other party
  if (actor.role === 'shipper') {
    jobs.notifyDriver(bookingId)
  } else {
    jobs.notifyShipper(bookingId, 'COUNTER_OFFER')
  }

  return updated
}

// -----------------------------------------------------------
// acceptQuote
// Shipper awards a booking to a specific driver's quote.
// Uses the atomic awardBooking guard to prevent double-awards.
// -----------------------------------------------------------

export async function acceptQuote(
  bookingId: string,
  quoteId: string,
  actor: AuthenticatedUser,
): Promise<DbBooking> {
  if (actor.role !== 'shipper') {
    throw new BookingError('Only shippers can accept quotes', 'FORBIDDEN', 403)
  }

  const booking = await repo.getBookingById(bookingId)
  if (!booking) {
    throw new BookingError(`Booking ${bookingId} not found`, 'NOT_FOUND', 404)
  }

  if (booking.shipper_id !== actor.userId) {
    throw new BookingError('Forbidden', 'FORBIDDEN', 403)
  }

  const quote = await quoteRepo.getQuoteById(quoteId)
  if (!quote || quote.booking_id !== bookingId) {
    throw new BookingError(`Quote ${quoteId} not found`, 'QUOTE_NOT_FOUND', 404)
  }

  if (quote.status !== 'submitted' && quote.status !== 'countered') {
    throw new BookingError(
      `Cannot accept a quote with status '${quote.status}'`,
      'INVALID_TRANSITION',
      409,
    )
  }

  if (booking.awarded_quote_id) {
    throw new BookingError('Booking already has an awarded quote', 'ALREADY_AWARDED', 409)
  }

  const awarded = await quoteRepo.awardBooking(bookingId, quoteId, quote.driver_id, quote.amount)
  if (!awarded) {
    throw new BookingError('Booking was already awarded — race condition', 'ALREADY_AWARDED', 409)
  }

  // Fire-and-forget notifications + blockchain anchor
  jobs.notifyDriver(bookingId)
  jobs.anchorToBlockchain(bookingId, { event: 'AWARDED', quoteId, amount: quote.amount })

  return awarded
}

// -----------------------------------------------------------
// rejectQuote
// Shipper rejects a driver's quote. The quote becomes terminal.
// -----------------------------------------------------------

export async function rejectQuote(
  bookingId: string,
  quoteId: string,
  actor: AuthenticatedUser,
): Promise<DbQuote> {
  if (actor.role !== 'shipper') {
    throw new BookingError('Only shippers can reject quotes', 'FORBIDDEN', 403)
  }

  const booking = await repo.getBookingById(bookingId)
  if (!booking) {
    throw new BookingError(`Booking ${bookingId} not found`, 'NOT_FOUND', 404)
  }

  if (booking.shipper_id !== actor.userId) {
    throw new BookingError('Forbidden', 'FORBIDDEN', 403)
  }

  const quote = await quoteRepo.getQuoteById(quoteId)
  if (!quote || quote.booking_id !== bookingId) {
    throw new BookingError(`Quote ${quoteId} not found`, 'QUOTE_NOT_FOUND', 404)
  }

  assertValidQuoteTransition(quote.status, 'rejected')

  const updated = await quoteRepo.updateQuoteStatus(quoteId, 'rejected')
  if (!updated) {
    throw new BookingError('Quote could not be updated — it may have changed', 'INVALID_TRANSITION', 409)
  }

  jobs.notifyDriver(bookingId)

  return updated
}

// -----------------------------------------------------------
// withdrawQuote
// Driver withdraws their own quote. Only the quote owner can do this.
// -----------------------------------------------------------

export async function withdrawQuote(
  bookingId: string,
  quoteId: string,
  actor: AuthenticatedUser,
): Promise<DbQuote> {
  if (actor.role !== 'driver') {
    throw new BookingError('Only drivers can withdraw quotes', 'FORBIDDEN', 403)
  }

  const quote = await quoteRepo.getQuoteById(quoteId)
  if (!quote || quote.booking_id !== bookingId) {
    throw new BookingError(`Quote ${quoteId} not found`, 'QUOTE_NOT_FOUND', 404)
  }

  const driverRow = await repo.getDriverByUserId(actor.userId)
  if (!driverRow || quote.driver_id !== driverRow.id) {
    throw new BookingError('Forbidden', 'FORBIDDEN', 403)
  }

  assertValidQuoteTransition(quote.status, 'withdrawn')

  const updated = await quoteRepo.updateQuoteStatus(quoteId, 'withdrawn')
  if (!updated) {
    throw new BookingError('Quote could not be updated — it may have changed', 'INVALID_TRANSITION', 409)
  }

  return updated
}

// -----------------------------------------------------------
// listQuotes
// Returns quotes for a booking, scoped by the actor's role.
// Drivers only see their own quote (blind auction enforcement).
// -----------------------------------------------------------

export async function listQuotes(
  bookingId: string,
  actor: AuthenticatedUser,
): Promise<DbQuote[]> {
  const booking = await repo.getBookingById(bookingId)
  if (!booking) {
    throw new BookingError(`Booking ${bookingId} not found`, 'NOT_FOUND', 404)
  }

  if (actor.role === 'shipper' && booking.shipper_id !== actor.userId) {
    throw new BookingError('Forbidden', 'FORBIDDEN', 403)
  }

  let driverRowId: string | undefined
  if (actor.role === 'driver') {
    const driverRow = await repo.getDriverByUserId(actor.userId)
    driverRowId = driverRow?.id
  }

  return quoteRepo.listQuotesForBooking(bookingId, actor, driverRowId)
}

// -----------------------------------------------------------
// getQuoteHistory
// Returns the full negotiation log for a specific quote.
// Access is verified against the booking and quote ownership.
// -----------------------------------------------------------

export async function getQuoteHistory(
  bookingId: string,
  quoteId: string,
  actor: AuthenticatedUser,
): Promise<DbNegotiation[]> {
  const booking = await repo.getBookingById(bookingId)
  if (!booking) {
    throw new BookingError(`Booking ${bookingId} not found`, 'NOT_FOUND', 404)
  }

  if (actor.role === 'shipper' && booking.shipper_id !== actor.userId) {
    throw new BookingError('Forbidden', 'FORBIDDEN', 403)
  }

  const quote = await quoteRepo.getQuoteById(quoteId)
  if (!quote || quote.booking_id !== bookingId) {
    throw new BookingError(`Quote ${quoteId} not found`, 'QUOTE_NOT_FOUND', 404)
  }

  if (actor.role === 'driver') {
    const driverRow = await repo.getDriverByUserId(actor.userId)
    if (!driverRow || quote.driver_id !== driverRow.id) {
      throw new BookingError('Forbidden', 'FORBIDDEN', 403)
    }
  }

  return quoteRepo.listNegotiationsForQuote(quoteId)
}
