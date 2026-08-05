// ============================================================
// src/lib/fleet.ts
//
// Responsibility: everything bt-booking-service needs to know about the
// fleet-owner persona — who is bidding, whether a driver is fleet-controlled,
// and whether an awarded fleet booking has a truck+driver bound to it yet.
// The fleet's own CRUD (roster, vehicles, assignment) lives in bt-fleet-service;
// this file only answers the questions the booking flow has to ask.
//
// DESIGN RULE for this whole slice: a booking or driver with NO fleet
// involvement must take the code path it took before the persona existed. The
// fleet tables are consulted only to answer "is this actor fleet-controlled?",
// and a database where migrations 0015/0016 have not landed yet answers "no"
// rather than failing the request — the migrations are additive and may deploy
// after this code does.
//
// IDENTITY: fleet_owners.user_id references users.id (the JWT `userId`), while
// fleet_drivers.driver_id references drivers.id — a DIFFERENT row from users.id.
// ============================================================

import { supabase } from './supabase.js'
import type { AuthenticatedUser, DbBooking, DbQuote } from './types.js'
import { BookingError } from './types.js'
import * as repo from './repository.js'

// A fleet owner is a first-class role on the JWT (user_role enum, migration
// 014). Named here rather than compared inline so the several places asking
// "is the caller the owning party?" read the same way.
//
// Compared against the narrow UserRole union with NO widening cast on purpose:
// 'fleet_owner' is already a member of @bharattruck/shared's UserRole, so a cast
// here would only serve to keep this compiling if the label were ever dropped
// from the shared union — i.e. it would silently turn a real contract break into
// a comparison that can never be true. CI rebuilds this service on any
// packages/shared change, so the mismatch surfaces as a compile error instead.

export function isFleetOwnerActor(actor: AuthenticatedUser): boolean {
  return actor.role === 'fleet_owner'
}

// -----------------------------------------------------------
// Missing-relation tolerance. PostgREST reports an unknown table as 42P01
// (Postgres) or PGRST205 (schema-cache miss). Treating that as "the fleet
// feature is not deployed here" is what lets a solo driver's request behave
// identically on a pre-0015 database instead of 500ing on a table lookup.
// Every OTHER DB error still propagates, exactly like the other repositories.
// -----------------------------------------------------------

const MISSING_RELATION_CODES = new Set(['42P01', 'PGRST205'])

function isMissingRelation(error: { code?: string } | null): boolean {
  return !!error?.code && MISSING_RELATION_CODES.has(error.code)
}

// -----------------------------------------------------------
// Bidder — who is behind a quote. Mirrors the DB invariant
// `num_nonnulls(quotes.driver_id, quotes.fleet_owner_id) = 1`: a bid is from a
// solo driver OR a fleet, never both, never neither.
// -----------------------------------------------------------

export type Bidder =
  | { kind: 'driver'; driverId: string }
  | { kind: 'fleet';  fleetOwnerId: string }

// -----------------------------------------------------------
// getFleetOwnerByUserId
// Bridge: the JWT gives us users.id; every fleet column stores fleet_owners.id.
// -----------------------------------------------------------

export async function getFleetOwnerByUserId(userId: string): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('fleet_owners')
    .select('id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    if (isMissingRelation(error)) return null
    throw new Error(`Fleet owner lookup failed: ${error.message}`)
  }
  return data
}

// -----------------------------------------------------------
// resolveBidder
// Turns the authenticated actor into the party that will own the quote row.
// Drivers resolve to drivers.id (unchanged behaviour, unchanged errors); fleet
// owners resolve to fleet_owners.id. Anyone else cannot bid at all.
// -----------------------------------------------------------

export async function resolveBidder(actor: AuthenticatedUser): Promise<Bidder> {
  const bidder = await resolveBidderOrNull(actor)
  if (!bidder) {
    throw new BookingError(
      isFleetOwnerActor(actor) ? 'Fleet owner profile not found' : 'Driver profile not found',
      'NOT_FOUND',
      404,
    )
  }
  return bidder
}

// -----------------------------------------------------------
// resolveBidderOrNull
// Same resolution, but a MISSING party row answers null instead of throwing.
// The ownership checks (counter / withdraw / history) have always answered a
// missing profile with a plain 403 Forbidden, and keeping that shape is what
// makes those paths byte-identical for an existing driver.
// -----------------------------------------------------------

export async function resolveBidderOrNull(actor: AuthenticatedUser): Promise<Bidder | null> {
  if (isFleetOwnerActor(actor)) {
    const owner = await getFleetOwnerByUserId(actor.userId)
    return owner ? { kind: 'fleet', fleetOwnerId: owner.id } : null
  }

  if (actor.role === 'driver') {
    const driverRow = await repo.getDriverByUserId(actor.userId)
    return driverRow ? { kind: 'driver', driverId: driverRow.id } : null
  }

  throw new BookingError('Only drivers or fleet owners can bid on a booking', 'FORBIDDEN', 403)
}

// -----------------------------------------------------------
// bidderOfQuote / quoteBelongsTo
// Ownership checks used to compare quote.driver_id; with fleet bids the column
// to compare depends on which kind of bidder made the quote.
// -----------------------------------------------------------

export function bidderOfQuote(quote: DbQuote): Bidder {
  if (quote.fleet_owner_id) return { kind: 'fleet', fleetOwnerId: quote.fleet_owner_id }
  if (quote.driver_id)      return { kind: 'driver', driverId: quote.driver_id }
  // Unreachable while the quotes_exactly_one_bidder check holds; a bidderless
  // quote is corrupt data, not a client mistake.
  throw new BookingError('Quote has no bidder', 'INTERNAL', 500)
}

export function quoteBelongsTo(quote: DbQuote, bidder: Bidder): boolean {
  return bidder.kind === 'fleet'
    ? quote.fleet_owner_id === bidder.fleetOwnerId
    : quote.driver_id === bidder.driverId
}

// -----------------------------------------------------------
// isFleetAffiliatedDriver
//
// THE RULE (founder Q16 + Q14): a driver employed by a fleet is not the
// commercial party on the trip — the fleet owner bid, the fleet owner is paid.
// So an affiliated driver never sees the money on a booking (quoted_price,
// final_price, min_acceptable) and never self-selects work from the load board;
// their work arrives as an assignment from their owner.
//
// Deliberately keyed on status='active' ONLY. A 'pending' invite has not been
// accepted, and 'rejected'/'left'/'suspended' are not live employment — in all
// of those the driver is still a solo operator and MUST keep the unmodified
// solo behaviour. This narrow, explicit lookup is the gate that keeps the
// price-hiding rule from ever touching a solo driver.
// -----------------------------------------------------------

export async function isFleetAffiliatedDriver(driverId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('fleet_drivers')
    .select('id')
    .eq('driver_id', driverId)
    .eq('status', 'active')
    .limit(1)

  if (error) {
    if (isMissingRelation(error)) return false
    throw new Error(`Fleet affiliation lookup failed: ${error.message}`)
  }
  return (data?.length ?? 0) > 0
}

// -----------------------------------------------------------
// driverOwnsAnyVehicle
//
// Does this driver own a truck outright? `vehicles.driver_id` references
// drivers(id), and migration 0022 guarantees a vehicle has exactly one owner,
// so a hit here means unambiguous ownership — not "is driving", not "is
// assigned to", OWNS.
//
// This is the discriminator that separates a commercial partner from an
// employee (see isEmployedDriver below). It fails CLOSED to "owns nothing" on a
// missing relation, which preserves the pre-0022 behaviour exactly: on a
// database without the vehicles table every affiliated driver is an employee,
// which is what shipped before this change.
// -----------------------------------------------------------

export async function driverOwnsAnyVehicle(driverId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('id')
    .eq('driver_id', driverId)
    .limit(1)

  if (error) {
    if (isMissingRelation(error)) return false
    throw new Error(`Vehicle ownership lookup failed: ${error.message}`)
  }
  return (data?.length ?? 0) > 0
}

// -----------------------------------------------------------
// isEmployedDriver — THE gate for price-hiding and load-board removal.
//
// Replaces the bare isFleetAffiliatedDriver() check, which was too broad. The
// rule is now (docs/ARCHITECTURE_UNIFIED_IDENTITY.md §1.1):
//
//     Commercial visibility follows ASSET OWNERSHIP, not affiliation.
//
// A driver is an EMPLOYEE — money hidden, no load board — only when they are
// affiliated to a fleet AND own no truck of their own. That is the person the
// original rule was written for: their owner bids, their owner is paid, and
// work arrives as an assignment.
//
// An OWNER-DRIVER attached to a fleet is a different party entirely. They carry
// the truck's EMI, fuel, maintenance and downtime, so they are a stakeholder in
// what the trip earns, and hiding the money from them was simply wrong. They
// also keep the marketplace: affiliation ADDS a source of work, it does not
// replace self-selection. This is the Indian attached-vehicle model, which the
// affiliation-only check could not express.
//
// The affiliation lookup runs FIRST and short-circuits: a solo driver never
// reaches the vehicles query, so the common path costs exactly what it did
// before.
// -----------------------------------------------------------

export async function isEmployedDriver(driverId: string): Promise<boolean> {
  if (!(await isFleetAffiliatedDriver(driverId))) return false
  return !(await driverOwnsAnyVehicle(driverId))
}

// -----------------------------------------------------------
// hasLiveVehicleAssignment
// A live pairing is a vehicle_assignments row that has not been released.
// Only ever consulted for a booking that already carries fleet_owner_id, so a
// pre-migration database (which cannot hold such a booking) never reaches it.
// -----------------------------------------------------------

export async function hasLiveVehicleAssignment(bookingId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('vehicle_assignments')
    .select('id')
    .eq('booking_id', bookingId)
    .is('released_at', null)
    .limit(1)

  if (error) {
    if (isMissingRelation(error)) return false
    throw new Error(`Vehicle assignment lookup failed: ${error.message}`)
  }
  return (data?.length ?? 0) > 0
}

// -----------------------------------------------------------
// stripCommercialFields
// Removes the three money columns from a booking payload. Applied ONLY after
// isFleetAffiliatedDriver() has returned true, so a solo driver's payload is
// byte-identical to what it was before this slice.
// -----------------------------------------------------------

export type CommercialField = 'quoted_price' | 'final_price' | 'min_acceptable'

export type PriceMasked<T> = Omit<T, CommercialField>

export function stripCommercialFields<T extends Pick<DbBooking, CommercialField>>(
  booking: T,
): PriceMasked<T> {
  const { quoted_price: _q, final_price: _f, min_acceptable: _m, ...rest } = booking
  return rest
}
