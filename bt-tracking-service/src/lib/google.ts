// Server-side Google Routes API client. Uses GOOGLE_MAPS_SERVER_KEY (secret).
// Field masks are MANDATORY (Routes API rejects calls without them and they cap
// cost). Route polyline uses staticDuration (Essentials); ETA uses TRAFFIC_AWARE
// (Pro) per decision D-003.

import { TrackingError, type Bounds, type LatLng } from './types.js'

const KEY = process.env.GOOGLE_MAPS_SERVER_KEY
if (!KEY) throw new Error('GOOGLE_MAPS_SERVER_KEY must be set')

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes'
// Places API (NEW). The legacy /maps/api/place/nearbysearch endpoint is BLOCKED for new
// GCP projects and is never referenced here (D-003).
const PLACES_NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby'

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

// ── Places API (New) — petrol pumps ──────────────────────────────────────────

export interface PetrolPump {
  place_id: string
  name: string
  lat: number
  lng: number
  distance_m: number
  address: string | null
  brand: string | null
}

/**
 * Nearest petrol pumps around a point (D-011: default top-8, ranked by distance).
 *
 * `rankPreference: 'DISTANCE'` makes Google do the ranking, so the field mask can stay
 * narrow — Places New bills by the fields you ask for, and `displayName`/`location`/
 * `formattedAddress` sit in the cheaper tiers. Never widen this mask casually.
 */
export async function searchPetrolPumps(
  centre: LatLng,
  radiusM: number,
  limit: number,
): Promise<Omit<PetrolPump, 'distance_m'>[]> {
  let res: Response
  try {
    res = await fetch(PLACES_NEARBY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': KEY!,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.location,places.formattedAddress,places.primaryTypeDisplayName',
      },
      body: JSON.stringify({
        includedTypes: ['gas_station'],
        maxResultCount: Math.min(Math.max(limit, 1), 20),
        rankPreference: 'DISTANCE',
        locationRestriction: {
          circle: {
            center: { latitude: centre.lat, longitude: centre.lng },
            radius: radiusM,
          },
        },
      }),
    })
  } catch (e) {
    throw new TrackingError(`Places API unreachable: ${(e as Error).message}`, 'UPSTREAM_ERROR', 502)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new TrackingError(`Places API error ${res.status}: ${text.slice(0, 200)}`, 'UPSTREAM_ERROR', 502)
  }

  const json = (await res.json()) as {
    places?: Array<{
      id?: string
      displayName?: { text?: string }
      location?: { latitude?: number; longitude?: number }
      formattedAddress?: string
      primaryTypeDisplayName?: { text?: string }
    }>
  }

  // A radius with no gas_station comes back as {} — an empty list, not an error.
  return (json.places ?? [])
    .filter((p) => p.id && typeof p.location?.latitude === 'number' && typeof p.location?.longitude === 'number')
    .map((p) => ({
      place_id: p.id!,
      name: p.displayName?.text ?? 'Petrol pump',
      lat: p.location!.latitude!,
      lng: p.location!.longitude!,
      address: p.formattedAddress ?? null,
      brand: p.primaryTypeDisplayName?.text ?? null,
    }))
}
