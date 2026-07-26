// ============================================================
// src/lib/quote-service.ts
//
// Responsibility: all business logic for the auction &
// negotiation layer. Orchestrates quote-repository.ts and
// the existing repository.ts (for booking lookups / driver
// resolution). Every public function enforces role checks,
// ownership, and state-machine guards before touching the DB.
//
// A bid comes from a solo DRIVER or a FLEET OWNER (fleet.ts resolveBidder).
// Everything downstream of that resolution is shared: the state machine, the
// deadline rules and the shipper-side accept/reject path are identical for
// both kinds of bidder.
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
import {
  bidderOfQuote,
  isFleetAffiliatedDriver,
  isFleetOwnerActor,
  quoteBelongsTo,
  resolveBidder,
  resolveBidderOrNull,
  type Bidder,
} from './fleet.js'

// Minimal structural logger (same shape service.ts uses) so the negotiation-log
// fallback below can report without this module depending on Fastify.
type Logger = { warn(obj: unknown, msg: string): void }

// -----------------------------------------------------------
// recordNegotiation
// The negotiation log is a display/audit history; the quotes row is the
// source of truth for a bid. The live negotiations.actor_role CHECK predates
// the fleet persona and only allows shipper|driver, so a fleet-side entry can
// be rejected until that constraint is widened. Failing the whole bid on a
// rejected audit row would be worse than losing the row, so the FLEET side is
// best-effort + logged (the same pattern as the ops-override audit and the GPS
// breadcrumb). The driver/shipper sides still throw exactly as before.
// -----------------------------------------------------------

async function recordNegotiation(
  entry: Omit<DbNegotiation, 'id' | 'created_at'>,
  log?: Logger,
): Promise<void> {
  if (entry.actor_role !== 'fleet_owner') {
    await quoteRepo.createNegotiationEntry(entry)
    return
  }
  try {
    await quoteRepo.createNegotiationEntry(entry)
  } catch (err) {
    log?.warn(
      { err, quote_id: entry.quote_id, booking_id: entry.booking_id },
      'negotiation log entry rejected for a fleet bid (bid applied) — widen the negotiations.actor_role check',
    )
  }
}

// -----------------------------------------------------------
// submitQuote
// A solo driver or a fleet owner submits a price quote on a pending/open
// booking. For auction bookings the deadline is enforced server-side.
// For direct bookings the target_driver_id (if set) must match.
//
// A FLEET-AFFILIATED driver cannot bid at all (founder Q14): they do not
// self-select work, their owner bids and then assigns them the trip.
// -----------------------------------------------------------

export async function submitQuote(
  bookingId: string,
  body: SubmitQuoteBody,
  actor: AuthenticatedUser,
  log?: Logger,
): Promise<DbQuote> {
  if (actor.role !== 'driver' && !isFleetOwnerActor(actor)) {
    throw new BookingError('Only drivers or fleet owners can submit quotes', 'FORBIDDEN', 403)
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

  const bidder = await resolveBidder(actor)

  if (bidder.kind === 'driver' && await isFleetAffiliatedDriver(bidder.driverId)) {
    throw new BookingError(
      'You drive for a fleet — your fleet owner bids on loads and assigns them to you',
      'FORBIDDEN',
      403,
    )
  }

  // A direct booking aimed at one specific driver is not open to anyone else,
  // fleets included.
  if (booking.booking_type === 'direct' && booking.target_driver_id) {
    if (bidder.kind !== 'driver' || booking.target_driver_id !== bidder.driverId) {
      throw new BookingError('This booking is assigned to a different driver', 'FORBIDDEN', 403)
    }
  }

  const quote = await quoteRepo.createQuote(
    bookingId,
    bidder,
    body.amount,
    body.message ?? null,
  )

  await recordNegotiation({
    quote_id:   quote.id,
    booking_id: bookingId,
    actor_id:   actor.userId,
    actor_role: bidder.kind === 'fleet' ? 'fleet_owner' : 'driver',
    amount:     body.amount,
    message:    body.message ?? null,
  }, log)

  // Fire-and-forget notification
  jobs.notifyShipper(bookingId, 'NEW_QUOTE')

  return quote
}

// -----------------------------------------------------------
// counterQuote
// Either party (shipper, or the bidder — solo driver or fleet owner)
// proposes a new price on an existing quote. Creates a negotiation
// entry and notifies the other party.
// -----------------------------------------------------------

export async function counterQuote(
  bookingId: string,
  quoteId: string,
  body: CounterQuoteBody,
  actor: AuthenticatedUser,
  log?: Logger,
): Promise<DbQuote> {
  const actorIsFleetOwner = isFleetOwnerActor(actor)
  if (actor.role !== 'shipper' && actor.role !== 'driver' && !actorIsFleetOwner) {
    throw new BookingError('Only shippers, drivers or fleet owners can counter quotes', 'FORBIDDEN', 403)
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

  // Bidder side: the column the quote is owned through depends on WHO bid, so
  // compare against the resolved bidder rather than quote.driver_id directly.
  if (actor.role !== 'shipper') {
    const bidder = await resolveBidderOrNull(actor)
    if (!bidder || !quoteBelongsTo(quote, bidder)) {
      throw new BookingError('Forbidden', 'FORBIDDEN', 403)
    }
  }

  assertValidQuoteTransition(quote.status, 'countered')

  const updated = await quoteRepo.updateQuoteStatus(quoteId, 'countered', body.amount)
  if (!updated) {
    throw new BookingError('Quote could not be updated — it may have changed', 'INVALID_TRANSITION', 409)
  }

  await recordNegotiation({
    quote_id:   quoteId,
    booking_id: bookingId,
    actor_id:   actor.userId,
    actor_role: actorIsFleetOwner ? 'fleet_owner' : (actor.role as 'shipper' | 'driver'),
    amount:     body.amount,
    message:    body.message ?? null,
  }, log)

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
// Shipper awards a booking to a specific quote. Uses the atomic
// awardBooking guard to prevent double-awards. The shipper-side logic is
// identical for both kinds of bidder — only the column the winner is
// written into differs (see awardBooking).
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

  const awarded = await quoteRepo.awardBooking(bookingId, quoteId, bidderOfQuote(quote), quote.amount)
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
// The bidder withdraws their own quote — a solo driver their driver quote,
// a fleet owner their fleet quote. Only the quote owner can do this.
// -----------------------------------------------------------

export async function withdrawQuote(
  bookingId: string,
  quoteId: string,
  actor: AuthenticatedUser,
): Promise<DbQuote> {
  if (actor.role !== 'driver' && !isFleetOwnerActor(actor)) {
    throw new BookingError('Only drivers or fleet owners can withdraw quotes', 'FORBIDDEN', 403)
  }

  const quote = await quoteRepo.getQuoteById(quoteId)
  if (!quote || quote.booking_id !== bookingId) {
    throw new BookingError(`Quote ${quoteId} not found`, 'QUOTE_NOT_FOUND', 404)
  }

  const bidder = await resolveBidderOrNull(actor)
  if (!bidder || !quoteBelongsTo(quote, bidder)) {
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
// A bidder — solo driver or fleet owner — only sees its own quote
// (blind auction enforcement).
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

  let bidder: Bidder | undefined
  if (actor.role !== 'shipper' && actor.role !== 'admin') {
    bidder = (await resolveBidderOrNull(actor)) ?? undefined
  }

  return quoteRepo.listQuotesForBooking(bookingId, actor, bidder)
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

  if (actor.role !== 'shipper' && actor.role !== 'admin') {
    const bidder = await resolveBidderOrNull(actor)
    if (!bidder || !quoteBelongsTo(quote, bidder)) {
      throw new BookingError('Forbidden', 'FORBIDDEN', 403)
    }
  }

  return quoteRepo.listNegotiationsForQuote(quoteId)
}
