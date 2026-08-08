'use client'

/**
 * Live Fleet — every truck the owner has, on one canvas and in one list.
 *
 * WHY THIS IS VEHICLE-CENTRIC (and the previous version was not): the earlier board read
 * bt-fleet-service's GET /fleet/live, which iterates the fleet's DRIVER set. A truck with
 * nobody assigned to it therefore never appeared at all — so a yard full of idle trucks
 * rendered as an empty, calm-looking map. For an owner that is exactly backwards: the assets
 * earning nothing are the ones costing money.
 *
 * This reads bt-tracking-service's GET /api/tracking/fleet/overview instead, which starts
 * from `vehicles`. Every truck is always a row. A truck with no driver, no trip, or no GPS
 * fix still appears, carrying an explicit status and a plain-language REASON — because on a
 * logistics dashboard "no data" is worse than useless: the owner cannot tell whether the
 * driver forgot to open the app, the truck is legitimately parked, or the platform is broken.
 *
 * COST RULE (unchanged, and it still binds): ONE request per tick for the whole fleet. The
 * service answers from a single Redis MGET plus bounded Postgres reads and makes NO Google
 * call. Never fan out to a per-vehicle /tracking/route or /tracking/eta from this screen —
 * at 1000 trucks on a 10s poll that is 100 req/s straight into the Maps bill. Route and ETA
 * stay lazy, one selected truck at a time.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { APIProvider, Map as GoogleMap, AdvancedMarker, useMap } from '@vis.gl/react-google-maps'
import {
  AlertTriangle, Fuel, Gauge, MapPin, Moon, Radio, Route as RouteIcon, Truck, X,
} from 'lucide-react'
import { PageHeader } from '@/components/app-shell'
import { Card, Empty, ErrorNote, Loading, Stat } from '@/components/stat'
import { ApiError, getFleetOverview } from '@/lib/api'
import { GOOGLE_MAPS_BROWSER_KEY, GOOGLE_MAPS_MAP_ID } from '@/lib/maps'
import { MapBoundary, useMapsAuthFailed, useMapRenderWatchdog } from '@/components/map-guard'
import { timeAgo } from '@/lib/format'
import type { FleetOverview, TrackedVehicle, VehicleStatus } from '@/lib/types'

/** Fallback centre when nothing is reporting — roughly the centre of the network. */
const NAGPUR = { lat: 21.1458, lng: 79.0882 }
const POLL_MS = 10_000
const FOCUS_ZOOM = 12

// ── Status presentation ───────────────────────────────────────
//
// One table, so the pin colour, the chip and the filter can never disagree about what a
// status means. `pin` is null for statuses that by definition have no position to draw.

const STATUS: Record<
  VehicleStatus,
  { label: string; pin: string | null; chip: string; dot: string; order: number }
> = {
  moving:               { label: 'Moving',   pin: '#2563eb', chip: 'bg-blue-50 text-blue-700 border-blue-200',       dot: 'bg-blue-500',  order: 0 },
  idle:                 { label: 'Stopped',  pin: '#6b7280', chip: 'bg-gray-100 text-gray-700 border-gray-200',      dot: 'bg-gray-500',  order: 1 },
  no_signal:            { label: 'No signal',pin: null,      chip: 'bg-amber-50 text-amber-800 border-amber-200',    dot: 'bg-amber-500', order: 2 },
  assigned_not_started: { label: 'Assigned', pin: null,      chip: 'bg-violet-50 text-violet-700 border-violet-200', dot: 'bg-violet-500',order: 3 },
  parked:               { label: 'Parked',   pin: null,      chip: 'bg-slate-50 text-slate-600 border-slate-200',    dot: 'bg-slate-400', order: 4 },
  inactive:             { label: 'Inactive', pin: null,      chip: 'bg-slate-50 text-slate-400 border-slate-200',    dot: 'bg-slate-300', order: 5 },
}

const FILTERS: { key: 'all' | VehicleStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'moving', label: 'Moving' },
  { key: 'idle', label: 'Stopped' },
  { key: 'no_signal', label: 'No signal' },
  { key: 'parked', label: 'Parked' },
]

const inr = (n: number) =>
  `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

const truckName = (v: TrackedVehicle) => v.rc_number ?? v.maker_model ?? 'Unregistered truck'

// ── Page ──────────────────────────────────────────────────────

export default function LiveFleetPage() {
  const [data, setData] = useState<FleetOverview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | VehicleStatus>('all')
  const mapRef = useRef<google.maps.Map | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const payload = await getFleetOverview()
        if (cancelled) return
        setData(payload)
        setFetchedAt(new Date().toISOString())
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

  const vehicles = useMemo(() => {
    const list = data?.vehicles ?? []
    // Sort by how much the owner needs to look at it: alerts first, then trucks that
    // should be reporting and are not, then the normal on-road statuses, parked last.
    return [...list].sort((a, b) => {
      if (a.alerts.length !== b.alerts.length) return b.alerts.length - a.alerts.length
      const byStatus = STATUS[a.status].order - STATUS[b.status].order
      if (byStatus !== 0) return byStatus
      return truckName(a).localeCompare(truckName(b))
    })
  }, [data])

  const shown = useMemo(
    () => (filter === 'all' ? vehicles : vehicles.filter((v) => v.status === filter)),
    [vehicles, filter],
  )

  const plotted = useMemo(() => vehicles.filter((v) => v.position !== null), [vehicles])

  // Computed once from the first payload that has pins. Recomputing every poll would drag
  // the camera out from under the owner mid-look.
  const centerRef = useRef<{ lat: number; lng: number } | null>(null)
  if (centerRef.current === null && plotted.length > 0) {
    const sum = plotted.reduce(
      (acc, v) => ({ lat: acc.lat + v.position!.lat, lng: acc.lng + v.position!.lng }),
      { lat: 0, lng: 0 },
    )
    centerRef.current = { lat: sum.lat / plotted.length, lng: sum.lng / plotted.length }
  }

  const selected = useMemo(
    () => vehicles.find((v) => v.vehicle_id === selectedId) ?? null,
    [vehicles, selectedId],
  )

  const holdMap = useCallback((map: google.maps.Map | null) => {
    mapRef.current = map
  }, [])

  const focusOn = useCallback((v: TrackedVehicle) => {
    setSelectedId(v.vehicle_id)
    const map = mapRef.current
    if (!map || !v.position) return
    map.panTo({ lat: v.position.lat, lng: v.position.lng })
    if ((map.getZoom() ?? 0) < FOCUS_ZOOM) map.setZoom(FOCUS_ZOOM)
  }, [])

  const s = data?.summary
  const loading = data === null && err === null
  /** An error with nothing to fall back on — the very first poll failed. */
  const coldError = data === null ? err : null

  const subtitle = data
    ? `${s!.vehicle_count} ${s!.vehicle_count === 1 ? 'truck' : 'trucks'} · ${plotted.length} reporting · updated ${timeAgo(fetchedAt)}`
    : 'Loading your fleet…'

  return (
    <div className="min-h-[calc(100vh-3.5rem)] lg:min-h-screen flex flex-col bg-gray-50">
      <div className="shrink-0 bg-white border-b border-gray-200 px-4 lg:px-6 pt-4">
        <PageHeader title="Live Fleet" subtitle={subtitle} />
      </div>

      {/* A failed poll AFTER a good one keeps the last known board on screen — a blank
          dashboard during a transient network blip is worse than slightly stale numbers. */}
      {err && data && (
        <div className="shrink-0 px-4 lg:px-6 pt-3">
          <ErrorNote message={`${err} — showing the last successful update (${timeAgo(fetchedAt)}).`} />
        </div>
      )}

      {coldError && (
        <div className="px-4 lg:px-6 py-6">
          <ErrorNote message={coldError} />
        </div>
      )}

      {loading && <Loading label="Locating your trucks" />}

      {data && (
        <>
          {/* The fleet at a glance, before any pin is read. */}
          <div className="shrink-0 px-4 lg:px-6 py-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
            <Stat label="Trucks" value={s!.vehicle_count} sub={`${s!.on_trip} on a trip`} icon={<Truck className="w-4 h-4" />} />
            <Stat label="Moving" value={s!.moving} tone={s!.moving > 0 ? 'good' : 'neutral'} icon={<Gauge className="w-4 h-4" />} />
            <Stat label="Stopped" value={s!.idle} icon={<MapPin className="w-4 h-4" />} />
            <Stat
              label="No signal"
              value={s!.no_signal}
              tone={s!.no_signal > 0 ? 'warn' : 'neutral'}
              sub={s!.no_signal > 0 ? 'Should be reporting' : 'All reporting'}
              icon={<Radio className="w-4 h-4" />}
            />
            <Stat
              label="Open alerts"
              value={s!.alert_count}
              tone={s!.alert_count > 0 ? 'bad' : 'good'}
              icon={<AlertTriangle className="w-4 h-4" />}
            />
            <Stat
              label="Fuel on road"
              value={inr(s!.trip_fuel_cost_inr)}
              sub={`${s!.driven_km.toLocaleString('en-IN')} km driven`}
              icon={<Fuel className="w-4 h-4" />}
            />
          </div>

          {s!.vehicle_count === 0 ? (
            <div className="px-4 lg:px-6 pb-6">
              <Card>
                <Empty
                  title="No trucks in your fleet yet"
                  hint="Add a truck under Trucks to see it here."
                />
              </Card>
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4 px-4 lg:px-6 pb-6">
              {/* ── The list. Every truck, always. ── */}
              <div className="lg:w-[26rem] shrink-0 flex flex-col min-h-0">
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {FILTERS.map((f) => {
                    const n = f.key === 'all' ? vehicles.length : vehicles.filter((v) => v.status === f.key).length
                    const active = filter === f.key
                    return (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setFilter(f.key)}
                        className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                          active
                            ? 'bg-gray-900 text-white border-gray-900'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        {f.label} <span className="tabular-nums opacity-70">{n}</span>
                      </button>
                    )
                  })}
                </div>

                <Card className="flex-1 min-h-0 overflow-y-auto divide-y divide-gray-100">
                  {shown.length === 0 ? (
                    <Empty title="No trucks match this filter" hint="Clear the filter to see the whole fleet." />
                  ) : (
                    shown.map((v) => (
                      <VehicleRow
                        key={v.vehicle_id}
                        vehicle={v}
                        selected={v.vehicle_id === selectedId}
                        onSelect={() => focusOn(v)}
                      />
                    ))
                  )}
                </Card>
              </div>

              {/* ── The map. ── */}
              <div className="flex-1 min-h-[24rem] lg:min-h-0 relative">
                <FleetMap vehicles={plotted} selectedId={selectedId} onHoldMap={holdMap} onSelect={focusOn} />

                {selected && (
                  <div className="absolute top-3 right-3 w-full max-w-sm">
                    <VehicleDetail vehicle={selected} onClose={() => setSelectedId(null)} />
                  </div>
                )}

                {/* Trucks that cannot be drawn are still accounted for, right on the map,
                    so the pin count never silently under-reports the fleet. */}
                {plotted.length < vehicles.length && (
                  <div className="absolute bottom-3 left-3 rounded-lg bg-white/95 border border-gray-200 shadow-sm px-3 py-2 text-xs text-gray-600">
                    {vehicles.length - plotted.length} of {vehicles.length} trucks have no live
                    position — see the list for why.
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── List row ──────────────────────────────────────────────────

function VehicleRow({
  vehicle, selected, onSelect,
}: {
  vehicle: TrackedVehicle
  selected: boolean
  onSelect: () => void
}) {
  const st = STATUS[vehicle.status]
  const worst = vehicle.alerts.find((a) => a.severity === 'critical') ?? vehicle.alerts[0] ?? null

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left px-4 py-3 transition-colors ${
        selected ? 'bg-blue-50' : 'hover:bg-gray-50'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${st.dot}`} />
            <span className="font-semibold text-sm text-gray-900 truncate">{truckName(vehicle)}</span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {vehicle.maker_model ?? 'Model not recorded'}
            {vehicle.driver?.name ? ` · ${vehicle.driver.name}` : ''}
          </p>
        </div>
        <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full border ${st.chip}`}>
          {vehicle.status_label}
        </span>
      </div>

      {/* The reason line. This is the row's real payload for anything not simply "moving":
          it turns a blank cell into something the owner can act on. */}
      {vehicle.data_health.level !== 'ok' && (
        <p className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-2 py-1.5">
          {vehicle.data_health.reason}
        </p>
      )}

      {vehicle.booking && (
        <p className="mt-2 text-xs text-gray-600 truncate">
          <RouteIcon className="w-3 h-3 inline mr-1 -mt-0.5 text-gray-400" />
          {vehicle.booking.source_address ?? 'Pickup'} → {vehicle.booking.dest_address ?? 'Drop'}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 tabular-nums">
        {vehicle.position && (
          <span>{Math.round(vehicle.position.speed_kmh ?? 0)} km/h</span>
        )}
        {vehicle.trip && <span>{vehicle.trip.driven_km} km driven</span>}
        {vehicle.fuel.trip && <span>{inr(vehicle.fuel.trip.total_cost_inr)} fuel</span>}
        {!vehicle.trip && !vehicle.position && (
          <span>{vehicle.fuel.mileage_kmpl} kmpl rated</span>
        )}
      </div>

      {worst && (
        <p className={`mt-2 text-xs px-2 py-1.5 rounded-md border ${
          worst.severity === 'critical'
            ? 'bg-red-50 border-red-100 text-red-800'
            : 'bg-orange-50 border-orange-100 text-orange-800'
        }`}>
          <AlertTriangle className="w-3 h-3 inline mr-1 -mt-0.5" />
          {worst.message ?? worst.type}
          {vehicle.alerts.length > 1 && ` (+${vehicle.alerts.length - 1} more)`}
        </p>
      )}
    </button>
  )
}

// ── Detail panel ──────────────────────────────────────────────

function VehicleDetail({ vehicle, onClose }: { vehicle: TrackedVehicle; onClose: () => void }) {
  const t = vehicle.trip
  const f = vehicle.fuel

  return (
    <Card className="shadow-lg">
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-gray-100">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900 truncate">{truckName(vehicle)}</h2>
          <p className="text-xs text-gray-500 truncate">
            {vehicle.maker_model ?? 'Model not recorded'}
            {vehicle.emission_norm ? ` · ${vehicle.emission_norm}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close truck details"
          className="shrink-0 text-gray-400 hover:text-gray-600"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-4 py-3 space-y-3 max-h-[60vh] overflow-y-auto">
        <p className="text-xs text-gray-600">{vehicle.data_health.reason}</p>

        {vehicle.driver && (
          <div className="text-xs">
            <span className="text-gray-400">Driver</span>
            <p className="text-gray-900 font-medium">
              {vehicle.driver.name ?? 'Name not on file'}
              {vehicle.driver.phone && (
                <a href={`tel:${vehicle.driver.phone}`} className="ml-2 text-blue-600 hover:underline font-normal">
                  {vehicle.driver.phone}
                </a>
              )}
            </p>
          </div>
        )}

        {t ? (
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Driven" value={`${t.driven_km} km`} />
            <Metric label="Moving" value={`${t.moving_hours} h`} />
            <Metric label="Idle" value={`${t.idle_hours} h`} />
            <Metric
              label="Avg speed"
              value={t.avg_moving_speed_kmh === null ? '—' : `${t.avg_moving_speed_kmh} km/h`}
            />
            <Metric label="Top speed" value={`${t.max_speed_kmh} km/h`} />
            <Metric label="Stops" value={String(t.stop_count)} />
            {t.night_hours > 0 && (
              <Metric label="Night driving" value={`${t.night_hours} h`} icon={<Moon className="w-3 h-3" />} />
            )}
            {t.max_deviation_m > 0 && (
              <Metric label="Max off-route" value={`${t.max_deviation_m} m`} />
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-500">No trip telemetry yet.</p>
        )}

        {/* Fuel is shown for EVERY truck — the rated figure is a property of the asset, not
            of the trip — with the basis stated so a class average never masquerades as
            measured data. */}
        <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
            <Fuel className="w-3.5 h-3.5 text-gray-400" />
            Fuel
          </div>
          {f.trip ? (
            <p className="mt-1 text-sm font-semibold text-gray-900 tabular-nums">
              {inr(f.trip.total_cost_inr)}
              <span className="ml-1.5 text-xs font-normal text-gray-500">
                {f.trip.litres} L over {f.trip.distance_km} km
              </span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-gray-500">Not on a running trip.</p>
          )}
          <p className="mt-1 text-[11px] text-gray-500">
            {f.mileage_kmpl} kmpl · {f.basis_note}
          </p>
        </div>

        {vehicle.alerts.length > 0 && (
          <div className="space-y-1.5">
            {vehicle.alerts.map((a) => (
              <p
                key={a.id}
                className={`text-xs px-2 py-1.5 rounded-md border ${
                  a.severity === 'critical'
                    ? 'bg-red-50 border-red-100 text-red-800'
                    : a.severity === 'warning'
                      ? 'bg-orange-50 border-orange-100 text-orange-800'
                      : 'bg-blue-50 border-blue-100 text-blue-800'
                }`}
              >
                {a.message ?? a.type}
                <span className="opacity-60"> · {timeAgo(a.created_at)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

function Metric({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <span className="text-[11px] text-gray-400 flex items-center gap-1">{icon}{label}</span>
      <p className="text-sm font-semibold text-gray-900 tabular-nums">{value}</p>
    </div>
  )
}

// ── Map ───────────────────────────────────────────────────────

function MapUnavailable({ detail }: { detail: string }) {
  return (
    <div className="h-full w-full rounded-xl border border-gray-200 bg-white flex items-center justify-center p-6 text-center">
      <div className="max-w-xs">
        <MapPin className="w-6 h-6 text-gray-300 mx-auto mb-2" />
        <p className="text-sm font-medium text-gray-900">Map unavailable</p>
        <p className="text-xs text-gray-500 mt-1">{detail}</p>
        <p className="text-xs text-gray-400 mt-2">
          Truck status, telemetry and alerts on the left are unaffected.
        </p>
      </div>
    </div>
  )
}

function FleetMap({
  vehicles, selectedId, onHoldMap, onSelect,
}: {
  vehicles: TrackedVehicle[]
  selectedId: string | null
  onHoldMap: (map: google.maps.Map | null) => void
  onSelect: (v: TrackedVehicle) => void
}) {
  // Three independent detectors, because a Maps failure surfaces differently depending on
  // the cause: gm_authFailure (no throw), a thrown render error (the boundary), and — the
  // only one that catches everything — whether tiles ever actually painted.
  const authFailed = useMapsAuthFailed()
  const { timedOut, onReady } = useMapRenderWatchdog()

  // A missing browser key must degrade to a usable page, not a crash — the list beside
  // this map is fully functional without any map at all.
  if (!GOOGLE_MAPS_BROWSER_KEY) {
    return <MapUnavailable detail="NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY is not configured for this deployment." />
  }

  if (authFailed || timedOut) {
    return (
      <MapUnavailable detail="Google rejected the map key for this site. It is usually the key's allowed-referrer list, an unactivated API, or an exhausted quota." />
    )
  }

  const center = vehicles[0]?.position
    ? { lat: vehicles[0].position.lat, lng: vehicles[0].position.lng }
    : NAGPUR

  return (
    <div className="h-full w-full rounded-xl overflow-hidden border border-gray-200">
      <MapBoundary fallback={<MapUnavailable detail="The live map could not be drawn. This is a display problem only." />}>
        <APIProvider apiKey={GOOGLE_MAPS_BROWSER_KEY}>
          <GoogleMap
            defaultCenter={center}
            defaultZoom={vehicles.length ? 6 : 5}
            mapId={GOOGLE_MAPS_MAP_ID || undefined}
            gestureHandling="greedy"
            disableDefaultUI
            style={{ width: '100%', height: '100%' }}
          >
            <MapHandle onHoldMap={onHoldMap} onReady={onReady} />
            {vehicles.map((v) => (
              <AdvancedMarker
                key={v.vehicle_id}
                position={{ lat: v.position!.lat, lng: v.position!.lng }}
                title={`${truckName(v)} — ${v.status_label}`}
                onClick={() => onSelect(v)}
              >
                <TruckPin vehicle={v} selected={v.vehicle_id === selectedId} />
              </AdvancedMarker>
            ))}
          </GoogleMap>
        </APIProvider>
      </MapBoundary>
    </div>
  )
}

/**
 * Hands the imperative map instance up so the list can pan to a truck, and reports the
 * first real paint so the watchdog can stand down.
 *
 * `tilesloaded` rather than the map instance merely existing: `useMap()` returns an object
 * even when Google has refused the key and will never draw a thing.
 */
function MapHandle({
  onHoldMap, onReady,
}: {
  onHoldMap: (m: google.maps.Map | null) => void
  onReady: () => void
}) {
  const map = useMap()

  useEffect(() => {
    onHoldMap(map)
    return () => onHoldMap(null)
  }, [map, onHoldMap])

  useEffect(() => {
    if (!map) return
    const listener = map.addListener('tilesloaded', onReady)
    return () => listener.remove()
  }, [map, onReady])

  return null
}

function TruckPin({ vehicle, selected }: { vehicle: TrackedVehicle; selected: boolean }) {
  const colour = STATUS[vehicle.status].pin ?? '#f59e0b'
  const hasAlert = vehicle.alerts.length > 0
  // Rotate to heading when the device reported one. Cheap Android GPS often omits heading
  // while stationary, so an upright pin is the honest default rather than a stale angle.
  const heading = vehicle.position?.heading ?? null

  return (
    <div className="relative" style={{ width: 28, height: 28 }}>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: colour,
          border: selected ? '3px solid #111827' : '2px solid white',
          boxShadow: '0 1px 5px rgba(0,0,0,0.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: heading === null ? undefined : `rotate(${heading}deg)`,
        }}
      >
        <Truck className="w-3.5 h-3.5 text-white" />
      </div>
      {hasAlert && (
        <span
          style={{
            position: 'absolute', top: -2, right: -2,
            width: 10, height: 10, borderRadius: '50%',
            background: '#dc2626', border: '2px solid white',
          }}
        />
      )}
    </div>
  )
}
