'use client'

/**
 * LiveTrackMap — the shipper's live-tracking map.
 *
 * FROZEN Maps & Tracking contract (docs/MAPS_TRACKING_CONTRACT.md):
 *  - Browser layer uses `@vis.gl/react-google-maps` + the Maps JavaScript API
 *    only (no legacy Directions/Places). The road polyline is computed
 *    server-side by bt-tracking-service (Routes API) and passed in already
 *    encoded — this component only DRAWS it.
 *  - Per decision #8 this component is COPIED into each app, not shared.
 *  - Only the public browser key / map id are read here (both `NEXT_PUBLIC_`).
 *    The secret server key never touches app code.
 *
 * Degrades gracefully: with no browser key it renders a pins-free placeholder
 * rather than crashing, so the surrounding booking page still works.
 */

import { useEffect, useMemo } from 'react'
import { APIProvider, Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps'
import {
  decodePolyline,
  lerp,
  GOOGLE_MAPS_BROWSER_KEY,
  GOOGLE_MAPS_MAP_ID,
  type LatLng,
} from '@/lib/maps'

interface LiveTrackMapProps {
  origin: LatLng
  dest: LatLng
  /** Encoded polyline of the base road route (from bt-tracking-service). */
  encodedPolyline?: string
  /** Current driver position; hidden when null/undefined. */
  driver?: LatLng | null
  className?: string
}

const DEFAULT_CLASS = 'h-[60vh] w-full rounded-2xl overflow-hidden'

export default function LiveTrackMap({
  origin,
  dest,
  encodedPolyline,
  driver,
  className,
}: LiveTrackMapProps) {
  const path = useMemo(
    () => (encodedPolyline ? decodePolyline(encodedPolyline) : []),
    [encodedPolyline],
  )
  const center = useMemo(() => lerp(origin, dest, 0.5), [origin, dest])

  if (!GOOGLE_MAPS_BROWSER_KEY) {
    return <MapUnavailable className={className} />
  }

  return (
    <div className={className ?? DEFAULT_CLASS}>
      <APIProvider apiKey={GOOGLE_MAPS_BROWSER_KEY}>
        <Map
          defaultCenter={center}
          defaultZoom={7}
          mapId={GOOGLE_MAPS_MAP_ID || undefined}
          gestureHandling="greedy"
          disableDefaultUI
          style={{ width: '100%', height: '100%' }}
        >
          <AdvancedMarker position={origin} title="Pickup">
            <Pin color="#16a34a" label="A" />
          </AdvancedMarker>
          <AdvancedMarker position={dest} title="Drop">
            <Pin color="#dc2626" label="B" />
          </AdvancedMarker>
          {driver && (
            <AdvancedMarker position={driver} title="Driver">
              <span style={{ fontSize: 30, lineHeight: 1 }}>🚚</span>
            </AdvancedMarker>
          )}
          <RouteOverlay path={path} origin={origin} dest={dest} />
        </Map>
      </APIProvider>
    </div>
  )
}

/**
 * Draws the road polyline and fits the viewport to the route (or, when no
 * polyline is available yet, to the pickup/drop pair). Uses the imperative
 * Maps JS API via the map instance from `useMap`.
 */
function RouteOverlay({
  path,
  origin,
  dest,
}: {
  path: LatLng[]
  origin: LatLng
  dest: LatLng
}) {
  const map = useMap()

  useEffect(() => {
    if (!map) return

    const line =
      path.length > 1
        ? new google.maps.Polyline({
            path,
            geodesic: false,
            strokeColor: '#2563eb',
            strokeOpacity: 0.9,
            strokeWeight: 4,
          })
        : null
    line?.setMap(map)

    const bounds = new google.maps.LatLngBounds()
    const pts = path.length > 1 ? path : [origin, dest]
    pts.forEach((p) => bounds.extend(p))
    if (!bounds.isEmpty()) map.fitBounds(bounds, 48)

    return () => {
      line?.setMap(null)
    }
  }, [map, path, origin, dest])

  return null
}

function Pin({ color, label }: { color: string; label: string }) {
  return (
    <div
      style={{
        width: 26,
        height: 26,
        borderRadius: '50% 50% 50% 0',
        transform: 'rotate(-45deg)',
        background: color,
        border: '2px solid white',
        boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span
        style={{
          transform: 'rotate(45deg)',
          color: 'white',
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {label}
      </span>
    </div>
  )
}

function MapUnavailable({ className }: { className?: string }) {
  return (
    <div
      className={className ?? DEFAULT_CLASS}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f1f5f9',
        color: '#64748b',
        fontSize: 13,
        textAlign: 'center',
        padding: 16,
      }}
    >
      Live map unavailable — map key not configured.
    </div>
  )
}
