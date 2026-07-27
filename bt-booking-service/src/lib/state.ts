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
  completed:    ['paid'],       // cash-recorded settlement closes the money loop
  paid:         [],
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
// assertFleetAssignmentReady
// Extra guard on accepted → in_transit for FLEET-won bookings only.
//
// A fleet may bid with no free truck (founder Q10), so the award leaves
// bookings.driver_id NULL and binds nothing physical. The owner then pairs a
// driver and a truck in bt-fleet-service, which writes the vehicle_assignments
// row. Until that row exists the trip has no truck of record, so its distance,
// fuel and per-asset P&L would be unattributable — hence the trip cannot start.
//
// Pure and synchronous like the transition guards above: the caller does the
// lookup and only for a booking that actually carries fleet_owner_id, so a solo
// booking (fleet_owner_id NULL) never reaches this function at all.
// -----------------------------------------------------------

export function assertFleetAssignmentReady(hasLiveAssignment: boolean): void {
  if (!hasLiveAssignment) {
    throw new BookingError(
      'This trip was won by a fleet and has no driver+truck assigned yet — ' +
      'the fleet owner must assign a driver and a truck before the trip can start',
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
