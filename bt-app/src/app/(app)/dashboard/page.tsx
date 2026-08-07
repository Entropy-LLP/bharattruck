'use client'

// The owner's morning screen.
//
// Reading order is deliberate and matches how a fleet owner actually opens the
// console: "what did the fleet earn" -> "which truck is losing me money" ->
// "what is moving right now" -> "where is the money going". The EMI-shortfall
// table is the hero; everything above it is context for that table.
//
// Every number on this page comes from four calls, all of them period-scoped
// except the live map read. Nothing here polls.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight, Gauge, IndianRupee, MapPin, Route, TrendingUp, Truck, Wallet,
} from 'lucide-react'

import { PageHeader } from '@/components/app-shell'
import { Card, CardHead, CoverPill, Empty, ErrorNote, Loading, Stat } from '@/components/stat'
import {
  ApiError,
  getFleetSummary,
  getLivePositions,
  getVehicleAnalytics,
  listFleetBookings,
} from '@/lib/api'
import { inr, inrCompact, inrSigned, km, pct, periodDays, shortDate, tons } from '@/lib/format'
import type {
  CostBreakdown, FleetBooking, FleetSummary, LivePosition, VehicleAnalytics,
} from '@/lib/types'

const PERIOD_OPTIONS = [30, 90, 180] as const
type PeriodChoice = (typeof PERIOD_OPTIONS)[number]

// ── Wire-shape tolerance ──────────────────────────────────────
//
// Two places where lib/types.ts and bt-fleet-service disagree today. Both are
// read defensively rather than "fixed" here, because the foundation files are
// not this page's to edit and a mismatch must not blank the dashboard.

/**
 * lib/api.ts types GET /fleet/live as LivePosition[], but the route
 * (bt-fleet-service/src/routes/assignment.ts) sends an envelope:
 * { driver_count, online_count, on_trip_count, positions: [...] }. Accept either.
 */
function positionsOf(res: unknown): LivePosition[] {
  if (Array.isArray(res)) return res as LivePosition[]
  if (res && typeof res === 'object' && 'positions' in res) {
    const inner = (res as { positions: unknown }).positions
    if (Array.isArray(inner)) return inner as LivePosition[]
  }
  return []
}

/**
 * A driver counts as "on the road" only with a real fix. The envelope shape
 * sends lat/lng as null once the 30s Redis TTL lapses (offline, not lost), and
 * the typed shape carries `stale` instead — honour whichever is present.
 */
function hasFix(p: LivePosition): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.stale !== true
}

/**
 * lib/types.ts declares CostBreakdown with `_inr`-suffixed keys; the service's
 * costBreakdown() (bt-fleet-service/src/lib/analytics.ts) emits bare keys
 * (`fuel`, `tyres`, `driver_wage`, …). Read both so no slice is ever NaN-wide.
 */
function costAmount(breakdown: CostBreakdown, typedKey: string, wireKey: string): number {
  const record: Record<string, unknown> = breakdown
  const value = record[typedKey] ?? record[wireKey]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

// Ordered so the dominant slice leads and the bar reads left-to-right by size
// for a typical fleet. Fuel gets the strongest colour on purpose.
const COST_SLICES: { typedKey: string; wireKey: string; label: string; color: string }[] = [
  { typedKey: 'fuel_inr',        wireKey: 'fuel',        label: 'Fuel',        color: 'bg-blue-600' },
  { typedKey: 'driver_wage_inr', wireKey: 'driver_wage', label: 'Driver wage', color: 'bg-indigo-500' },
  { typedKey: 'toll_inr',        wireKey: 'toll',        label: 'Toll',        color: 'bg-purple-500' },
  { typedKey: 'tyre_inr',        wireKey: 'tyres',       label: 'Tyres',       color: 'bg-orange-500' },
  { typedKey: 'service_inr',     wireKey: 'service',     label: 'Service',     color: 'bg-amber-500' },
  { typedKey: 'def_inr',         wireKey: 'def',         label: 'DEF',         color: 'bg-teal-500' },
  { typedKey: 'engine_oil_inr',  wireKey: 'engine_oil',  label: 'Engine oil',  color: 'bg-cyan-500' },
  { typedKey: 'gear_oil_inr',    wireKey: 'gear_oil',    label: 'Gear oil',    color: 'bg-sky-400' },
  { typedKey: 'other_inr',       wireKey: 'other',       label: 'Other',       color: 'bg-gray-400' },
]

export default function DashboardPage() {
  const [days, setDays] = useState<PeriodChoice>(30)
  const [summary, setSummary] = useState<FleetSummary | null>(null)
  const [vehicles, setVehicles] = useState<VehicleAnalytics[]>([])
  const [live, setLive] = useState<LivePosition[]>([])
  const [inTransit, setInTransit] = useState<FleetBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // The effect only kicks the requests off; every setState happens in a
  // callback. Flipping `loading`/`error` synchronously here would trip
  // react-hooks/set-state-in-effect, so the period buttons own that transition.
  useEffect(() => {
    let cancelled = false
    const period = periodDays(days)

    Promise.all([
      getFleetSummary(period),
      getVehicleAnalytics(period),
      getLivePositions(),
      // Filtered server-side; re-filtered below so a service that ignores the
      // query param still renders only moving trips.
      listFleetBookings('in_transit'),
    ])
      .then(([summaryData, vehicleData, liveData, bookingData]) => {
        if (cancelled) return
        setSummary(summaryData)
        setVehicles(vehicleData?.vehicles ?? [])
        setLive(positionsOf(liveData))
        setInTransit((bookingData ?? []).filter(b => b.status === 'in_transit'))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : 'Could not load the dashboard')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [days])

  const switcher = (
    <div className="inline-flex rounded-xl border border-gray-200 bg-white p-0.5 shadow-sm">
      {PERIOD_OPTIONS.map(option => (
        <button
          key={option}
          type="button"
          onClick={() => {
            if (option === days) return
            setLoading(true)
            setError(null)
            setDays(option)
          }}
          aria-pressed={days === option}
          className={`rounded-[10px] px-3 py-1.5 text-sm font-medium transition-colors ${
            days === option
              ? 'bg-blue-600 text-white'
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          {option}d
        </button>
      ))}
    </div>
  )

  const header = (
    <PageHeader title="Dashboard" subtitle={`Last ${days} days`} actions={switcher} />
  )

  // First load: nothing to show behind the spinner yet.
  if (loading && !summary) {
    return (
      <div className="p-4 lg:p-6 max-w-7xl mx-auto">
        {header}
        <Loading label="Pulling the fleet's numbers" />
      </div>
    )
  }

  if (error && !summary) {
    return (
      <div className="p-4 lg:p-6 max-w-7xl mx-auto">
        {header}
        <ErrorNote message={error} />
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="p-4 lg:p-6 max-w-7xl mx-auto">
        {header}
        <Card><Empty title="No fleet data yet" hint="Add a truck to start seeing numbers here." /></Card>
      </div>
    )
  }

  const { score, utilization } = summary
  const trucksTotal = summary.active_vehicles
  const clearing = summary.vehicles_covering_emi
  const emiTone = trucksTotal === 0
    ? 'neutral'
    : clearing * 2 > trucksTotal ? 'good' : 'warn'

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      {header}

      {/* A refetch that failed keeps the previous period on screen rather than
          throwing the owner back to an empty page. */}
      {error && <div className="mb-4"><ErrorNote message={error} /></div>}

      <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        {/* 1 — the six numbers the owner checks first */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Stat
            label="Revenue"
            value={inrCompact(score.revenue_inr)}
            sub={`Gross margin ${inrCompact(score.gross_margin_inr)}`}
            icon={<IndianRupee className="w-4 h-4" />}
          />
          <Stat
            label="Net profit"
            value={inrCompact(summary.net_profit_inr)}
            tone={summary.net_profit_inr >= 0 ? 'good' : 'bad'}
            sub={`${inrSigned(score.surplus_inr)} after EMI & fixed`}
            icon={<TrendingUp className="w-4 h-4" />}
          />
          <Stat
            label="Clearing EMI"
            value={`${clearing} / ${trucksTotal}`}
            tone={emiTone}
            sub={`EMI ${inrCompact(score.emi_inr)} this period`}
            icon={<Wallet className="w-4 h-4" />}
          />
          <Stat
            label="Active trucks"
            value={trucksTotal}
            sub={`Overhead ${inrCompact(summary.monthly_overhead_inr)}/mo`}
            icon={<Truck className="w-4 h-4" />}
          />
          <Stat
            label="Trips"
            value={summary.trips}
            sub={summary.trips > 0
              ? `${inrCompact(score.revenue_inr / summary.trips)} avg per trip`
              : 'No completed trips'}
            icon={<Route className="w-4 h-4" />}
          />
          <Stat
            label="Distance"
            value={km(utilization.distance_km)}
            sub={`${pct(utilization.distance_pct)} of expected`}
            icon={<Gauge className="w-4 h-4" />}
          />
        </div>

        {/* 2 — the hero: assets that did not pay for themselves */}
        <div className="mt-4">
          <ShortfallTable vehicles={vehicles} />
        </div>

        {/* 3 + 4 — what is moving, and where the money went */}
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <OnTheRoad live={live} bookings={inTransit} vehicles={vehicles} />
          <CostMix breakdown={summary.cost_breakdown_inr} />
        </div>
      </div>
    </div>
  )
}

// ── Assets that did not cover their EMI ───────────────────────

function ShortfallTable({ vehicles }: { vehicles: VehicleAnalytics[] }) {
  // Worst first: the most negative surplus is the truck to deal with today.
  const short = vehicles
    .filter(v => v.score.covered === false)
    .sort((a, b) => a.score.surplus_inr - b.score.surplus_inr)

  const totalShortfall = short.reduce((sum, v) => sum + v.score.surplus_inr, 0)

  return (
    <Card>
      <CardHead
        title="Assets that did not cover their EMI"
        sub={
          vehicles.length === 0
            ? 'No trucks in this fleet yet'
            : short.length === 0
              ? `All ${vehicles.length} trucks cleared running cost, fixed cost and EMI`
              : `${short.length} of ${vehicles.length} trucks — ${inr(Math.abs(totalShortfall))} short in total`
        }
      />

      {vehicles.length === 0 ? (
        <Empty
          title="No trucks on the books"
          hint="Add a truck under Trucks to start scoring it against its EMI."
        />
      ) : short.length === 0 ? (
        <Empty
          title="Every truck cleared its EMI this period"
          hint="Revenue covered running cost, the fixed-cost share and the EMI on all trucks."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <th className="py-2.5 px-4 text-left font-medium">Truck</th>
                <th className="py-2.5 px-4 text-left font-medium">Category</th>
                <th className="py-2.5 px-4 text-right font-medium">Trips</th>
                <th className="py-2.5 px-4 text-right font-medium">Distance</th>
                <th className="py-2.5 px-4 text-right font-medium">Gross margin</th>
                <th className="py-2.5 px-4 text-right font-medium">EMI</th>
                <th className="py-2.5 px-4 text-right font-medium">Shortfall</th>
                <th className="py-2.5 px-4 text-right font-medium">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {short.map(v => (
                <tr key={v.vehicle_id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-4 text-sm">
                    <Link
                      href={`/vehicles/${v.vehicle_id}`}
                      className="font-semibold text-blue-600 hover:text-blue-700"
                    >
                      {v.rc_number}
                    </Link>
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-600">{v.model_category ?? '—'}</td>
                  <td className="py-3 px-4 text-sm text-right tabular-nums text-gray-900">{v.trips}</td>
                  <td className="py-3 px-4 text-sm text-right tabular-nums text-gray-600">
                    {km(v.utilization.distance_km)}
                  </td>
                  <td className={`py-3 px-4 text-sm text-right tabular-nums ${
                    v.score.gross_margin_inr < 0 ? 'text-red-600' : 'text-gray-900'
                  }`}>
                    {inr(v.score.gross_margin_inr)}
                  </td>
                  <td className="py-3 px-4 text-sm text-right tabular-nums text-gray-600">
                    {inr(v.score.emi_inr)}
                  </td>
                  <td className="py-3 px-4 text-sm text-right tabular-nums font-semibold text-red-600">
                    {inrSigned(v.score.surplus_inr)}
                  </td>
                  <td className="py-3 px-4 text-sm text-right">
                    <CoverPill covered={v.score.covered} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

// ── On the road now ───────────────────────────────────────────

function OnTheRoad({
  live, bookings, vehicles,
}: {
  live: LivePosition[]
  bookings: FleetBooking[]
  vehicles: VehicleAnalytics[]
}) {
  const reporting = live.filter(hasFix)

  // The booking list carries only ids, so the RC number and the driver's name
  // are joined from data already on this page: the analytics roster and the
  // live-position roster.
  const rcByVehicle = new Map(vehicles.map(v => [v.vehicle_id, v.rc_number]))
  const nameByDriver = new Map(live.map(p => [p.driver_id, p.driver_name]))

  return (
    <Card>
      <CardHead
        title="On the road now"
        sub={`${reporting.length} of ${live.length} tracked trucks reporting a live fix`}
        actions={
          <Link
            href="/map"
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium px-3 py-1.5 text-gray-700"
          >
            <MapPin className="w-4 h-4" />
            Live map
          </Link>
        }
      />

      <div className="px-4 py-3 border-b border-gray-100 flex items-baseline gap-2">
        <span className="text-3xl font-bold text-gray-900 tabular-nums">{reporting.length}</span>
        <span className="text-xs text-gray-500">
          {reporting.length === 1 ? 'truck sending GPS' : 'trucks sending GPS'}
        </span>
      </div>

      {bookings.length === 0 ? (
        <Empty
          title="No trips in transit"
          hint="Trips appear here once a crewed booking leaves the pickup point."
        />
      ) : (
        <div>
          {bookings.map(b => {
            const rc = b.vehicle?.rc_number ?? (b.vehicle_id ? rcByVehicle.get(b.vehicle_id) : null)
            const driverName = b.driver?.full_name ?? (b.driver_id ? nameByDriver.get(b.driver_id) : null)
            return (
              <Link
                key={b.id}
                href="/trips"
                className="block px-4 py-3 border-b border-gray-50 last:border-b-0 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm text-gray-900 truncate">{b.source_address}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                  <span className="text-sm text-gray-900 truncate">{b.destination_address}</span>
                  <span className="ml-auto shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">
                    In transit
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
                  <span className="inline-flex items-center gap-1 font-medium text-gray-700">
                    <Truck className="w-3.5 h-3.5 text-gray-400" />
                    {rc ?? '—'}
                  </span>
                  <span>{driverName ?? '—'}</span>
                  <span className="tabular-nums">{tons(b.weight_kg)}</span>
                  <span className="tabular-nums">{inr(b.final_price ?? b.quoted_price)}</span>
                  <span>Pickup {shortDate(b.pickup_date)}</span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ── Cost mix ──────────────────────────────────────────────────

function CostMix({ breakdown }: { breakdown: CostBreakdown }) {
  const slices = COST_SLICES
    .map(s => ({ label: s.label, color: s.color, value: costAmount(breakdown, s.typedKey, s.wireKey) }))
    .filter(s => s.value > 0)

  const total = slices.reduce((sum, s) => sum + s.value, 0)
  const fuel = slices.find(s => s.label === 'Fuel')
  const fuelShare = total > 0 && fuel ? (fuel.value / total) * 100 : null

  return (
    <Card>
      <CardHead
        title="Where the money went"
        sub={total > 0 ? `${inr(total)} of running cost across the fleet` : 'No running cost recorded'}
      />

      {total <= 0 ? (
        <Empty
          title="No costs recorded this period"
          hint="Cost lines appear once trips are completed and rolled up."
        />
      ) : (
        <div className="p-4">
          {fuelShare !== null && fuel && (
            <p className="text-sm text-gray-600 mb-3">
              Fuel is{' '}
              <span className="font-semibold text-gray-900 tabular-nums">{pct(fuelShare)}</span>
              {' '}of running cost —{' '}
              <span className="font-semibold text-gray-900 tabular-nums">{inr(fuel.value)}</span>
            </p>
          )}

          <div
            className="flex h-5 w-full rounded-full overflow-hidden bg-gray-100"
            role="img"
            aria-label={`Cost mix: ${slices.map(s => `${s.label} ${inr(s.value)}`).join(', ')}`}
          >
            {slices.map(s => (
              <div
                key={s.label}
                className={s.color}
                style={{ width: `${(s.value / total) * 100}%` }}
                title={`${s.label} — ${inr(s.value)}`}
              />
            ))}
          </div>

          <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {slices.map(s => (
              <li key={s.label} className="flex items-center gap-2 text-sm">
                <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${s.color}`} />
                <span className="text-gray-600 truncate">{s.label}</span>
                <span className="ml-auto text-xs text-gray-400 tabular-nums">
                  {pct((s.value / total) * 100)}
                </span>
                <span className="w-24 text-right text-gray-900 tabular-nums">{inr(s.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
