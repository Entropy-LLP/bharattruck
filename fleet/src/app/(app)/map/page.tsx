'use client'

/**
 * Live Map — every truck in the fleet on one canvas.
 *
 * COST RULE (bt-fleet-service/src/routes/assignment.ts, GET /fleet/live):
 * this page makes exactly ONE request per tick. The service answers it from a
 * single Redis SMEMBERS + one MGET, which is the entire reason that endpoint
 * exists. Never fan out to a per-vehicle position or /tracking/* route from
 * here — at 1000 trucks on a 10s poll that is 100 req/s and it would burn the
 * Maps quota. Route/ETA stay lazy and out of this screen.
 *
 * WIRE-SHAPE NOTE: `getLivePositions()` is typed as `LivePosition[]`, but the
 * service currently answers with an envelope
 * `{ driver_count, online_count, on_trip_count, positions: [...] }` whose rows
 * carry `updated_at` / `is_online` instead of `recorded_at` / `stale`, and
 * `lat`/`lng` that are null for a driver whose 30s location key has lapsed.
 * Rather than edit the shared client (not this page's to own) the payload is
 * normalised below and both shapes are accepted, so the page renders correctly
 * whichever side lands first.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { APIProvider, Map as GoogleMap, AdvancedMarker, useMap } from '@vis.gl/react-google-maps'
import { Map as MapIcon, Truck, X } from 'lucide-react'
import { PageHeader } from '@/components/app-shell'
import { Card, Empty, ErrorNote, Loading } from '@/components/stat'
import { ApiError, getLivePositions } from '@/lib/api'
import { GOOGLE_MAPS_BROWSER_KEY, GOOGLE_MAPS_MAP_ID } from '@/lib/maps'
import { dateTime, timeAgo } from '@/lib/format'

/** Fallback centre when nothing is reporting — roughly the centre of the network. */
const NAGPUR = { lat: 21.1458, lng: 79.0882 }
const POLL_MS = 10_000
/** Above this the truck is rolling; below it, GPS jitter at a dhaba. */
const MOVING_KMH = 5
/** Location keys carry a 30s TTL; two minutes without a fix is a stale pin. */
const STALE_AFTER_MS = 2 * 60 * 1000
const FOCUS_ZOOM = 12

type Tone = 'moving' | 'idle' | 'stale'

const PIN_COLOR: Record<Tone, string> = {
  moving: '#2563eb', // blue-600
  idle: '#6b7280',   // gray-500
  stale: '#f59e0b',  // amber-500
}

/** One plottable truck. Rows without a fix are dropped before this point. */
type LiveRow = {
  driver_id: string
  vehicle_id: string | null
  rc_number: string | null
  driver_name: string | null
  booking_id: string | null
  lat: number
  lng: number
  heading: number | null
  speed_kmh: number | null
  recorded_at: string | null
  stale: boolean
}

type Snapshot = {
  rows: LiveRow[]
  /** Drivers the service returned, including those with no fix to plot. */
  total: number
}

// ── Payload normalisation ─────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}
function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

function rowsOf(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  const positions = asRecord(payload)?.positions
  return Array.isArray(positions) ? positions : []
}

function ageMs(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? Date.now() - t : Number.POSITIVE_INFINITY
}

function toRow(raw: unknown): LiveRow | null {
  const r = asRecord(raw)
  if (!r) return null

  const driverId = str(r.driver_id)
  const lat = num(r.lat)
  const lng = num(r.lng)
  // No id or no fix means nothing to draw: the driver is offline, not lost.
  if (!driverId || lat === null || lng === null) return null

  const recordedAt = str(r.recorded_at) ?? str(r.updated_at)
  // `stale` when the service sends it; otherwise derived from the fix's own age
  // (and from is_online, which is the envelope's way of saying the key lapsed).
  const declaredStale = bool(r.stale)
  const online = bool(r.is_online)
  const stale = declaredStale ?? (online === false || ageMs(recordedAt) > STALE_AFTER_MS)

  return {
    driver_id: driverId,
    vehicle_id: str(r.vehicle_id),
    rc_number: str(r.rc_number),
    driver_name: str(r.driver_name),
    booking_id: str(r.booking_id),
    lat,
    lng,
    heading: num(r.heading),
    speed_kmh: num(r.speed_kmh),
    recorded_at: recordedAt,
    stale,
  }
}

function normalize(payload: unknown): Snapshot {
  const raw = rowsOf(payload)
  const rows: LiveRow[] = []
  for (const item of raw) {
    const row = toRow(item)
    if (row) rows.push(row)
  }
  return { rows, total: raw.length }
}

function toneOf(row: LiveRow): Tone {
  if (row.stale) return 'stale'
  return (row.speed_kmh ?? 0) > MOVING_KMH ? 'moving' : 'idle'
}

function speedLabel(kmh: number | null): string {
  return kmh === null ? '—' : `${Math.round(kmh)} km/h`
}

// ── Page ──────────────────────────────────────────────────────

export default function LiveMapPage() {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const mapRef = useRef<google.maps.Map | null>(null)

  // ONE call per tick, cleared on unmount.
  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const payload: unknown = await getLivePositions()
        if (cancelled) return
        setSnap(normalize(payload))
        setUpdatedAt(new Date().toISOString())
        setErr(null)
      } catch (e) {
        if (cancelled) return
        setErr(e instanceof ApiError ? e.message : 'Could not reach the live feed')
      }
    }

    load()
    const id = setInterval(load, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const rows = useMemo(() => snap?.rows ?? [], [snap])

  const counts = useMemo(() => {
    let moving = 0
    let idle = 0
    let stale = 0
    for (const row of rows) {
      const tone = toneOf(row)
      if (tone === 'moving') moving++
      else if (tone === 'idle') idle++
      else stale++
    }
    return { moving, idle, stale }
  }, [rows])

  // Read once, when the map first mounts — recomputing it every poll would drag
  // the camera out from under the owner mid-look.
  const center = useMemo(() => {
    if (rows.length === 0) return NAGPUR
    const sum = rows.reduce(
      (acc, r) => ({ lat: acc.lat + r.lat, lng: acc.lng + r.lng }),
      { lat: 0, lng: 0 },
    )
    return { lat: sum.lat / rows.length, lng: sum.lng / rows.length }
  }, [rows])

  const selected = useMemo(
    () => rows.find(r => r.driver_id === selectedId) ?? null,
    [rows, selectedId],
  )

  const holdMap = useCallback((map: google.maps.Map | null) => {
    mapRef.current = map
  }, [])

  const focusOn = useCallback((row: LiveRow) => {
    setSelectedId(row.driver_id)
    const map = mapRef.current
    if (!map) return
    map.panTo({ lat: row.lat, lng: row.lng })
    if ((map.getZoom() ?? 0) < FOCUS_ZOOM) map.setZoom(FOCUS_ZOOM)
  }, [])

  const loading = snap === null && err === null
  /** An error with nothing to fall back on — the very first poll failed. */
  const coldError = snap === null ? err : null

  const subtitle = snap === null
    ? 'Locating trucks…'
    : `${rows.length} of ${snap.total} ${snap.total === 1 ? 'truck' : 'trucks'} reporting`
      + ` · updated ${timeAgo(updatedAt)}`

  return (
    <div className="h-[calc(100vh-3.5rem)] lg:h-screen flex flex-col bg-gray-50">
      {/* Header strip: the fleet at a glance, before any pin is read. */}
      <div className="shrink-0 bg-white border-b border-gray-200 px-4 lg:px-6 pt-4">
        <PageHeader
          title="Live Map"
          subtitle={subtitle}
          actions={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <CountPill dot="bg-blue-500" label="moving" n={counts.moving} />
              <CountPill dot="bg-gray-400" label="idle" n={counts.idle} />
              <CountPill dot="bg-amber-500" label="stale" n={counts.stale} />
            </div>
          }
        />
      </div>

      {/* A failed poll after a good one keeps the last known pins on screen. */}
      {err && snap && (
        <div className="shrink-0 px-4 lg:px-6 pt-3">
          <ErrorNote message={`${err} — showing the last known positions.`} />
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* List panel */}
        <aside className="order-2 lg:order-1 w-full lg:w-80 xl:w-96 lg:shrink-0 flex-1 lg:flex-none lg:h-full min-h-0 overflow-y-auto bg-white border-t lg:border-t-0 lg:border-r border-gray-200">
          {loading && <Loading label="Locating trucks" />}

          {coldError && (
            <div className="p-3">
              <ErrorNote message={coldError} />
            </div>
          )}

          {snap && rows.length === 0 && (
            <Empty
              title="No trucks reporting"
              hint="Positions appear here as soon as a driver's app is online and sending its location."
            />
          )}

          {rows.length > 0 && (
            <div className="p-3 space-y-2">
              {rows.map(row => (
                <VehicleCard
                  key={row.driver_id}
                  row={row}
                  selected={row.driver_id === selectedId}
                  onSelect={() => focusOn(row)}
                />
              ))}
            </div>
          )}
        </aside>

        {/* Map pane */}
        <div className="order-1 lg:order-2 relative w-full h-[45vh] shrink-0 lg:h-full lg:flex-1 lg:shrink lg:min-w-0 bg-gray-100">
          {!GOOGLE_MAPS_BROWSER_KEY ? (
            <MapKeyMissing />
          ) : loading ? (
            <div className="h-full flex items-center justify-center">
              <Loading label="Loading map" />
            </div>
          ) : coldError ? (
            <div className="h-full flex items-center justify-center p-6">
              <div className="max-w-sm w-full">
                <ErrorNote message={coldError} />
              </div>
            </div>
          ) : (
            <APIProvider apiKey={GOOGLE_MAPS_BROWSER_KEY}>
              <GoogleMap
                defaultCenter={center}
                defaultZoom={5}
                mapId={GOOGLE_MAPS_MAP_ID || undefined}
                gestureHandling="greedy"
                disableDefaultUI
                zoomControl
                clickableIcons={false}
                style={{ width: '100%', height: '100%' }}
              >
                <MapHandle onMap={holdMap} />
                {rows.map(row => (
                  <AdvancedMarker
                    key={row.driver_id}
                    position={{ lat: row.lat, lng: row.lng }}
                    title={row.rc_number ?? row.driver_name ?? 'Truck'}
                    zIndex={row.driver_id === selectedId ? 2 : 1}
                    onClick={() => focusOn(row)}
                    // The pin is a dot, not a teardrop: sit it ON the fix rather
                    // than the default bottom-centre anchor.
                    anchorLeft="-50%"
                    anchorTop="-50%"
                  >
                    <TruckPin
                      tone={toneOf(row)}
                      heading={row.heading}
                      selected={row.driver_id === selectedId}
                    />
                  </AdvancedMarker>
                ))}
              </GoogleMap>
            </APIProvider>
          )}

          {/* Advanced markers need a vector map id; without one the canvas draws
              but every pin is silently dropped, so say so rather than show an
              empty map. */}
          {GOOGLE_MAPS_BROWSER_KEY && !GOOGLE_MAPS_MAP_ID && (
            <div className="absolute top-3 left-3 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 shadow-sm">
              Map ID not configured — pins may not render
            </div>
          )}

          {selected && (
            <SelectedCard row={selected} onClose={() => setSelectedId(null)} />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Pieces ────────────────────────────────────────────────────

function CountPill({ dot, label, n }: { dot: string; label: string; n: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs">
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      <span className="font-semibold text-gray-900 tabular-nums">{n}</span>
      <span className="text-gray-500">{label}</span>
    </span>
  )
}

function StaleBadge() {
  return (
    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
      Stale
    </span>
  )
}

function VehicleCard({
  row, selected, onSelect,
}: {
  row: LiveRow
  selected: boolean
  onSelect: () => void
}) {
  const tone = toneOf(row)
  const speedTone =
    tone === 'moving' ? 'text-blue-700'
    : tone === 'stale' ? 'text-amber-700'
    : 'text-gray-500'

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-xl border p-3 transition-colors ${
        selected
          ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
          : 'border-gray-200 bg-white hover:bg-gray-50'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 truncate">
            {row.rc_number ?? 'Truck not assigned'}
          </div>
          <div className="text-xs text-gray-500 truncate">
            {row.driver_name ?? 'Driver unnamed'}
          </div>
        </div>
        {row.stale && <StaleBadge />}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <span className={`inline-flex items-center gap-1.5 font-medium tabular-nums ${speedTone}`}>
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: PIN_COLOR[tone] }}
          />
          {speedLabel(row.speed_kmh)}
        </span>
        <span className="text-gray-400">{timeAgo(row.recorded_at)}</span>
      </div>
    </button>
  )
}

/** Detail for the selected truck, floated over the map. */
function SelectedCard({ row, onClose }: { row: LiveRow; onClose: () => void }) {
  const tone = toneOf(row)
  return (
    <div className="absolute bottom-3 left-3 right-3 sm:right-auto sm:w-72">
      <Card className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate">
              {row.rc_number ?? 'Truck not assigned'}
            </div>
            <div className="text-xs text-gray-500 truncate">
              {row.driver_name ?? 'Driver unnamed'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 -mr-1 -mt-1 p-1 text-gray-400 hover:text-gray-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-gray-400 uppercase tracking-wide">Speed</div>
            <div className="mt-0.5 text-sm font-semibold text-gray-900 tabular-nums">
              {speedLabel(row.speed_kmh)}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-400 uppercase tracking-wide">Last seen</div>
            <div className="mt-0.5 text-sm font-semibold text-gray-900">
              {timeAgo(row.recorded_at)}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2.5">
          <span
            className="inline-flex items-center gap-1.5 text-xs font-medium capitalize"
            style={{ color: PIN_COLOR[tone] }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: PIN_COLOR[tone] }} />
            {tone}
          </span>
          {row.booking_id && (
            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
              On a trip
            </span>
          )}
          <span className="ml-auto text-xs text-gray-400">{dateTime(row.recorded_at)}</span>
        </div>
      </Card>
    </div>
  )
}

/** Hands the map instance up so a card click can pan imperatively. */
function MapHandle({ onMap }: { onMap: (map: google.maps.Map | null) => void }) {
  const map = useMap()
  useEffect(() => {
    onMap(map)
    return () => onMap(null)
  }, [map, onMap])
  return null
}

function TruckPin({
  tone, heading, selected,
}: {
  tone: Tone
  heading: number | null
  selected: boolean
}) {
  const color = PIN_COLOR[tone]
  const size = selected ? 34 : 26

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: '9999px',
        background: color,
        border: '2px solid #ffffff',
        boxShadow: selected
          ? '0 0 0 4px rgba(37, 99, 235, 0.25), 0 2px 6px rgba(0, 0, 0, 0.35)'
          : '0 1px 4px rgba(0, 0, 0, 0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Truck size={selected ? 18 : 14} color="#ffffff" strokeWidth={2.2} />

      {/* Heading flag: a zero-size pivot at the pin centre, rotated, with the
          arrow parked above it — so the triangle both orbits and turns. */}
      {tone === 'moving' && heading !== null && (
        <span
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 0,
            height: 0,
            transform: `rotate(${heading}deg)`,
          }}
        >
          <span
            style={{
              position: 'absolute',
              left: -4,
              top: -(size / 2 + 8),
              width: 0,
              height: 0,
              borderLeft: '4px solid transparent',
              borderRight: '4px solid transparent',
              borderBottom: `6px solid ${color}`,
            }}
          />
        </span>
      )}
    </div>
  )
}

function MapKeyMissing() {
  return (
    <div className="h-full flex items-center justify-center p-6">
      <Card className="max-w-sm w-full p-6 text-center">
        <div className="mx-auto w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
          <MapIcon className="w-5 h-5 text-gray-400" strokeWidth={1.9} />
        </div>
        <p className="mt-3 text-sm font-medium text-gray-900">Map key not configured</p>
        <p className="mt-1 text-xs text-gray-500">
          Set <code className="font-mono">NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY</code> (and{' '}
          <code className="font-mono">NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID</code>) to draw the map.
          Live positions are still listed alongside.
        </p>
      </Card>
    </div>
  )
}
