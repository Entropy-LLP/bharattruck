// ============================================================
// src/lib/quote-repository.ts
//
// Responsibility: all Supabase queries for the quotes and
// negotiations tables, plus the atomic awardBooking operation.
//
// ── REQUIRED MIGRATIONS ─────────────────────────────────────
//
//   ALTER TABLE bookings
//     ADD COLUMN IF NOT EXISTS booking_type text NOT NULL DEFAULT 'direct',
//     ADD COLUMN IF NOT EXISTS target_driver_id uuid REFERENCES drivers(id),
//     ADD COLUMN IF NOT EXISTS auction_deadline timestamptz,
//     ADD COLUMN IF NOT EXISTS min_acceptable numeric,
//     ADD COLUMN IF NOT EXISTS awarded_quote_id uuid,
//     ADD COLUMN IF NOT EXISTS dimensions_json jsonb;
//
//   CREATE TABLE IF NOT EXISTS quotes (
//     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//     booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
//     driver_id uuid NOT NULL REFERENCES drivers(id),
//     amount numeric NOT NULL CHECK (amount > 0),
//     message text,
//     status text NOT NULL DEFAULT 'submitted',
//     submitted_at timestamptz NOT NULL DEFAULT now(),
//     expires_at timestamptz,
//     updated_at timestamptz NOT NULL DEFAULT now(),
//     UNIQUE (booking_id, driver_id)
//   );
//
//   -- migration 016 then made quotes.driver_id NULLABLE and added
//   -- fleet_owner_id + a num_nonnulls(driver_id, fleet_owner_id) = 1 check,
//   -- so a bid can come from a fleet instead of a solo driver.
//
//   CREATE TABLE IF NOT EXISTS negotiations (
//     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//     quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
//     booking_id uuid NOT NULL REFERENCES bookings(id),
//     actor_id uuid NOT NULL REFERENCES users(id),
//     actor_role text NOT NULL CHECK (actor_role IN ('shipper','driver')),
//     amount numeric NOT NULL,
//     message text,
//     created_at timestamptz NOT NULL DEFAULT now()
//   );
//
// ============================================================

import { supabase } from './supabase.js'
import type { AuthenticatedUser, DbBooking, DbNegotiation, DbQuote, QuoteStatus } from './types.js'
import { BookingError } from './types.js'
import type { Bidder } from './fleet.js'

// -----------------------------------------------------------
// createQuote
// Inserts a new quote row for whichever party is bidding. If the
// UNIQUE(booking_id, driver_id) / one-live-bid-per-fleet constraint
// fires, we catch it and throw a domain error so callers get a clean
// DUPLICATE_QUOTE response.
//
// The two branches write DISJOINT columns (quotes_exactly_one_bidder
// enforces that) — a driver bid inserts exactly the same payload it
// always did, so nothing about the solo path moved.
// -----------------------------------------------------------

export async function createQuote(
  bookingId: string,
  bidder: Bidder,
  amount: number,
  message: string | null,
): Promise<DbQuote> {
  const bidderColumns = bidder.kind === 'fleet'
    ? { fleet_owner_id: bidder.fleetOwnerId }
    : { driver_id: bidder.driverId }

  const { data, error } = await supabase
    .from('quotes')
    .insert({
      booking_id: bookingId,
      ...bidderColumns,
      amount,
      message,
      status: 'submitted',
    })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new BookingError(
        bidder.kind === 'fleet'
          ? 'This fleet already has an active quote on this booking'
          : 'Driver already has an active quote',
        'DUPLICATE_QUOTE',
        409,
      )
    }
    throw new Error(`DB insert quote failed: ${error.message}`)
  }
  return data as DbQuote
}

// -----------------------------------------------------------
// getQuoteById
// Returns a single quote by primary key, or null on miss.
// -----------------------------------------------------------

export async function getQuoteById(quoteId: string): Promise<DbQuote | null> {
  const { data, error } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', quoteId)
    .maybeSingle()

  if (error) throw new Error(`DB select quote failed: ${error.message}`)
  return data as DbQuote | null
}

// -----------------------------------------------------------
// listQuotesForBooking
// Role-scoped: a bidder only sees its own quote (blind auction),
// shippers and admins see all quotes for the booking. `bidder` is the
// resolved identity of a driver/fleet-owner caller — absent for
// shippers and admins.
// -----------------------------------------------------------

export async function listQuotesForBooking(
  bookingId: string,
  actor: AuthenticatedUser,
  bidder?: Bidder,
): Promise<DbQuote[]> {
  let query = supabase
    .from('quotes')
    .select('*')
    .eq('booking_id', bookingId)
    .order('submitted_at', { ascending: false })

  if (actor.role !== 'shipper' && actor.role !== 'admin') {
    // Blind auction: a bidder we could not resolve to a party sees nothing.
    if (!bidder) {
      return []
    }
    query = bidder.kind === 'fleet'
      ? query.eq('fleet_owner_id', bidder.fleetOwnerId)
      : query.eq('driver_id', bidder.driverId)
  }
  // shipper and admin: no additional filter

  const { data, error } = await query
  if (error) throw new Error(`DB list quotes failed: ${error.message}`)
  return (data ?? []) as DbQuote[]
}

// -----------------------------------------------------------
// updateQuoteStatus
// Updates the quote's status (and optionally amount) with an
// optimistic concurrency approach — returns null if no row matched.
// -----------------------------------------------------------

export async function updateQuoteStatus(
  quoteId: string,
  status: QuoteStatus,
  newAmount?: number,
): Promise<DbQuote | null> {
  const updates: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  }
  if (newAmount !== undefined) {
    updates.amount = newAmount
  }

  const { data, error } = await supabase
    .from('quotes')
    .update(updates)
    .eq('id', quoteId)
    .select('*')
    .maybeSingle()

  if (error) throw new Error(`DB update quote failed: ${error.message}`)
  return data as DbQuote | null
}

// -----------------------------------------------------------
// createNegotiationEntry
// Append-only insert into the negotiations table. Each row is
// an immutable record of a price offer or counter-offer.
// -----------------------------------------------------------

export async function createNegotiationEntry(
  entry: Omit<DbNegotiation, 'id' | 'created_at'>,
): Promise<DbNegotiation> {
  const { data, error } = await supabase
    .from('negotiations')
    .insert({
      quote_id:   entry.quote_id,
      booking_id: entry.booking_id,
      actor_id:   entry.actor_id,
      actor_role: entry.actor_role,
      amount:     entry.amount,
      message:    entry.message,
    })
    .select('*')
    .single()

  if (error) throw new Error(`DB insert negotiation failed: ${error.message}`)
  return data as DbNegotiation
}

// -----------------------------------------------------------
// listNegotiationsForQuote
// Returns the full negotiation history for a quote, ordered
// chronologically (oldest first) so the conversation reads
// top-to-bottom.
// -----------------------------------------------------------

export async function listNegotiationsForQuote(quoteId: string): Promise<DbNegotiation[]> {
  const { data, error } = await supabase
    .from('negotiations')
    .select('*')
    .eq('quote_id', quoteId)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`DB list negotiations failed: ${error.message}`)
  return (data ?? []) as DbNegotiation[]
}

// -----------------------------------------------------------
// awardBooking
// Atomically binds the booking to the WINNING BIDDER and marks it
// accepted. The WHERE guard (status IN (...) AND awarded_quote_id IS
// NULL) ensures only one concurrent award call can succeed.
//
// A driver bid sets driver_id, exactly as before. A fleet bid sets
// fleet_owner_id and leaves driver_id NULL: the fleet may have bid with
// no free truck (founder Q10), so the driver and the truck are bound
// later by the owner's assignment step in bt-fleet-service — which is
// what the accepted → in_transit gate then checks for.
//
// Also marks the winning quote as 'accepted' and expires all
// other open quotes on this booking.
// -----------------------------------------------------------

export async function awardBooking(
  bookingId: string,
  quoteId: string,
  bidder: Bidder,
  finalPrice: number,
): Promise<DbBooking | null> {
  const winnerColumns = bidder.kind === 'fleet'
    ? { fleet_owner_id: bidder.fleetOwnerId }
    : { driver_id: bidder.driverId }

  // Step 1: atomically update the booking
  const { data, error } = await supabase
    .from('bookings')
    .update({
      ...winnerColumns,
      awarded_quote_id: quoteId,
      final_price:      finalPrice,
      status:           'accepted',
      updated_at:       new Date().toISOString(),
    })
    .eq('id', bookingId)
    .in('status', ['pending', 'negotiating'])
    .is('awarded_quote_id', null)
    .select('*')
    .maybeSingle()

  if (error) throw new Error(`DB award booking failed: ${error.message}`)
  if (!data) return null

  // Step 2: mark the winning quote as accepted
  const { error: acceptErr } = await supabase
    .from('quotes')
    .update({ status: 'accepted', updated_at: new Date().toISOString() })
    .eq('id', quoteId)

  if (acceptErr) throw new Error(`DB accept quote failed: ${acceptErr.message}`)

  // Step 3: expire all other open quotes on this booking
  const { error: expireErr } = await supabase
    .from('quotes')
    .update({ status: 'expired', updated_at: new Date().toISOString() })
    .eq('booking_id', bookingId)
    .neq('id', quoteId)
    .not('status', 'in', '(withdrawn,rejected,accepted)')

  if (expireErr) throw new Error(`DB expire quotes failed: ${expireErr.message}`)

  return data as DbBooking
}
