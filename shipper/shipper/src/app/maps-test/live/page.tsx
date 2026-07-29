'use client'

/**
 * THROWAWAY Phase-1/2 verification page.
 * - No params: drives a fake driver Mumbai->Pune on a straight line (proves the
 *   animated truck marker).
 * - With ?bid=<bookingId>&token=<JWT>[&base=http://localhost:3006]: fetches the
 *   REAL road route from bt-tracking-service, draws the blue road-following
 *   polyline, and walks the truck along it (proves the full route render).
 * Safe to delete alongside /maps-test once signed off. Route: /maps-test/live
 */

import { useEffect, useMemo, useState } from 'react'
import LiveTrackMap from '@/components/maps/LiveTrackMap'
import { decodePolyline, lerp, type LatLng } from '@/lib/maps'

const ORIGIN: LatLng = { lat: 19.076, lng: 72.8777 } // Mumbai
const DEST: LatLng = { lat: 18.5204, lng: 73.8567 } // Pune
const DEFAULT_BASE = 'http://localhost:3006'

export default function MapsLiveTestPage() {
  const [polyline, setPolyline] = useState<string | undefined>(undefined)
  const [endpoints, setEndpoints] = useState<{ origin: LatLng; dest: LatLng }>({
    origin: ORIGIN,
    dest: DEST,
  })
  const [status, setStatus] = useState('straight-line sim (add ?bid=&token= for the real route)')
  const [tick, setTick] = useState(0)

  // Fetch the REAL route if ?bid=&token= are provided.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const bid = q.get('bid')
    const token = q.get('token')
    const base = q.get('base') || DEFAULT_BASE
    if (!bid || !token) return
    setStatus('fetching real route…')
    fetch(`${base}/tracking/route/${bid}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.data?.polyline) {
          setStatus('route fetch failed: ' + JSON.stringify(j).slice(0, 140))
          return
        }
        const pts = decodePolyline(j.data.polyline)
        setPolyline(j.data.polyline)
        if (pts.length) setEndpoints({ origin: pts[0], dest: pts[pts.length - 1] })
        setStatus(`real route: ${(j.data.distance_m / 1000).toFixed(1)} km · cached=${j.data.cached}`)
      })
      .catch((e) => setStatus('fetch error: ' + e.message))
  }, [])

  const path = useMemo(() => (polyline ? decodePolyline(polyline) : []), [polyline])

  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 900)
    return () => clearInterval(id)
  }, [])

  const driver: LatLng =
    path.length > 1 ? path[(tick * 4) % path.length] : lerp(ORIGIN, DEST, (tick % 21) / 20)

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Phase 1+2 — LiveTrackMap</h1>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>{status}</p>
      <LiveTrackMap
        origin={endpoints.origin}
        dest={endpoints.dest}
        encodedPolyline={polyline}
        driver={driver}
        className="h-[70vh] w-full rounded-2xl overflow-hidden"
      />
      <p style={{ fontSize: 13, color: '#666', marginTop: 8 }}>
        Blue line = the real road route from bt-tracking-service. 🚚 walks along it. Green = pickup,
        red = drop.
      </p>
    </div>
  )
}
