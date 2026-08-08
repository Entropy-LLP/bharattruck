'use client'

// Utilisation — "is the truck full, and is it moving?"
//
// The three utilisation numbers on this page answer DIFFERENT questions and are
// deliberately never averaged together (bt-fleet-service/src/lib/analytics.ts,
// computeUtilization):
//
//   tonnage_pct  = Σ laden_weight_kg   ÷ Σ capacity_kg     — full by weight
//   volume_pct   = Σ volume_used_cuft  ÷ Σ capacity_cuft   — full by space
//   distance_pct = Σ distance_km       ÷ expected km       — moving at all
//
// The first two sum only over trips that actually ran, so their denominators
// shrink with idle time; distance_pct is the only one measured against the
// calendar. A truck that did one perfectly loaded trip in 30 days reads 100%
// tonnage and ~3% distance, and the owner has to see both.
//
// Below them is the headline the running-cost score answers: revenue minus
// running cost minus this asset's pro-rated share of fixed cost (EMI, annuals,
// office overhead) — did the asset pay for itself.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  ArrowDown, ArrowUp, ArrowUpDown, Box, Gauge, Route, TrendingUp, Wallet, Weight,
} from 'lucide-react'

import { PageHeader } from '@/components/app-shell'
import {
  Card, CardHead, CoverPill, Empty, ErrorNote, InfoDot, Loading, Meter, Stat,
} from '@/components/stat'
import {
  ApiError, getDriverAnalytics, getFleetSummary, getVehicleAnalytics,
} from '@/lib/api'
import { inr, inrCompact, inrSigned, km, pct, periodDays, shortDate, tons } from '@/lib/format'
import type { DriverAnalytics, FleetSummary, Utilization, VehicleAnalytics } from '@/lib/types'

const PERIOD_OPTIONS = [30, 90, 180] as const
type PeriodChoice = (typeof PERIOD_OPTIONS)[number]

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return 'Something went wrong'
}

/** Cubic feet, Indian grouping. There is no format.ts helper for volume. */
function cuft(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return `${Math.round(n).toLocaleString('en-IN')} cu ft`
}

/**
 * Same thresholds as <Meter> so a number in the table and a bar above it never
 * disagree about whether 48% is bad.
 */
function utilTone(value: number | null): string {
  if (value === null || Number.isNaN(value)) return 'text-gray-400'
  if (value >= 75) return 'text-emerald-700'
  if (value >= 50) return 'text-gray-900'
  if (value >= 30) return 'text-orange-600'
  return 'text-red-600'
}

// ── Page ──────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [days, setDays] = useState<PeriodChoice>(30)
  const [summary, setSummary] = useState<FleetSummary | null>(null)
  const [vehicles, setVehicles] = useState<VehicleAnalytics[]>([])
  const [drivers, setDrivers] = useState<DriverAnalytics[]>([])
  const [driverError, setDriverError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // The effect only kicks the requests off; every setState happens in a
  // callback, matching the dashboard. Flipping loading/error synchronously in
  // the effect body trips react-hooks/set-state-in-effect, so the period
  // buttons own that transition.
  useEffect(() => {
    let cancelled = false
    const period = periodDays(days)

    Promise.all([
      getFleetSummary(period),
      getVehicleAnalytics(period),
      // The driver roll-up hydrates identities from a second service. Settle it
      // separately: a leaderboard that fails must not blank the utilisation
      // report, which is what this page is actually for.
      getDriverAnalytics(period).then(
        res => ({ ok: true as const, res }),
        (err: unknown) => ({ ok: false as const, err }),
      ),
    ])
      .then(([summaryData, vehicleData, driverData]) => {
        if (cancelled) return
        setSummary(summaryData)
        setVehicles(vehicleData?.vehicles ?? [])
        if (driverData.ok) {
          setDrivers(driverData.res?.drivers ?? [])
          setDriverError(null)
        } else {
          setDrivers([])
          setDriverError(messageOf(driverData.err))
        }
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(messageOf(err))
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
            days === option ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          {option}d
        </button>
      ))}
    </div>
  )

  const header = (
    <PageHeader
      title="Utilisation"
      info="Whether each truck ran full and paid for itself."
      actions={switcher}
    />
  )

  if (loading && !summary) {
    return (
      <div className="p-4 lg:p-6 max-w-7xl mx-auto">
        {header}
        <Loading label="Working out utilisation" />
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
        <Card>
          <Empty
            title="No utilisation data yet"
            hint="Add a truck and complete a trip."
          />
        </Card>
      </div>
    )
  }

  const periodLabel = `${shortDate(summary.period.from)} – ${shortDate(summary.period.to)}`

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      {header}

      {/* A refetch that failed keeps the previous period on screen. */}
      {error && <div className="mb-4"><ErrorNote message={error} /></div>}

      <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Stat
            label="Trips"
            value={summary.trips}
            sub={`${summary.active_vehicles} ${summary.active_vehicles === 1 ? 'truck' : 'trucks'} on the books`}
            icon={<Route className="w-4 h-4" />}
          />
          <Stat
            label="Clearing EMI"
            value={`${summary.vehicles_covering_emi} / ${summary.active_vehicles}`}
            tone={
              summary.active_vehicles === 0
                ? 'neutral'
                : summary.vehicles_covering_emi * 2 > summary.active_vehicles ? 'good' : 'warn'
            }
            sub={`EMI ${inrCompact(summary.score.emi_inr)} over ${days} days`}
            icon={<Wallet className="w-4 h-4" />}
          />
          <Stat
            label="Fleet surplus"
            value={inrCompact(summary.score.surplus_inr)}
            tone={summary.score.surplus_inr >= 0 ? 'good' : 'bad'}
            sub={`After ${inrCompact(summary.score.fixed_cost_inr)} of fixed cost`}
            icon={<TrendingUp className="w-4 h-4" />}
          />
        </div>

        <div className="mt-4">
          <FleetUtilisation
            utilization={summary.utilization}
            sub={`${summary.trips} ${summary.trips === 1 ? 'trip' : 'trips'} across ${summary.active_vehicles} ${
              summary.active_vehicles === 1 ? 'truck' : 'trucks'
            } · ${periodLabel}`}
          />
        </div>

        <div className="mt-4">
          <VehicleTable vehicles={vehicles} periodLabel={periodLabel} />
        </div>

        <div className="mt-4">
          <RunningCostChart vehicles={vehicles} days={days} />
        </div>

        <div className="mt-4">
          <DriverLeaderboard drivers={drivers} errorMessage={driverError} periodLabel={periodLabel} />
        </div>
      </div>
    </div>
  )
}

// ── 1-3: the three fleet-level views ──────────────────────────

function UtilPanel({
  icon, title, info, meterLabel, value, rows,
}: {
  icon: ReactNode
  title: string
  info: string
  meterLabel: string
  value: number | null
  rows: { label: string; value: string }[]
}) {
  return (
    <div className="p-4">
      <div className="flex items-center gap-2">
        <span className="text-gray-400">{icon}</span>
        <h3 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-1.5">
          {title}
          <InfoDot text={info} />
        </h3>
      </div>

      <div className="mt-3">
        <Meter pct={value} label={meterLabel} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3">
        {rows.map(row => (
          <div key={row.label} className="min-w-0">
            <dt className="text-xs text-gray-400 uppercase tracking-wide">{row.label}</dt>
            <dd className="text-sm text-gray-900 tabular-nums truncate">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function FleetUtilisation({ utilization, sub }: { utilization: Utilization; sub: string }) {
  const u = utilization

  return (
    <Card>
      <CardHead title="Fleet utilisation" sub={sub} />

      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-gray-100">
        <UtilPanel
          icon={<Weight className="w-4 h-4" />}
          title="Tonnage"
          info="Load weight carried vs the trucks' weight capacity, on trips that ran."
          meterLabel="Laden weight vs capacity"
          value={u.tonnage_pct}
          rows={[
            { label: 'Carried', value: tons(u.laden_weight_kg) },
            { label: 'Capacity offered', value: tons(u.capacity_kg) },
          ]}
        />
        <UtilPanel
          icon={<Box className="w-4 h-4" />}
          title="Volume"
          info="Cargo space used vs capacity — read alongside tonnage, not instead."
          meterLabel="Cubic feet used vs capacity"
          value={u.volume_pct}
          rows={[
            { label: 'Used', value: cuft(u.volume_used_cuft) },
            { label: 'Capacity offered', value: cuft(u.capacity_cuft) },
          ]}
        />
        <UtilPanel
          icon={<Gauge className="w-4 h-4" />}
          title="Distance"
          info="Actual km vs the category's expected km — exposes idle trucks."
          meterLabel="Actual km vs expected km"
          value={u.distance_pct}
          rows={[
            { label: 'Actual', value: km(u.distance_km) },
            { label: 'Expected', value: km(u.expected_distance_km) },
          ]}
        />
      </div>
    </Card>
  )
}

// ── Per-vehicle table ─────────────────────────────────────────

type SortKey = 'tonnage' | 'volume' | 'distance' | 'surplus'
type SortDir = 'asc' | 'desc'

function metricOf(v: VehicleAnalytics, key: SortKey): number | null {
  switch (key) {
    case 'tonnage': return v.utilization.tonnage_pct
    case 'volume': return v.utilization.volume_pct
    case 'distance': return v.utilization.distance_pct
    case 'surplus': return v.score.surplus_inr
  }
}

const SORT_LABEL: Record<SortKey, string> = {
  tonnage: 'tonnage use',
  volume: 'volume use',
  distance: 'distance use',
  surplus: 'surplus',
}

function SortableHeader({
  label, sortKey, active, dir, onSort,
}: {
  label: string
  sortKey: SortKey
  active: boolean
  dir: SortDir
  onSort: (key: SortKey) => void
}) {
  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th className="py-3 px-4 text-right font-medium" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={`Sort by ${SORT_LABEL[sortKey]}`}
        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 -mr-2 uppercase tracking-wide transition-colors ${
          active ? 'text-blue-700 bg-blue-50' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
        }`}
      >
        {label}
        <Icon className={`w-3.5 h-3.5 shrink-0 ${active ? '' : 'opacity-50'}`} />
      </button>
    </th>
  )
}

function VehicleTable({ vehicles, periodLabel }: { vehicles: VehicleAnalytics[]; periodLabel: string }) {
  // Worst surplus first by default — the truck to deal with today is the one at
  // the top of the page, not the one buried alphabetically.
  const [sortKey, setSortKey] = useState<SortKey>('surplus')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  function onSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    // Percentages are most useful worst-first too, so every column opens ascending.
    setSortDir('asc')
  }

  const sorted = useMemo(() => {
    const rows = [...vehicles]
    rows.sort((a, b) => {
      const av = metricOf(a, sortKey)
      const bv = metricOf(b, sortKey)
      // Nulls are "not enough data", not "zero" — they sink to the bottom in
      // both directions rather than pretending to be the worst performer.
      if (av === null && bv === null) return a.rc_number.localeCompare(b.rc_number)
      if (av === null) return 1
      if (bv === null) return -1
      if (av === bv) return a.rc_number.localeCompare(b.rc_number)
      return sortDir === 'asc' ? av - bv : bv - av
    })
    return rows
  }, [vehicles, sortKey, sortDir])

  const shortCount = vehicles.filter(v => v.score.covered === false).length

  return (
    <Card>
      <CardHead
        title="Per-truck utilisation"
        info="Per-truck revenue, cost and surplus — an idle truck still carries its EMI."
        sub={
          vehicles.length === 0
            ? 'No trucks in this fleet yet'
            : `${vehicles.length} ${vehicles.length === 1 ? 'truck' : 'trucks'} · sorted by ${SORT_LABEL[sortKey]} ${
                sortDir === 'asc' ? 'lowest first' : 'highest first'
              } · ${periodLabel}`
        }
      />

      {vehicles.length === 0 ? (
        <Empty
          title="No trucks on the books"
          hint="Add a truck under Trucks to start scoring it."
        />
      ) : (
        <>
          {shortCount > 0 && (
            <div className="px-4 py-2.5 border-b border-gray-100 text-xs text-gray-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-0.5 h-3 bg-red-400 align-middle" />
                {shortCount} {shortCount === 1 ? 'truck' : 'trucks'} did not cover their cost.
              </span>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px]">
              <thead>
                <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                  <th className="py-3 px-4 text-left font-medium">RC number</th>
                  <th className="py-3 px-4 text-left font-medium">Category</th>
                  <th className="py-3 px-4 text-right font-medium">Trips</th>
                  <SortableHeader label="Tonnage" sortKey="tonnage" active={sortKey === 'tonnage'} dir={sortDir} onSort={onSort} />
                  <SortableHeader label="Volume" sortKey="volume" active={sortKey === 'volume'} dir={sortDir} onSort={onSort} />
                  <SortableHeader label="Distance" sortKey="distance" active={sortKey === 'distance'} dir={sortDir} onSort={onSort} />
                  <th className="py-3 px-4 text-right font-medium">Revenue / km</th>
                  <th className="py-3 px-4 text-right font-medium">Cost / km</th>
                  <SortableHeader label="Surplus" sortKey="surplus" active={sortKey === 'surplus'} dir={sortDir} onSort={onSort} />
                  <th className="py-3 px-4 text-right font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(v => {
                  const short = v.score.covered === false
                  return (
                    <tr
                      key={v.vehicle_id}
                      className={`border-b border-gray-50 transition-colors ${
                        short ? 'bg-red-50/40 hover:bg-red-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className={`py-3 px-4 text-sm border-l-2 ${short ? 'border-l-red-400' : 'border-l-transparent'}`}>
                        <Link
                          href={`/vehicles/${v.vehicle_id}`}
                          className="font-semibold text-blue-600 hover:text-blue-700 hover:underline"
                        >
                          {v.rc_number}
                        </Link>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-600">
                        {v.model_category ?? <span className="text-gray-400">—</span>}
                      </td>
                      <td className="py-3 px-4 text-sm text-right tabular-nums text-gray-900">{v.trips}</td>
                      <td className={`py-3 px-4 text-sm text-right tabular-nums ${utilTone(v.utilization.tonnage_pct)}`}>
                        {pct(v.utilization.tonnage_pct)}
                      </td>
                      <td className={`py-3 px-4 text-sm text-right tabular-nums ${utilTone(v.utilization.volume_pct)}`}>
                        {pct(v.utilization.volume_pct)}
                      </td>
                      <td className={`py-3 px-4 text-sm text-right tabular-nums ${utilTone(v.utilization.distance_pct)}`}>
                        {pct(v.utilization.distance_pct)}
                      </td>
                      <td className="py-3 px-4 text-sm text-right tabular-nums text-gray-900">
                        {v.revenue_per_km_inr === null
                          ? <span className="text-gray-400">—</span>
                          : inr(v.revenue_per_km_inr)}
                      </td>
                      <td className="py-3 px-4 text-sm text-right tabular-nums text-gray-600">
                        {v.cost_per_km_inr === null
                          ? <span className="text-gray-400">—</span>
                          : inr(v.cost_per_km_inr)}
                      </td>
                      <td className={`py-3 px-4 text-sm text-right tabular-nums font-semibold ${
                        v.score.surplus_inr >= 0 ? 'text-emerald-700' : 'text-red-600'
                      }`}>
                        {inrSigned(v.score.surplus_inr)}
                      </td>
                      <td className="py-3 px-4 text-sm text-right">
                        <CoverPill covered={v.score.covered} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

        </>
      )}
    </Card>
  )
}

// ── Running-cost score: diverging bars ────────────────────────

function RunningCostChart({ vehicles, days }: { vehicles: VehicleAnalytics[]; days: number }) {
  const ranked = useMemo(
    () => [...vehicles].sort((a, b) => b.score.surplus_inr - a.score.surplus_inr),
    [vehicles],
  )

  // One shared scale so the bars are comparable across the fleet: the widest bar
  // is the biggest number in either direction.
  const maxAbs = ranked.reduce((max, v) => Math.max(max, Math.abs(v.score.surplus_inr)), 0)
  const covered = ranked.filter(v => v.score.covered).length

  return (
    <Card>
      <CardHead
        title="Running-cost score"
        info="Revenue minus running, fixed and EMI cost — right of the line paid for itself."
        sub={
          vehicles.length === 0
            ? 'No trucks to score'
            : `${covered} of ${ranked.length} cleared running cost, fixed cost and EMI over ${days} days`
        }
      />

      {vehicles.length === 0 ? (
        <Empty
          title="Nothing to rank yet"
          hint="Add a truck to see it ranked."
        />
      ) : (
        <div className="p-4">
          <div className="flex items-center gap-3 text-[11px] text-gray-400 uppercase tracking-wide mb-1.5">
            <span className="w-20 sm:w-28 shrink-0" />
            <span className="flex-1 min-w-0 flex justify-between">
              <span>Short</span>
              <span>Breaks even</span>
              <span>Surplus</span>
            </span>
            <span className="w-24 sm:w-28 shrink-0" />
          </div>

          <ul className="space-y-1.5">
            {ranked.map(v => {
              const value = v.score.surplus_inr
              const positive = value >= 0
              // Half the track per side; a non-zero amount always gets a sliver
              // so it never renders as an invisible bar.
              const width = maxAbs > 0 ? Math.max(value === 0 ? 0 : 0.6, (Math.abs(value) / maxAbs) * 50) : 0

              return (
                <li key={v.vehicle_id} className="flex items-center gap-3">
                  <Link
                    href={`/vehicles/${v.vehicle_id}`}
                    className="w-20 sm:w-28 shrink-0 text-right text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline truncate"
                    title={v.rc_number}
                  >
                    {v.rc_number}
                  </Link>

                  <div
                    className="relative flex-1 min-w-0 h-6 rounded-md bg-gray-50"
                    role="img"
                    aria-label={`${v.rc_number}: ${inrSigned(value)}`}
                  >
                    <span className="absolute inset-y-0 left-1/2 w-px bg-gray-300" />
                    <span
                      className={`absolute inset-y-1.5 ${
                        positive ? 'left-1/2 rounded-r-sm bg-emerald-500' : 'right-1/2 rounded-l-sm bg-red-500'
                      }`}
                      style={{ width: `${width}%` }}
                    />
                  </div>

                  <span className={`w-24 sm:w-28 shrink-0 text-right text-xs font-semibold tabular-nums ${
                    positive ? 'text-emerald-700' : 'text-red-600'
                  }`}>
                    {inrSigned(value)}
                  </span>
                </li>
              )
            })}
          </ul>

          {maxAbs === 0 && (
            <p className="mt-4 text-xs text-gray-500">
              Every truck scored exactly zero this period.
            </p>
          )}
        </div>
      )}
    </Card>
  )
}

// ── Driver leaderboard ────────────────────────────────────────

function DriverLeaderboard({
  drivers, errorMessage, periodLabel,
}: {
  drivers: DriverAnalytics[]
  errorMessage: string | null
  periodLabel: string
}) {
  const ranked = useMemo(
    () => [...drivers].sort((a, b) => b.net_profit_inr - a.net_profit_inr),
    [drivers],
  )

  return (
    <Card>
      <CardHead
        title="Driver leaderboard"
        info="Net profit per trip, after the driver's wage — excludes EMI and overhead."
        sub={
          errorMessage
            ? 'Could not be loaded'
            : ranked.length === 0
              ? 'No driver-attributed trips in this window'
              : `${ranked.length} ${ranked.length === 1 ? 'driver' : 'drivers'} by net profit contributed · ${periodLabel}`
        }
      />

      {errorMessage ? (
        <div className="p-4">
          <ErrorNote message={errorMessage} />
        </div>
      ) : ranked.length === 0 ? (
        <Empty
          title="No driver figures yet"
          hint="Appears once a crewed trip is completed."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <th className="py-3 px-4 text-left font-medium">#</th>
                <th className="py-3 px-4 text-left font-medium">Driver</th>
                <th className="py-3 px-4 text-right font-medium">Trips</th>
                <th className="py-3 px-4 text-right font-medium">Distance</th>
                <th className="py-3 px-4 text-right font-medium">Net profit</th>
                <th className="py-3 px-4 text-right font-medium">Wage allocated</th>
                <th className="py-3 px-4 text-right font-medium">Net profit / km</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((d, index) => (
                <tr key={d.driver_id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-4 text-sm tabular-nums text-gray-400">{index + 1}</td>
                  <td className="py-3 px-4 text-sm">
                    <div className="font-medium text-gray-900 truncate">
                      {d.full_name ?? 'Unnamed driver'}
                    </div>
                    {d.phone_number && (
                      <div className="text-xs text-gray-400 tabular-nums">{d.phone_number}</div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-sm text-right tabular-nums text-gray-900">{d.trips}</td>
                  <td className="py-3 px-4 text-sm text-right tabular-nums text-gray-600">
                    {km(d.distance_km)}
                  </td>
                  <td className={`py-3 px-4 text-sm text-right tabular-nums font-semibold ${
                    d.net_profit_inr >= 0 ? 'text-emerald-700' : 'text-red-600'
                  }`}>
                    {inr(d.net_profit_inr)}
                  </td>
                  <td className="py-3 px-4 text-sm text-right tabular-nums text-gray-600">
                    {inr(d.wage_allocated_inr)}
                  </td>
                  <td className="py-3 px-4 text-sm text-right tabular-nums text-gray-900">
                    {d.net_profit_per_km_inr === null
                      ? <span className="text-gray-400">—</span>
                      : inr(d.net_profit_per_km_inr)}
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
