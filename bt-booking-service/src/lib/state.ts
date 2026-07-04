import type { BookingStatus, QuoteStatus } from './types.js'
import { BookingError } from './types.js'

// -----------------------------------------------------------
// VALID_TRANSITIONS
// Maps each status to its legal next states.
// Terminal states (completed, cancelled) have empty arrays.
// -----------------------------------------------------------

export const VALID_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending:      ['accepted', 'cancelled', 'negotiating'],
  negotiating:  ['accepted', 'cancelled'],
  accepted:     ['in_transit', 'cancelled'],
  in_transit:   ['completed'],
  completed:    [],
  cancelled:    [],
}

// -----------------------------------------------------------
// assertValidTransition
// Pure synchronous guard — throws BookingError on illegal moves.
// The repository executes the actual DB UPDATE after this passes.
// -----------------------------------------------------------

export function assertValidTransition(from: BookingStatus, to: BookingStatus): void {
  const allowed = VALID_TRANSITIONS[from]
  if (!allowed.includes(to)) {
    throw new BookingError(
      `Cannot transition booking from '${from}' to '${to}'`,
      'INVALID_TRANSITION',
      409,
    )
  }
}

// -----------------------------------------------------------
// AuctionStatus — high-level lifecycle for auction-mode bookings
// -----------------------------------------------------------

export type AuctionStatus = 'open' | 'negotiating' | 'awarded' | 'in_transit' | 'completed' | 'cancelled' | 'expired'

// -----------------------------------------------------------
// VALID_QUOTE_TRANSITIONS
// Maps each QuoteStatus to its legal next states.
// Terminal states (accepted, rejected, withdrawn, expired) are frozen.
// -----------------------------------------------------------

export const VALID_QUOTE_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  submitted:  ['countered', 'accepted', 'rejected', 'withdrawn', 'expired'],
  countered:  ['countered', 'accepted', 'rejected', 'withdrawn', 'expired'],
  accepted:   [],
  rejected:   [],
  withdrawn:  [],
  expired:    [],
}

// -----------------------------------------------------------
// assertValidQuoteTransition
// Pure synchronous guard — throws BookingError on illegal moves.
// -----------------------------------------------------------

export function assertValidQuoteTransition(from: QuoteStatus, to: QuoteStatus): void {
  const allowed = VALID_QUOTE_TRANSITIONS[from]
  if (!allowed.includes(to)) {
    throw new BookingError(
      `Cannot transition quote from '${from}' to '${to}'`,
      'INVALID_TRANSITION',
      409,
    )
  }
}
