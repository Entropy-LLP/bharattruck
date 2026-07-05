/**
 * Maps helpers for the shipper live-tracking view.
 *
 * Per the FROZEN Maps & Tracking contract (docs/MAPS_TRACKING_CONTRACT.md):
 *  - Provider is Google Maps Platform; the browser layer uses
 *    `@vis.gl/react-google-maps` + the Maps JavaScript API only.
 *  - Env-key names are locked — use exactly these, and only the public
 *    browser key / map id are allowed behind `NEXT_PUBLIC_`. The secret
 *    server key (`GOOGLE_MAPS_SERVER_KEY`) lives in bt-tracking-service ONLY
 *    and must never appear in app code.
 *  - Per decision #8 this module is COPIED into each app (driver/, shipper/),
 *    not shared as a package.
 */

export interface LatLng {
  lat: number
  lng: number
}

/** HTTP-referrer-restricted browser key for the Maps JavaScript API. */
export const GOOGLE_MAPS_BROWSER_KEY =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? ''

/** Vector Map ID for styled maps (advanced markers need this). */
export const GOOGLE_MAPS_MAP_ID =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? ''

/**
 * Decode a Google "encoded polyline algorithm format" string into points.
 * Standard precision-5 encoding, matching what the Routes API returns via
 * `ENCODED_POLYLINE`. Reference:
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = []
  let index = 0
  let lat = 0
  let lng = 0
  const len = encoded.length

  while (index < len) {
    let result = 0
    let shift = 0
    let b: number
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    const dlat = result & 1 ? ~(result >> 1) : result >> 1
    lat += dlat

    result = 0
    shift = 0
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    const dlng = result & 1 ? ~(result >> 1) : result >> 1
    lng += dlng

    points.push({ lat: lat / 1e5, lng: lng / 1e5 })
  }

  return points
}

/** Linear interpolation between two points; `t` in [0, 1]. */
export function lerp(a: LatLng, b: LatLng, t: number): LatLng {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t
  return {
    lat: a.lat + (b.lat - a.lat) * clamped,
    lng: a.lng + (b.lng - a.lng) * clamped,
  }
}
