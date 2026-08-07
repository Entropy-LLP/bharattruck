'use client'

// Fuel — modelled diesel spend vs what the driver actually filled.
//
// The single number this page exists to produce is the variance, and the single
// way to get it wrong is to show it confidently when nobody has entered a fuel
// bill. So the sign convention and the coverage caveat are both load-bearing:
//
//   bt-fleet-service/src/lib/analytics.ts → fuelComparison()
//     withActuals = rows.filter(r => r.fuel_cost_actual_inr != null)
//     estimated   = Σ fuel_cost_est_inr    OVER withActuals ONLY
//     actual      = Σ fuel_cost_actual_inr OVER withActuals ONLY
//     variance    = actual - estimated          ← POSITIVE means OVERSPEND (bad)
//     variance_pct = variance / estimated × 100 ← null when estimated is 0
//
// Two consequences the UI must respect:
//
//  1. Both columns cover the SAME trips. `estimated_inr` is not the fleet's whole
//     modelled diesel bill — it is the modelled cost of exactly those trips that
//     have an actual, so a fleet with one fuel entry is not shown as spending 3%
//     of what it should.
//  2. With trips_with_actuals === 0 every figure collapses to a clean ₹0 and the
//     variance is meaningless, not zero. That is the likely live state today
//     (actuals come from driver-side trip_expenses rows), so this page refuses to
//     render ₹0 variance and says why instead.
//
// by_vehicle is keyed off `withActuals` too, so a truck with no fuel entry in the
// window is ABSENT from the table rather than present with a flattering ₹0 gap.
// The zero-actuals branch below is defensive only.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Calculator, ClipboardList, Fuel, Info, TrendingDown, TrendingUp, TriangleAlert,
} from 'lucide-react'

import { PageHeader } from '@/components/app-shell'
import { Card, CardHead, Empty, ErrorNote, Loading, Meter, Stat } from '@/components/stat'
import { ApiError, getFuelComparison } from '@/lib/api'
import { inr, inrCompact, inrSigned, pct, periodDays } from '@/lib/format'
import type { FuelComparison } from '@/lib/types'

const PERIOD_OPTIONS = [30, 90, 180] as const
type PeriodChoice = (typeof PERIOD_OPTIONS)[number]

type VehicleRow = FuelComparison['by_vehicle'][number]

/** Positive variance = actual above model = money leaking. */
function varianceTone(variance: number): 'good' | 'bad' | 'neutral' {
  if (variance > 0) return 'bad'
  if (variance < 0) return 'good'
  return 'neutral'
}

function varianceText(variance: number): string {
  if (variance > 0) return 'text-red-600'
  if (variance < 0) return 'text-emerald-700'
  return 'text-gray-900'
}

export default function FuelPage() {
  const [days, setDays] = useState<PeriodChoice>(30)
  const [data, setData] = useState<FuelComparison | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Kick off only; every setState lands in a callback so the period buttons own
  // the loading/error transition (same pattern as the dashboard).
  useEffect(() => {
    let cancelled = false

    getFuelComparison(periodDays(days))
      .then(result => { if (!cancelled) setData(result) })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : 'Could not load the fuel report')
      })
      .finally(() => { if (!cancelled) setLoading(false) })

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
      title="Fuel"
      subtitle={`Modelled vs actual diesel — last ${days} days`}
      actions={switcher}
    />
  )

  if (loading && !data) {
    return (
      <div className="p-4 lg:p-6 max-w-7xl mx-auto">
        {header}
        <Loading label="Comparing modelled diesel against fuel entries" />
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="p-4 lg:p-6 max-w-7xl mx-auto">
        {header}
        <ErrorNote message={error} />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="p-4 lg:p-6 max-w-7xl mx-auto">
        {header}
        <Card>
          <Empty
            title="No fuel report for this window"
            hint="Complete a trip to start modelling its diesel cost."
          />
        </Card>
      </div>
    )
  }

  const covered = data.trips_with_actuals > 0
  const coveragePct = data.trips > 0 ? (data.trips_with_actuals / data.trips) * 100 : null

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      {header}

      {/* A failed refetch keeps the previous period on screen. */}
      {error && <div className="mb-4"><ErrorNote message={error} /></div>}

      <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        {/* 1 — the four numbers. Every money tile goes blank without coverage,
            because ₹0 here would read as "the model was exactly right". */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <Stat
            label="Estimated"
            value={covered ? inrCompact(data.estimated_inr) : '—'}
            sub={covered
              ? `Modelled diesel on the ${data.trips_with_actuals} compared ${data.trips_with_actuals === 1 ? 'trip' : 'trips'}`
              : 'Needs at least one fuel entry to compare'}
            icon={<Calculator className="w-4 h-4" />}
          />
          <Stat
            label="Actual"
            value={covered ? inrCompact(data.actual_inr) : '—'}
            sub={covered ? 'Summed from driver fuel entries' : 'No fuel entries recorded'}
            icon={<Fuel className="w-4 h-4" />}
          />
          <Stat
            label="Variance"
            value={covered ? inrSigned(data.variance_inr) : '—'}
            tone={covered ? varianceTone(data.variance_inr) : 'neutral'}
            sub={covered
              ? `${pct(data.variance_pct, 1)} ${data.variance_inr > 0 ? 'over model' : data.variance_inr < 0 ? 'under model' : 'against model'}`
              : 'Not measurable yet'}
            icon={data.variance_inr > 0
              ? <TrendingUp className="w-4 h-4" />
              : <TrendingDown className="w-4 h-4" />}
          />
          <Stat
            label="Coverage"
            value={`${data.trips_with_actuals} / ${data.trips}`}
            tone={covered ? 'neutral' : 'warn'}
            sub={data.trips === 0
              ? 'No completed trips in this window'
              : `${pct(coveragePct)} of trips have a fuel entry`}
            icon={<ClipboardList className="w-4 h-4" />}
          />
        </div>

        {/* 2 — the honest caveat, or the comparison itself. */}
        <div className="mt-4">
          {covered
            ? <Comparison data={data} coveragePct={coveragePct} />
            : <NoActuals trips={data.trips} days={days} />}
        </div>

        {/* 3 — per truck, worst gap first. */}
        <div className="mt-4">
          <ByVehicle rows={data.by_vehicle} covered={covered} />
        </div>

        {/* 4 — where the estimate comes from. */}
        <div className="mt-4">
          <HowTheEstimateWorks />
        </div>
      </div>
    </div>
  )
}

// ── No actuals: the likely live state ─────────────────────────

function NoActuals({ trips, days }: { trips: number; days: PeriodChoice }) {
  return (
    <div className="bg-white rounded-xl border border-orange-200 shadow-sm p-4">
      <div className="flex items-start gap-3">
        <span className="shrink-0 mt-0.5 text-orange-500">
          <TriangleAlert className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">
            No fuel entries in the last {days} days — there is nothing to compare
          </h2>
          <p className="mt-1.5 text-sm text-gray-600">
            Actual diesel spend is not metered from the truck. It comes from{' '}
            <span className="font-medium text-gray-900">fuel entries the driver records against a trip</span>{' '}
            in the driver app. Until a driver files one,{' '}
            {trips === 0
              ? 'and until a trip completes in this window,'
              : `and ${trips} completed ${trips === 1 ? 'trip has' : 'trips have'} none,`}{' '}
            the actual column is empty.
          </p>
          <p className="mt-2 text-sm text-gray-600">
            The variance is <span className="font-medium text-gray-900">not zero — it is unmeasured</span>.
            A ₹0 gap here would say the model was exactly right, which is a much
            stronger claim than the data supports, so the tiles above are blank
            instead.
          </p>
          <p className="mt-2 text-xs text-gray-500">
            The modelled estimate still runs on every trip and is already priced
            into each truck&apos;s running cost under Utilisation — this page only
            needs the driver-side receipt to check it.
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Estimated vs actual, side by side ─────────────────────────

function Comparison({ data, coveragePct }: { data: FuelComparison; coveragePct: number | null }) {
  const max = Math.max(data.estimated_inr, data.actual_inr, 1)
  const over = data.variance_inr > 0

  return (
    <Card>
      <CardHead
        title="Modelled vs actual"
        sub={`Both bars cover the same ${data.trips_with_actuals} ${data.trips_with_actuals === 1 ? 'trip' : 'trips'} — the ones with a fuel entry`}
      />
      <div className="p-4">
        <div className="space-y-3">
          <BarRow
            label="Estimated"
            value={data.estimated_inr}
            share={(data.estimated_inr / max) * 100}
            color="bg-gray-300"
          />
          <BarRow
            label="Actual"
            value={data.actual_inr}
            share={(data.actual_inr / max) * 100}
            color={over ? 'bg-red-500' : 'bg-emerald-500'}
          />
        </div>

        <p className={`mt-4 text-sm ${over ? 'text-red-700' : 'text-emerald-800'}`}>
          Drivers filled{' '}
          <span className="font-semibold tabular-nums">{inr(Math.abs(data.variance_inr))}</span>{' '}
          {over ? 'more' : 'less'} diesel than the model expected
          {data.variance_pct === null
            ? ''
            : <> — <span className="font-semibold tabular-nums">{pct(Math.abs(data.variance_pct), 1)}</span>{' '}
                {over ? 'above' : 'below'} estimate</>}
          .
        </p>

        <p className="mt-2 text-xs text-gray-500">
          {over
            ? 'A gap that persists on the same truck month after month is the pilferage or derate signal — not a one-off.'
            : 'Spending under the model is not automatically good news: a missing fuel bill looks identical to genuinely better mileage.'}
        </p>

        {coveragePct !== null && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <Meter pct={coveragePct} label="Trips with a driver fuel entry" />
            <p className="mt-1.5 text-xs text-gray-500">
              {data.trips_with_actuals} of {data.trips} completed trips.
              {coveragePct < 100 && ' The rest are excluded from both columns above.'}
            </p>
          </div>
        )}
      </div>
    </Card>
  )
}

function BarRow({
  label, value, share, color,
}: { label: string; value: number; share: number; color: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs text-gray-400 uppercase tracking-wide">{label}</span>
        <span className="text-sm font-semibold text-gray-900 tabular-nums">{inr(value)}</span>
      </div>
      <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-[width] duration-500`}
          style={{ width: `${Math.max(0, Math.min(100, share))}%` }}
        />
      </div>
    </div>
  )
}

// ── Per truck ─────────────────────────────────────────────────

function ByVehicle({ rows, covered }: { rows: VehicleRow[]; covered: boolean }) {
  // Biggest gap first regardless of direction — an under-report of ₹40k is as
  // worth opening as an overspend of ₹40k. Trucks without an actual (which the
  // service does not currently emit) can never be ranked, so they sink.
  const sorted = [...rows].sort((a, b) => {
    const aHas = a.trips_with_actuals > 0
    const bHas = b.trips_with_actuals > 0
    if (aHas !== bHas) return aHas ? -1 : 1
    return Math.abs(b.variance_inr) - Math.abs(a.variance_inr)
  })

  const comparable = sorted.filter(v => v.trips_with_actuals > 0)
  const maxAbs = comparable.reduce((m, v) => Math.max(m, Math.abs(v.variance_inr)), 0)
  const overspending = comparable.filter(v => v.variance_inr > 0).length

  return (
    <Card>
      <CardHead
        title="Gap by truck"
        sub={comparable.length === 0
          ? 'Only trucks with at least one driver fuel entry can appear here'
          : `${comparable.length} ${comparable.length === 1 ? 'truck' : 'trucks'} comparable — ${overspending} over model. Biggest gap first.`}
      />

      {sorted.length === 0 ? (
        <Empty
          title={covered ? 'No truck-level gaps to show' : 'No truck has a fuel entry in this window'}
          hint="A truck enters this table once a driver files a fuel entry against one of its trips. Trucks without one are absent, not shown at ₹0."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px]">
            <thead>
              <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <th className="py-2.5 px-4 text-left font-medium">Truck</th>
                <th className="py-2.5 px-4 text-right font-medium">Estimated</th>
                <th className="py-2.5 px-4 text-right font-medium">Actual</th>
                <th className="py-2.5 px-4 text-right font-medium">Variance</th>
                <th className="py-2.5 px-4 text-right font-medium">Var %</th>
                <th className="py-2.5 px-4 text-left font-medium w-40">Gap</th>
                <th className="py-2.5 px-4 text-right font-medium">Trips w/ entry</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(v => {
                const has = v.trips_with_actuals > 0
                return (
                  <tr
                    key={v.vehicle_id}
                    className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
                  >
                    <td className="py-3 px-4 text-sm">
                      <Link
                        href={`/vehicles/${v.vehicle_id}`}
                        className={`font-semibold ${
                          has ? 'text-blue-600 hover:text-blue-700' : 'text-gray-400 hover:text-gray-600'
                        }`}
                      >
                        {v.rc_number || 'Unknown truck'}
                      </Link>
                    </td>
                    <td className={`py-3 px-4 text-sm text-right tabular-nums ${
                      has ? 'text-gray-600' : 'text-gray-400'
                    }`}>
                      {has ? inr(v.estimated_inr) : '—'}
                    </td>
                    <td className={`py-3 px-4 text-sm text-right tabular-nums ${
                      has ? 'text-gray-900' : 'text-gray-400'
                    }`}>
                      {has ? inr(v.actual_inr) : '—'}
                    </td>
                    <td className={`py-3 px-4 text-sm text-right tabular-nums font-semibold ${
                      has ? varianceText(v.variance_inr) : 'text-gray-400'
                    }`}>
                      {has ? inrSigned(v.variance_inr) : '—'}
                    </td>
                    <td className={`py-3 px-4 text-sm text-right tabular-nums ${
                      has ? varianceText(v.variance_inr) : 'text-gray-400'
                    }`}>
                      {has ? pct(v.variance_pct, 1) : '—'}
                    </td>
                    <td className="py-3 px-4">
                      {has
                        ? <GapBar value={v.variance_inr} max={maxAbs} />
                        : <span className="text-xs text-gray-400">No entry</span>}
                    </td>
                    <td className={`py-3 px-4 text-sm text-right tabular-nums ${
                      has ? 'text-gray-600' : 'text-gray-400'
                    }`}>
                      {v.trips_with_actuals}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="px-4 py-3 border-t border-gray-100 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-red-500" />
          Over model — filled more diesel than estimated
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
          Under model — or a fuel bill that never got filed
        </span>
      </div>
    </Card>
  )
}

/** Diverging bar around a centre line: right/red is overspend, left/green is under. */
function GapBar({ value, max }: { value: number; max: number }) {
  const share = max > 0 ? Math.min(100, (Math.abs(value) / max) * 100) : 0
  const over = value > 0
  return (
    <div className="relative h-2 w-full min-w-[100px] rounded-full bg-gray-100">
      <span className="absolute inset-y-0 left-1/2 w-px -ml-px bg-gray-300" />
      <span
        className={`absolute inset-y-0 rounded-full ${over ? 'bg-red-500' : 'bg-emerald-500'}`}
        style={over
          ? { left: '50%', width: `${share / 2}%` }
          : { right: '50%', width: `${share / 2}%` }}
      />
    </div>
  )
}

// ── Provenance ────────────────────────────────────────────────

function HowTheEstimateWorks() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div className="flex items-start gap-3">
        <span className="shrink-0 mt-0.5 text-gray-300">
          <Info className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">How the estimate is built</h2>
          <p className="mt-1 text-sm text-gray-600">
            The estimate is the corridor distance divided by the kmpl norm for that
            truck&apos;s model category and emission norm, priced at the fleet&apos;s
            diesel rate — the norms come from the founder&apos;s CV parc workbook, not
            a flat per-km constant.
          </p>
          <p className="mt-2 text-xs text-gray-500">
            Actuals are driver-side fuel entries against the trip. A trip only enters
            this report once it has one, so the estimate is never compared against a
            missing bill.
          </p>
        </div>
      </div>
    </div>
  )
}
