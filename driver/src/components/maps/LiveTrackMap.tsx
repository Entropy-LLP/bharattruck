'use client'

/**
 * LiveTrackMap — the DRIVER's navigation map.
 *
 * Copied from shipper/src/components/maps/LiveTrackMap.tsx per D-013 (copied per app, never
 * a shared package) and then deliberately diverged, because the two personas are opposites:
 *
 *   shipper — watching someone else's truck. Position must come from the SERVER (they have
 *             no other source), so it polls /api/tracking/track every 10 s, and the camera
 *             frames the whole route because they care about progress, not the next turn.
 *
 *   driver  — IS the truck. Their position comes from `navigator.geolocation` in their own
 *             hand: instant, free, and — critically — it keeps working when the network does
 *             not, which on an Indian interstate corridor is most of the interesting moments.
 *             Round-tripping their own location through Cloud Run to draw it back on their
 *             own screen would add latency and cost for strictly worse data. So this
 *             component takes `self` as a prop from the live GPS watch that already runs for
 *             ingestion, and the camera FOLLOWS the truck.
 *
 * FROZEN Maps & Tracking contract:
 *  - `@vis.gl/react-google-maps` + Maps JavaScript API only. No legacy Directions/Places.
 *  - The road polyline is computed SERVER-side by bt-tracking-service (Routes API) and
 *    passed in already encoded; this component only DRAWS it. It never calls Google itself.
 *  - Navigation is a DEEP-LINK handoff (D-004). There is no in-app turn-by-turn here and
 *    there must never be — this map orients, it does not guide.
 *  - Only the public `NEXT_PUBLIC_` browser key / map id are read. The secret server key
 *    never touches app code.
 *
 * Degrades in three stages, because a driver mid-trip cannot be shown a broken screen:
 * no key -> panel; Google rejects the key or never paints -> panel (map-guard); no GPS fix
 * yet -> the route still draws with the truck marker hidden.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  APIProvider,
  Map,
  AdvancedMarker,
  AdvancedMarkerAnchorPoint,
  useMap,
} from '@vis.gl/react-google-maps'
import { Crosshair, MapPin } from 'lucide-react'
import {
  decodePolyline,
  lerp,
  GOOGLE_MAPS_BROWSER_KEY,
  GOOGLE_MAPS_MAP_ID,
  type LatLng,
  type MapBounds,
} from '@/lib/maps'
import { MapBoundary, useMapsAuthFailed, useMapRenderWatchdog } from './map-guard'

export interface PumpMarker {
  place_id: string
  name: string
  lat: number
  lng: number
}

interface LiveTrackMapProps {
  origin: LatLng
  dest: LatLng
  /** Encoded polyline of the base road route (from bt-tracking-service). */
  encodedPolyline?: string
  /** Route viewport, used for the initial framing only. */
  bounds?: MapBounds
  /** The driver's OWN live position, straight from the device. Null until first fix. */
  self?: LatLng | null
  /** Device heading in degrees, when the GPS reports one. Rotates the truck marker. */
  heading?: number | null
  /** Petrol pumps to overlay; empty unless the driver has asked for them. */
  pumps?: PumpMarker[]
  className?: string
}

const DEFAULT_CLASS = 'h-[42vh] w-full rounded-2xl overflow-hidden'

export default function LiveTrackMap({
  origin,
  dest,
  encodedPolyline,
  bounds,
  self,
  heading,
  pumps = [],
  className,
}: LiveTrackMapProps) {
  const authFailed = useMapsAuthFailed()
  const { timedOut, onReady, retry } = useMapRenderWatchdog()

  // Follow state lives HERE, not inside the map, because the recentre button must render in
  // the wrapper below. A button returned as a child of <Map> has no guaranteed positioned
  // ancestor, so `absolute` would resolve against whatever happens to be up the tree.
  const [following, setFollowing] = useState(true)
  const mapRef = useRef<google.maps.Map | null>(null)

  const path = useMemo(
    () => (encodedPolyline ? decodePolyline(encodedPolyline) : []),
    [encodedPolyline],
  )
  // Start framed on the truck when we already have it, else the midpoint of the lane.
  const center = useMemo(() => self ?? lerp(origin, dest, 0.5), [self, origin, dest])

  if (!GOOGLE_MAPS_BROWSER_KEY) {
    return <MapUnavailable className={className} detail="Map key not configured for this build." />
  }
  if (authFailed || timedOut) {
    return (
      <MapUnavailable
        className={className}
        detail={
          authFailed
            ? 'Google would not load the map here. Navigation still works.'
            : 'The map is taking too long to load — you may be on a weak signal.'
        }
        // Only a timeout is retryable. A rejected key will not fix itself, and offering a
        // dead button would just waste taps at the roadside.
        onRetry={authFailed ? undefined : retry}
      />
    )
  }

  return (
    <div className={`relative ${className ?? DEFAULT_CLASS}`}>
      <MapBoundary
        fallback={<MapUnavailable className={className} detail="The map could not be drawn." />}
      >
        <APIProvider apiKey={GOOGLE_MAPS_BROWSER_KEY}>
          <Map
            defaultCenter={center}
            defaultZoom={self ? 14 : 7}
            mapId={GOOGLE_MAPS_MAP_ID || undefined}
            // COOPERATIVE, not "greedy". This map is embedded mid-page in a scrolling
            // mobile view: with "greedy" the map swallows one-finger drags, so a thumb
            // landing anywhere on it stops the page scrolling and the driver cannot reach
            // Mark as Delivered below. Cooperative pans on two fingers and lets a
            // one-finger drag scroll the page, which is the right default for an embedded
            // map. (The shipper copy uses greedy because its map is the whole screen.)
            gestureHandling="cooperative"
            disableDefaultUI
            style={{ width: '100%', height: '100%' }}
          >
            <AdvancedMarker position={origin} title="Pickup">
              <Pin color="#16a34a" label="A" />
            </AdvancedMarker>
            <AdvancedMarker position={dest} title="Drop">
              <Pin color="#dc2626" label="B" />
            </AdvancedMarker>

            {/* anchorPoint CENTER on both of these, and it is not cosmetic. AdvancedMarker
                anchors its content BOTTOM-centre by default, which is right for the teardrop
                A/B pins (their tip is the point) but wrong for a round puck: the circle would
                float a full marker-height ABOVE the real coordinate. On the driver's own
                position that is a silent ~15 px lie about where they are, and at map zoom it
                is exactly the error that makes someone miss a turn. */}
            {pumps.map((p) => (
              <AdvancedMarker
                key={p.place_id}
                position={{ lat: p.lat, lng: p.lng }}
                title={p.name}
                anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
              >
                <PumpPin />
              </AdvancedMarker>
            ))}

            {self && (
              <AdvancedMarker
                position={self}
                title="You"
                anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
              >
                <SelfPin heading={heading ?? null} />
              </AdvancedMarker>
            )}

            <RouteOverlay
              path={path}
              origin={origin}
              dest={dest}
              bounds={bounds}
              onReady={onReady}
              hasSelf={!!self}
            />
            <FollowCamera
              self={self ?? null}
              following={following}
              onUserPan={() => setFollowing(false)}
              onMap={(m) => {
                mapRef.current = m
              }}
            />
          </Map>
        </APIProvider>
      </MapBoundary>

      {!following && self && (
        <button
          type="button"
          onClick={() => {
            setFollowing(true)
            mapRef.current?.panTo(self)
          }}
          aria-label="Recentre the map on my position"
          className="absolute bottom-3 right-3 h-11 w-11 rounded-full bg-card/95 border border-border shadow-lg flex items-center justify-center active:scale-95 transition-transform"
        >
          <Crosshair className="h-5 w-5 text-foreground" />
        </button>
      )}
    </div>
  )
}

/**
 * Draws the road polyline and frames the route ONCE.
 *
 * Deliberately fits the viewport only on the first render that has geometry. The shipper's
 * copy refits whenever its inputs change, which is right for a passive observer — but here
 * the driver is panning the map with one hand at a dhaba, and a refit on every GPS tick
 * would rip the camera back and make the map unusable.
 */
function RouteOverlay({
  path,
  origin,
  dest,
  bounds,
  onReady,
  hasSelf,
}: {
  path: LatLng[]
  origin: LatLng
  dest: LatLng
  bounds?: MapBounds
  onReady: () => void
  /** When true the driver has a fix, so FollowCamera owns the camera instead. */
  hasSelf: boolean
}) {
  const map = useMap()
  const framed = useRef(false)

  useEffect(() => {
    if (!map) return
    const listener = map.addListener('tilesloaded', onReady)
    return () => listener.remove()
  }, [map, onReady])

  useEffect(() => {
    if (!map) return

    const line =
      path.length > 1
        ? new google.maps.Polyline({
            path,
            geodesic: false,
            strokeColor: '#8b5cf6',
            strokeOpacity: 0.9,
            strokeWeight: 5,
          })
        : null
    line?.setMap(map)

    // Frame the whole corridor ONLY while we do not know where the driver is. Once there is
    // a fix, FollowCamera takes over at navigation zoom — fitting a 1,134 km route would
    // otherwise zoom the driver out to a country view, which tells them nothing about the
    // road ahead. (This is also why `defaultZoom` alone was never enough: fitBounds ran
    // immediately after and overrode it.)
    if (!framed.current && !hasSelf) {
      const box = new google.maps.LatLngBounds()
      if (bounds) {
        box.extend({ lat: bounds.sw_lat, lng: bounds.sw_lng })
        box.extend({ lat: bounds.ne_lat, lng: bounds.ne_lng })
      } else {
        const pts = path.length > 1 ? path : [origin, dest]
        pts.forEach((p) => box.extend(p))
      }
      if (!box.isEmpty()) {
        map.fitBounds(box, 40)
        framed.current = true
      }
    }

    return () => {
      line?.setMap(null)
    }
    // Depends on the COORDINATES, not on the origin/dest object identities.
    //
    // The parent memoises both, but this list is the load-bearing guard: a caller passing
    // `origin={{lat, lng}}` inline creates a new object every render, and every GPS fix
    // re-renders. With object deps that tears down and rebuilds the Polyline on each fix —
    // 7,471 vertices on the Nagpur-Delhi lane — which burns CPU on a cheap Android and
    // visibly flickers the route out from under the driver.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, path, origin.lat, origin.lng, dest.lat, dest.lng, bounds, hasSelf])

  return null
}

/**
 * Keeps the truck on screen, without stealing the map from the driver.
 *
 * Follow mode turns itself OFF the moment the driver drags the map (they are looking at
 * something — the next fuel stop, the route ahead) and comes back only when they tap the
 * recentre button. A camera that always snaps back is worse than no follow at all: it makes
 * the map impossible to read while moving, which is precisely when it is needed.
 */
function FollowCamera({
  self,
  following,
  onUserPan,
  onMap,
}: {
  self: LatLng | null
  following: boolean
  onUserPan: () => void
  onMap: (m: google.maps.Map | null) => void
}) {
  const map = useMap()

  useEffect(() => {
    onMap(map)
    return () => onMap(null)
  }, [map, onMap])

  useEffect(() => {
    if (!map) return
    // `dragstart` fires only for user gestures — the programmatic panTo below does not
    // trip it, so following survives its own camera moves.
    const listener = map.addListener('dragstart', onUserPan)
    return () => listener.remove()
  }, [map, onUserPan])

  const zoomed = useRef(false)

  useEffect(() => {
    if (!map || !self || !following) return
    map.panTo(self)
    // Zoom in ONCE, on the first fix. Doing it on every fix would fight the driver's own
    // pinch-zoom; never doing it leaves them at the route-overview zoom, where their own
    // position is a dot on a corridor and the next junction is invisible.
    if (!zoomed.current) {
      zoomed.current = true
      if ((map.getZoom() ?? 0) < 14) map.setZoom(15)
    }
  }, [map, self, following])

  return null
}

/** The driver's own position: a heading-rotated arrow, not a truck glyph. */
function SelfPin({ heading }: { heading: number | null }) {
  return (
    <div style={{ width: 30, height: 30, position: 'relative' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: '#8b5cf6',
          border: '3px solid white',
          boxShadow: '0 1px 6px rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // A null heading means the device did not report one (common when stationary or
          // moving slowly). An upright arrow is honest; a stale angle is not.
          transform: heading === null ? undefined : `rotate(${heading}deg)`,
        }}
      >
        <span style={{ color: 'white', fontSize: 14, lineHeight: 1 }}>▲</span>
      </div>
    </div>
  )
}

function PumpPin() {
  return (
    <div
      style={{
        width: 22,
        height: 22,
        borderRadius: '50%',
        background: '#f59e0b',
        border: '2px solid white',
        boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
      }}
    >
      ⛽
    </div>
  )
}

function Pin({ color, label }: { color: string; label: string }) {
  return (
    <div
      style={{
        width: 24,
        height: 24,
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
      <span style={{ transform: 'rotate(45deg)', color: 'white', fontSize: 11, fontWeight: 700 }}>
        {label}
      </span>
    </div>
  )
}

function MapUnavailable({
  className,
  detail,
  onRetry,
}: {
  className?: string
  detail: string
  onRetry?: () => void
}) {
  return (
    <div
      className={`${className ?? DEFAULT_CLASS} bg-card border border-border flex items-center justify-center p-6 text-center`}
    >
      <div>
        <MapPin className="w-6 h-6 text-muted-foreground/50 mx-auto mb-2" />
        <p className="text-sm font-medium text-foreground">Map unavailable</p>
        <p className="text-xs text-muted-foreground mt-1">{detail}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 h-11 px-5 rounded-xl bg-secondary text-foreground text-sm font-medium active:scale-95 transition-transform"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  )
}
