// Server-side Google Routes API client. Uses GOOGLE_MAPS_SERVER_KEY (secret).
// Field masks are MANDATORY (Routes API rejects calls without them and they cap
// cost). Route polyline uses staticDuration (Essentials); ETA uses TRAFFIC_AWARE
// (Pro) per decision D-003.

import { TrackingError, type Bounds, type LatLng } from './types.js'

const KEY = process.env.GOOGLE_MAPS_SERVER_KEY
if (!KEY) throw new Error('GOOGLE_MAPS_SERVER_KEY must be set')

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes'

function waypoint(p: LatLng) {
  return { location: { latLng: { latitude: p.lat, longitude: p.lng } } }
}

/** Routes API durations are strings like "1234s". */
function parseDurationSeconds(d?: string): number {
  if (!d) return 0
  return Math.round(parseFloat(d.replace('s', '')))
}

async function callRoutes(body: unknown, fieldMask: string): Promise<any> {
  let res: Response
  try {
    res = await fetch(ROUTES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': KEY!,
        'X-Goog-FieldMask': fieldMask,
      },
      body: JSON.stringify(body),
    })
  } catch (e) {
    throw new TrackingError(`Routes API unreachable: ${(e as Error).message}`, 'UPSTREAM_ERROR', 502)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new TrackingError(`Routes API error ${res.status}: ${text.slice(0, 200)}`, 'UPSTREAM_ERROR', 502)
  }
  return res.json()
}

export interface ComputedRoute {
  polyline: string
  distance_m: number
  static_duration_s: number
  bounds: Bounds
}

/** Cached route polyline (Essentials, traffic-unaware static duration). */
export async function computeRoute(origin: LatLng, dest: LatLng): Promise<ComputedRoute> {
  const json = await callRoutes(
    {
      origin: waypoint(origin),
      destination: waypoint(dest),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
      polylineEncoding: 'ENCODED_POLYLINE',
    },
    'routes.polyline.encodedPolyline,routes.distanceMeters,routes.staticDuration,routes.viewport',
  )

  const r = json.routes?.[0]
  if (!r) throw new TrackingError('No route found between pickup and drop', 'NOT_FOUND', 404)

  const vp = r.viewport ?? {}
  return {
    polyline: r.polyline?.encodedPolyline ?? '',
    distance_m: r.distanceMeters ?? 0,
    static_duration_s: parseDurationSeconds(r.staticDuration),
    bounds: {
      ne_lat: vp.high?.latitude ?? Math.max(origin.lat, dest.lat),
      ne_lng: vp.high?.longitude ?? Math.max(origin.lng, dest.lng),
      sw_lat: vp.low?.latitude ?? Math.min(origin.lat, dest.lat),
      sw_lng: vp.low?.longitude ?? Math.min(origin.lng, dest.lng),
    },
  }
}

export interface ComputedEta {
  eta_s: number
  remaining_m: number
  traffic: 'light' | 'moderate' | 'heavy' | 'unknown'
}

/** Live ETA from a point to the destination (Pro, traffic-aware). */
export async function computeEta(from: LatLng, dest: LatLng): Promise<ComputedEta> {
  const json = await callRoutes(
    {
      origin: waypoint(from),
      destination: waypoint(dest),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
    },
    'routes.duration,routes.staticDuration,routes.distanceMeters',
  )

  const r = json.routes?.[0]
  if (!r) throw new TrackingError('No route found to destination', 'NOT_FOUND', 404)

  const eta_s = parseDurationSeconds(r.duration)
  const static_s = parseDurationSeconds(r.staticDuration)
  let traffic: ComputedEta['traffic'] = 'unknown'
  if (static_s > 0) {
    const ratio = eta_s / static_s
    traffic = ratio < 1.15 ? 'light' : ratio < 1.4 ? 'moderate' : 'heavy'
  }
  return { eta_s, remaining_m: r.distanceMeters ?? 0, traffic }
}
