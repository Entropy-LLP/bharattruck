// ============================================================
// src/lib/feed/service.ts
//
// GET /me/feed — the unified "what needs me right now?" action feed (D-38,
// docs/ARCHITECTURE_UNIFIED_IDENTITY.md §3.2 / §10.2).
//
// This is a READ-ONLY AGGREGATOR over sources that already exist. It introduces
// no new tables and no new architecture: it resolves the caller's capabilities
// ONCE, queries ONLY the sources those capabilities touch, and merges the results
// into one ranked, time-ordered list of typed, persona-tagged items.
//
// THE THREE PROPERTIES THAT MAKE IT SAFE TO SHIP:
//
//   1. Capability-scoped fan-out. A source runs only when the caller can(cap) —
//      a plain shipper never triggers a fleet query, a non-carrier never touches
//      the marketplace board. 'ship' is universal (everyone may post), so the
//      shipper sources always run but yield nothing for someone who has posted
//      nothing — which is exactly the single-persona case degrading to today's
//      home (§3.2).
//
//   2. No cross-user leakage. Every source is scoped to the caller's OWN identity
//      (user_id / driver_id / fleet_owner_id from their snapshot). The one shared
//      source is the open marketplace board, which is public to every carrier by
//      construction and carries no other human's private state (see
//      feed/repository.listOpenWork).
//
//   3. Graceful degradation. Each source runs inside its own guard; a source that
//      throws is logged and dropped, and the feed returns the OTHERS. The home
//      page must always render — a single broken query must never 500 the whole
//      surface. The failed source names come back in `degraded_sources` so the
//      client knows the view is partial.
// ============================================================

import { can, resolvePersonas, type PersonaSnapshot } from '@bharattruck/shared/personas'
import type { AuthenticatedUser, DbBooking } from '../types.js'
import { supabase } from '../supabase.js'
import { getActiveBookingsForDriver } from '../repository.js'
import { hasLiveVehicleAssignment } from '../fleet.js'
import * as feedRepo from './repository.js'
import { PRIORITY_RANK, type FeedItem, type FeedPage } from './types.js'

// Minimal structural logger (the shape service.ts and quote-service.ts already
// use) so this module stays independent of Fastify.
type Logger = { warn(obj: unknown, msg: string): void }

// A recent accept is news; a months-old one is not. Bounds the "X joined your
// fleet" source to seats answered inside this window.
const FLEET_JOIN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

export type FeedQuery = { limit?: number; offset?: number }

const route = (b: Pick<DbBooking, 'source_address' | 'destination_address'>): string =>
  `${b.source_address} → ${b.destination_address}`

// -----------------------------------------------------------
// The sort. Coarse priority band first (urgent above the rest), then most-recent
// first within a band, then id as a deterministic final tiebreak. That last key
// is what makes limit/offset pagination STABLE: two rows in the same band with the
// same timestamp always order the same way, so a page boundary never reshuffles
// between calls.
// -----------------------------------------------------------

function compareFeedItems(a: FeedItem, b: FeedItem): number {
  const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  if (byPriority !== 0) return byPriority
  if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? 1 : -1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

// ── Sources ──────────────────────────────────────────────────────────────────
// Each returns the items for ONE capability facet. They are pure of ranking and
// pagination (the assembler owns those) and pure of error handling (the assembler
// guards them), so each reads as just "the rows this facet contributes".

// ship: live bids on the caller's own loads, grouped per load into "N bids on X".
async function bidsReceived(snapshot: PersonaSnapshot): Promise<FeedItem[]> {
  const posted = await feedRepo.listActivePostedLoads(snapshot.user_id)
  if (posted.length === 0) return []
  const byId = new Map(posted.map((b) => [b.id, b]))

  const quotes = await feedRepo.listLiveQuotesForBookings([...byId.keys()])
  const grouped = new Map<string, { count: number; latest: string }>()
  for (const q of quotes) {
    const g = grouped.get(q.booking_id) ?? { count: 0, latest: '' }
    g.count += 1
    // updated_at moves on each counter; submitted_at is the floor for a fresh bid.
    const ts = q.updated_at ?? q.submitted_at
    if (ts > g.latest) g.latest = ts
    grouped.set(q.booking_id, g)
  }

  const items: FeedItem[] = []
  for (const [bookingId, g] of grouped) {
    const b = byId.get(bookingId)!
    items.push({
      id: `bids_received:${bookingId}`,
      type: 'bids_received',
      tag: 'shipper',
      title: `${g.count} ${g.count === 1 ? 'bid' : 'bids'} on ${route(b)}`,
      subtitle: 'Review the bids and award to move the load',
      timestamp: g.latest || b.updated_at,
      target: { booking_id: bookingId },
      priority: 'high',
    })
  }
  return items
}

// ship: in-transit loads that cannot close because they name no receiver inbox.
async function deliveryActions(snapshot: PersonaSnapshot): Promise<FeedItem[]> {
  const needy = await feedRepo.listShipperLoadsNeedingReceiver(snapshot.user_id)
  return needy.map((b) => ({
    id: `delivery_action:${b.id}`,
    type: 'delivery_action',
    tag: 'shipper',
    title: `Delivery contact needed — ${route(b)}`,
    subtitle: 'Add the receiver’s email so the driver can confirm delivery',
    timestamp: b.updated_at,
    target: { booking_id: b.id },
    // Urgent: the trip is physically stuck short of completed (and short of payout)
    // until this is supplied, and the shipper is the only party who can.
    priority: 'urgent',
  }))
}

// carry: the open marketplace board, minus the caller's own loads.
async function openWork(snapshot: PersonaSnapshot): Promise<FeedItem[]> {
  const board = await feedRepo.listOpenWork(snapshot.user_id)
  return board.map((b) => ({
    id: `open_work:${b.id}`,
    type: 'open_work',
    tag: 'carrier',
    title: `Load available — ${route(b)}`,
    subtitle: 'Open for bids on the marketplace',
    timestamp: b.created_at,
    target: { booking_id: b.id },
    // Low: this is opportunity, not an obligation — it sorts below anything that
    // actually needs the caller to act.
    priority: 'low',
  }))
}

// carry: the caller's bids the shipper has countered — needs a response.
async function counteredBids(snapshot: PersonaSnapshot): Promise<FeedItem[]> {
  const quotes = await feedRepo.listCounteredBidsForBidder(snapshot.driver_id, snapshot.fleet_owner_id)
  if (quotes.length === 0) return []
  const bookings = await feedRepo.getBookingsByIds([...new Set(quotes.map((q) => q.booking_id))])
  const byId = new Map(bookings.map((b) => [b.id, b]))

  return quotes.map((q) => {
    const b = byId.get(q.booking_id)
    return {
      id: `bid_countered:${q.id}`,
      type: 'bid_countered' as const,
      tag: 'carrier' as const,
      title: `Shipper countered your bid — ${b ? route(b) : 'open the negotiation'}`,
      subtitle: 'Respond to keep the negotiation alive',
      timestamp: q.updated_at,
      target: { booking_id: q.booking_id, quote_id: q.id },
      priority: 'high' as const,
    }
  })
}

// drive: the caller's assigned trips, split by where they are in the lifecycle.
async function driverTrips(snapshot: PersonaSnapshot): Promise<FeedItem[]> {
  const driverId = snapshot.driver_id
  if (!driverId) return []
  const active = await getActiveBookingsForDriver(driverId)

  const items: FeedItem[] = []
  for (const b of active) {
    if (b.status === 'accepted') {
      items.push({
        id: `trip_starting:${b.id}`,
        type: 'trip_starting',
        tag: 'driver',
        title: `Trip to ${b.destination_address} — pickup ${b.pickup_date}`,
        subtitle: `From ${b.source_address}. Start the trip when you reach pickup.`,
        timestamp: b.updated_at,
        target: { booking_id: b.id },
        priority: 'normal',
      })
    } else if (b.status === 'in_transit') {
      items.push({
        id: `trip_delivery:${b.id}`,
        type: 'trip_delivery',
        tag: 'driver',
        title: `Confirm delivery — ${route(b)}`,
        subtitle: 'Get the receiver’s OTP to close the trip',
        timestamp: b.updated_at,
        target: { booking_id: b.id },
        priority: 'high',
      })
    }
    // 'delivery_asserted' is deliberately silent: that trip is awaiting OPS, not
    // the driver — surfacing it as a driver action would ask them to redo a step
    // they already did.
  }
  return items
}

// operate: drivers who recently accepted a seat under the caller's fleet.
async function fleetDriversJoined(snapshot: PersonaSnapshot): Promise<FeedItem[]> {
  const fleetOwnerId = snapshot.fleet_owner_id
  if (!fleetOwnerId) return []
  const seats = await feedRepo.listActiveFleetDrivers(fleetOwnerId)

  const cutoff = Date.now() - FLEET_JOIN_WINDOW_MS
  const recent = seats.filter((s) => {
    const ts = s.responded_at ?? s.updated_at
    return ts ? new Date(ts).getTime() >= cutoff : false
  })
  if (recent.length === 0) return []

  const names = await feedRepo.driverNamesByIds(recent.map((s) => s.driver_id))
  return recent.map((s) => {
    const name = names.get(s.driver_id) ?? 'A driver'
    return {
      id: `fleet_driver_joined:${s.id}`,
      type: 'fleet_driver_joined' as const,
      tag: 'fleet' as const,
      title: `${name} joined your fleet`,
      subtitle: 'Assign them to a trip when work comes in',
      timestamp: (s.responded_at ?? s.updated_at),
      target: { fleet_driver_id: s.id },
      priority: 'normal' as const,
    }
  })
}

// operate: fleet-won loads with no truck paired to them yet.
async function trucksAwaitingAssignment(snapshot: PersonaSnapshot): Promise<FeedItem[]> {
  const fleetOwnerId = snapshot.fleet_owner_id
  if (!fleetOwnerId) return []
  const won = await feedRepo.listFleetBookingsAwaitingTruck(fleetOwnerId)
  if (won.length === 0) return []

  const items: FeedItem[] = []
  for (const b of won) {
    // N+1 over a fleet's handful of live awards (pilot scale). hasLiveVehicleAssignment
    // already tolerates a pre-migration DB by answering "no pairing", so a booking that
    // cannot yet have one degrades to "assign a truck" rather than throwing.
    if (await hasLiveVehicleAssignment(b.id)) continue
    items.push({
      id: `truck_assignment:${b.id}`,
      type: 'truck_assignment',
      tag: 'fleet',
      title: `Assign a truck — ${route(b)}`,
      subtitle: 'The trip cannot start until a truck and driver are paired',
      timestamp: b.updated_at,
      target: { booking_id: b.id },
      priority: 'high',
    })
  }
  return items
}

// -----------------------------------------------------------
// getFeed — resolve capabilities once, fan out only to the enabled sources,
// guard each one, merge, rank, paginate.
// -----------------------------------------------------------

export async function getFeed(
  actor: AuthenticatedUser,
  query: FeedQuery = {},
  log?: Logger,
): Promise<FeedPage> {
  // ONE snapshot for the whole feed — capabilities and the caller's identity ids
  // are read from here, never re-resolved per source.
  const snapshot = await resolvePersonas(supabase, actor.userId, actor.role)

  const limit = clamp(Math.trunc(query.limit ?? DEFAULT_LIMIT), 1, MAX_LIMIT)
  const offset = Math.max(0, Math.trunc(query.offset ?? 0))

  type Source = { name: string; enabled: boolean; run: () => Promise<FeedItem[]> }
  const sources: Source[] = [
    // 'ship' is universal; these yield nothing for a human who has posted nothing.
    { name: 'shipper.bids_received', enabled: can(snapshot, 'ship'), run: () => bidsReceived(snapshot) },
    { name: 'shipper.delivery_action', enabled: can(snapshot, 'ship'), run: () => deliveryActions(snapshot) },
    // Asset-gated: a non-carrier never touches the board or the bid queries.
    { name: 'carrier.open_work', enabled: can(snapshot, 'carry'), run: () => openWork(snapshot) },
    { name: 'carrier.bid_countered', enabled: can(snapshot, 'carry'), run: () => counteredBids(snapshot) },
    { name: 'driver.trips', enabled: can(snapshot, 'drive'), run: () => driverTrips(snapshot) },
    // Fleet-gated: a plain shipper triggers NO fleet query.
    { name: 'fleet.driver_joined', enabled: can(snapshot, 'operate'), run: () => fleetDriversJoined(snapshot) },
    { name: 'fleet.truck_assignment', enabled: can(snapshot, 'operate'), run: () => trucksAwaitingAssignment(snapshot) },
  ]

  const degraded: string[] = []
  const batches = await Promise.all(
    sources
      .filter((s) => s.enabled)
      .map(async (s) => {
        try {
          return await s.run()
        } catch (err) {
          // Degrade, do not fail: the home page must always render. The source is
          // dropped from this response and named in degraded_sources so the client
          // knows the view is partial.
          log?.warn({ err, source: s.name }, 'feed source failed — returning the other sources')
          degraded.push(s.name)
          return [] as FeedItem[]
        }
      }),
  )

  const all = batches.flat().sort(compareFeedItems)
  const page = all.slice(offset, offset + limit)
  return {
    items: page,
    total: all.length,
    limit,
    offset,
    next_offset: offset + limit < all.length ? offset + limit : null,
    degraded_sources: degraded,
  }
}
