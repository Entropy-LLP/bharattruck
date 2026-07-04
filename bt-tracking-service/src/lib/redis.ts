import { Redis } from 'ioredis'

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

export const ROUTE_TTL_SECONDS = Number(process.env.ROUTE_CACHE_TTL_SECONDS ?? 21600) // 6h
export const ETA_TTL_SECONDS = 45
export const PUMPS_TTL_SECONDS = 21600
export const LOCK_TTL_SECONDS = 10
