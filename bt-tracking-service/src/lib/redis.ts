import { Redis } from 'ioredis'
import { positiveIntEnv } from './env.js'

const url = process.env.REDIS_URL
if (!url) throw new Error('REDIS_URL must be set')

export const redis = new Redis(url, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
})

// ── READ-ONLY keys owned by bt-booking-service (GPS ingestion) ──────────────
// NEVER write these from this service (contract §4, decision D-010).
export const driverLocationKey = (driverId: string) => `loc:driver:${driverId}`
export const bookingDriverKey = (bookingId: string) => `loc:booking-driver:${bookingId}`

// ── WRITE keys — bt-tracking-service namespace (trk:*) ──────────────────────
export const routeKey = (bookingId: string) => `trk:route:${bookingId}`
export const etaKey = (bookingId: string) => `trk:eta:${bookingId}`
export const pumpsKey = (bookingId: string) => `trk:pumps:${bookingId}`
export const lockKey = (key: string) => `trk:lock:${key}`
export const historyKey = (bookingId: string) => `trk:history:${bookingId}`
export const fleetOverviewKey = (fleetOwnerId: string) => `trk:fleet:${fleetOwnerId}`
/**
 * Which geofences the truck is currently INSIDE, for one booking.
 *
 * A pure cache — the durable answer is derivable from geofence_events (an 'enter' with no
 * later 'exit'), and the evaluator rebuilds from there on a miss. Redis only saves that
 * rebuild query on the hot path.
 */
export const fenceStateKey = (bookingId: string) => `trk:fence:${bookingId}`

export const ROUTE_TTL_SECONDS = positiveIntEnv('ROUTE_CACHE_TTL_SECONDS', 21600) // 6h
export const ETA_TTL_SECONDS = 45
export const PUMPS_TTL_SECONDS = 21600
export const LOCK_TTL_SECONDS = 10
/** §3.1 §4 pins /history at 15s; breadcrumbs land ~1/12s so a shorter TTL buys nothing. */
export const HISTORY_TTL_SECONDS = 15
/**
 * The fleet board polls every 10s per open dashboard. 8s keeps two owners' tabs from
 * multiplying the query load while staying inside one poll interval, so the board never
 * shows a position older than one tick beyond the GPS TTL itself.
 */
export const FLEET_OVERVIEW_TTL_SECONDS = 8
/** Longer than any realistic single trip — the state is deleted on trip end, not expiry. */
export const FENCE_STATE_TTL_SECONDS = 7 * 24 * 3600
