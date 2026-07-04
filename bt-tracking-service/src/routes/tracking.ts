import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  redis,
  driverLocationKey,
  routeKey,
  etaKey,
  ROUTE_TTL_SECONDS,
  ETA_TTL_SECONDS,
} from '../lib/redis.js'
import { getOrCompute, computeAndSet } from '../lib/cache.js'
import { computeRoute, computeEta, type ComputedRoute } from '../lib/google.js'
import {
  getBookingForTracking,
  getDriverByUserId,
  upsertTripRoute,
  getAlerts,
} from '../lib/repository.js'
import {
  TrackingError,
  type AuthenticatedUser,
  type TrackingBooking,
  type LiveLocation,
} from '../lib/types.js'

const BookingIdParam = z.object({ bookingId: z.string().uuid() })

function parseBookingId(params: unknown): string {
  const parsed = BookingIdParam.safeParse(params)
  if (!parsed.success) throw new TrackingError('Invalid bookingId', 'VALIDATION_ERROR', 400)
  return parsed.data.bookingId
}

async function loadBookingOrThrow(bookingId: string): Promise<TrackingBooking> {
  const booking = await getBookingForTracking(bookingId)
  if (!booking) throw new TrackingError(`Booking ${bookingId} not found`, 'NOT_FOUND', 404)
  return booking
}

// Authz: caller must be the booking's shipper or its assigned driver (admin allowed).
async function assertCanAccess(booking: TrackingBooking, user: AuthenticatedUser): Promise<void> {
  if (user.role === 'admin') return
  if (user.role === 'shipper') {
    if (booking.shipper_id !== user.userId) throw new TrackingError('Forbidden', 'FORBIDDEN', 403)
    return
  }
  if (user.role === 'driver') {
    const driver = await getDriverByUserId(user.userId)
    if (!driver || booking.driver_id !== driver.id) {
      throw new TrackingError('Forbidden', 'FORBIDDEN', 403)
    }
    return
  }
  throw new TrackingError('Forbidden', 'FORBIDDEN', 403)
}

// READ-ONLY: live fix written by bt-booking-service into loc:driver:{id}.
async function getLiveLocation(driverId: string): Promise<LiveLocation | null> {
  const raw = await redis.get(driverLocationKey(driverId))
  return raw ? (JSON.parse(raw) as LiveLocation) : null
}

function fmtDuration(seconds: number): string {
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const mm = m % 60
  return mm ? `${h} hr ${mm} min` : `${h} hr`
}

function routeResponse(route: ComputedRoute, cached: boolean) {
  return {
    polyline: route.polyline,
    distance_m: route.distance_m,
    static_duration_s: route.static_duration_s,
    bounds: route.bounds,
    cached,
  }
}

async function computeRouteFor(booking: TrackingBooking): Promise<ComputedRoute> {
  const route = await computeRoute(
    { lat: booking.source_lat, lng: booking.source_lng },
    { lat: booking.dest_lat, lng: booking.dest_lng },
  )
  // Durable backup — best-effort; a DB hiccup must not fail the response.
  await upsertTripRoute(booking.id, route).catch(() => {})
  return route
}

type EtaData = {
  eta_s: number
  eta_text: string
  remaining_m: number
  traffic: string
  computed_at: string
  stale: boolean
}

async function freshEta(booking: TrackingBooking, live: LiveLocation): Promise<EtaData> {
  const e = await computeEta(
    { lat: live.lat, lng: live.lng },
    { lat: booking.dest_lat, lng: booking.dest_lng },
  )
  const data: EtaData = {
    eta_s: e.eta_s,
    eta_text: fmtDuration(e.eta_s),
    remaining_m: e.remaining_m,
    traffic: e.traffic,
    computed_at: new Date().toISOString(),
    stale: false,
  }
  await redis.set(etaKey(booking.id), JSON.stringify(data), 'EX', ETA_TTL_SECONDS)
  return data
}

export async function trackingRoutes(app: FastifyInstance) {
  // #1 POST /tracking/route/:bookingId — force compute + cache
  app.post('/route/:bookingId', async (req, reply) => {
    const bookingId = parseBookingId(req.params)
    const booking = await loadBookingOrThrow(bookingId)
    await assertCanAccess(booking, req.user)

    const route = await computeAndSet(routeKey(bookingId), ROUTE_TTL_SECONDS, () => computeRouteFor(booking))
    return reply.send({ success: true, data: routeResponse(route, false) })
  })

  // #2 GET /tracking/route/:bookingId — cached (computes if missing)
  app.get('/route/:bookingId', async (req, reply) => {
    const bookingId = parseBookingId(req.params)
    const booking = await loadBookingOrThrow(bookingId)
    await assertCanAccess(booking, req.user)

    const { value, cached } = await getOrCompute(routeKey(bookingId), ROUTE_TTL_SECONDS, () =>
      computeRouteFor(booking),
    )
    return reply.send({ success: true, data: routeResponse(value, cached) })
  })

  // #3 GET /tracking/eta/:bookingId — traffic-aware live ETA (Pro tier, D-003)
  app.get('/eta/:bookingId', async (req, reply) => {
    const bookingId = parseBookingId(req.params)
    const booking = await loadBookingOrThrow(bookingId)
    await assertCanAccess(booking, req.user)

    const live = booking.driver_id ? await getLiveLocation(booking.driver_id) : null
    if (live) {
      return reply.send({ success: true, data: await freshEta(booking, live) })
    }
    // Offline: return the last cached ETA, marked stale (contract §3).
    const cached = await redis.get(etaKey(bookingId))
    if (cached) {
      return reply.send({ success: true, data: { ...(JSON.parse(cached) as EtaData), stale: true } })
    }
    throw new TrackingError('Driver location unavailable', 'NO_LOCATION', 404)
  })

  // #8 GET /tracking/track/:bookingId — the read-through (location + route + eta)
  app.get('/track/:bookingId', async (req, reply) => {
    const bookingId = parseBookingId(req.params)
    const booking = await loadBookingOrThrow(bookingId)
    await assertCanAccess(booking, req.user)

    const live = booking.driver_id ? await getLiveLocation(booking.driver_id) : null
    const { value: route } = await getOrCompute(routeKey(bookingId), ROUTE_TTL_SECONDS, () =>
      computeRouteFor(booking),
    )

    // ETA: reuse the cached value (TTL 45s) if present; else compute when live.
    let eta: EtaData | null = null
    const cachedEta = await redis.get(etaKey(bookingId))
    if (cachedEta) {
      eta = { ...(JSON.parse(cachedEta) as EtaData), stale: !live }
    } else if (live) {
      eta = await freshEta(booking, live)
    }

    const alerts = await getAlerts(bookingId)

    return reply.send({
      success: true,
      data: {
        booking_id: booking.id,
        status: booking.status,
        location: live
          ? {
              lat: live.lat,
              lng: live.lng,
              heading: live.heading,
              speed_kmh: live.speed_kmh,
              updated_at: live.updated_at,
            }
          : null,
        route: { polyline: route.polyline, distance_m: route.distance_m, bounds: route.bounds },
        eta,
        destination: { lat: booking.dest_lat, lng: booking.dest_lng },
        alerts,
      },
    })
  })
}
