'use client'

// Trucks — the asset register.
//
// One row per truck, joined to the per-asset analytics run so the owner can see
// "does this thing pay for itself" without opening it. The join is by vehicle_id
// and is deliberately tolerant: analytics is a SEPARATE call that can fail or
// come back short, and a missing row must read as '—', never as a crash or a
// fabricated zero.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { AlertTriangle, Plus, Search, Truck, Upload } from 'lucide-react'

import { PageHeader } from '@/components/app-shell'
import {
  Card, CardHead, CoverPill, Empty, ErrorNote, Loading, Meter, Stat,
} from '@/components/stat'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  ApiError, bulkImportVehicles, createVehicle, getVehicleAnalytics,
  listModelCategories, listVehicles,
  type BulkImportFormat, type BulkImportResult,
} from '@/lib/api'
import { inrSigned, km, pct, shortDate, vehicleAge } from '@/lib/format'
import type { EmissionNorm, Period, Vehicle, VehicleAnalytics } from '@/lib/types'

// ── Allowed values ────────────────────────────────────────────
// body_type / axle_config are constrained values, not free text — these lists
// mirror bt-auth-service/src/routes/onboarding.ts and the seeded rows. A value
// outside them is a 400, so the form only ever offers these.

// Typed against EmissionNorm on purpose: if the union moves in types.ts, this
// list is a compile error rather than a select that offers a rejected value.
const EMISSION_NORMS: readonly EmissionNorm[] = ['BS4', 'BS6', 'BS6_PH2']
const BODY_TYPES = ['open', 'closed', 'container', 'flatbed', 'tanker', 'refrigerated'] as const
const AXLE_CONFIGS = ['4x2', '6x2', '6x4', '8x4', '10x2'] as const

/** Narrow a raw <select> value back to its literal union, or null if unknown. */
function oneOf<T extends string>(allowed: readonly T[], value: string): T | null {
  return (allowed as readonly string[]).includes(value) ? (value as T) : null
}

function normLabel(norm: string): string {
  return norm === 'BS6_PH2' ? 'BS6 Ph2' : norm
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return 'Something went wrong'
}

function toNumber(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

function toInt(raw: string): number | null {
  const n = toNumber(raw)
  return n === null ? null : Math.round(n)
}

/**
 * The model-category endpoint is typed as ModelCategory[] in the client but the
 * service returns the bare category names. Read both shapes rather than render
 * a list of blanks.
 */
function categoryName(entry: unknown): string | null {
  if (typeof entry === 'string') return entry.trim() || null
  if (entry !== null && typeof entry === 'object') {
    const value = (entry as Record<string, unknown>).model_category
    if (typeof value === 'string') return value.trim() || null
  }
  return null
}

// ── Add-truck form ────────────────────────────────────────────

type FormState = {
  rc_number: string
  maker_model: string
  model_category: string
  emission_norm: string
  manufacture_year: string
  capacity_tons: string
  volume_cuft: string
  body_type: string
  axle_config: string
  current_odometer_km: string
}

const EMPTY_FORM: FormState = {
  rc_number: '', maker_model: '', model_category: '', emission_norm: '',
  manufacture_year: '', capacity_tons: '', volume_cuft: '', body_type: '',
  axle_config: '', current_odometer_km: '',
}

const FIELD_KEYS: (keyof FormState)[] = [
  'rc_number', 'maker_model', 'model_category', 'emission_norm', 'manufacture_year',
  'capacity_tons', 'volume_cuft', 'body_type', 'axle_config', 'current_odometer_km',
]

/**
 * The service returns only the FIRST failing field message ("rc_number must be
 * at least 4 characters"), with no field key. Recover the field from the message
 * so the error lands on the input the owner has to fix.
 */
function fieldForMessage(message: string): keyof FormState | null {
  const lower = message.toLowerCase()
  return FIELD_KEYS.find(key => lower.includes(key)) ?? null
}

const labelClass = 'block text-xs text-gray-400 uppercase tracking-wide mb-1'
const inputClass = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
const errorInputClass = 'w-full rounded-lg border border-red-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent'
const primaryBtn = 'rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 active:scale-[0.98] transition-transform disabled:opacity-50 disabled:pointer-events-none'
const secondaryBtn = 'rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium px-4 py-2.5 disabled:opacity-50 disabled:pointer-events-none'

// ── Loading ───────────────────────────────────────────────────

type RegisterData = {
  vehicles: Vehicle[]
  analytics: VehicleAnalytics[]
  period: Period | null
  analyticsError: string | null
}

/**
 * Fetch, no state. Analytics is settled SEPARATELY from the vehicle list: the
 * register is the page and must render even when the economics report fails, so
 * a rejected analytics call degrades two columns instead of the whole screen.
 */
async function fetchRegister(): Promise<RegisterData> {
  const [vehicles, report] = await Promise.all([
    listVehicles(),
    getVehicleAnalytics().then(
      res => ({ ok: true as const, res }),
      (err: unknown) => ({ ok: false as const, err }),
    ),
  ])
  return report.ok
    ? {
        vehicles,
        analytics: report.res.vehicles,
        period: report.res.period,
        analyticsError: null,
      }
    : {
        vehicles,
        analytics: [],
        period: null,
        analyticsError: messageOf(report.err),
      }
}

// ── Page ──────────────────────────────────────────────────────

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [analytics, setAnalytics] = useState<VehicleAnalytics[]>([])
  const [period, setPeriod] = useState<Period | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [analyticsError, setAnalyticsError] = useState<string | null>(null)

  const [categoryRows, setCategoryRows] = useState<unknown[]>([])

  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  const [addOpen, setAddOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)

  const applyData = useCallback((data: RegisterData) => {
    setVehicles(data.vehicles)
    setAnalytics(data.analytics)
    setPeriod(data.period)
    setAnalyticsError(data.analyticsError)
    setError(null)
    setLoading(false)
  }, [])

  const applyError = useCallback((err: unknown) => {
    setError(messageOf(err))
    setLoading(false)
  }, [])

  useEffect(() => {
    let live = true
    fetchRegister().then(
      data => { if (live) applyData(data) },
      (err: unknown) => { if (live) applyError(err) },
    )
    // The owner can navigate away mid-flight; without this a late response sets
    // state on an unmounted page.
    return () => { live = false }
  }, [applyData, applyError])

  /**
   * Post-write reload. `loading` is deliberately NOT raised again — the table is
   * already correct enough to look at, so a create or import swaps the rows in
   * place under an "Updating" hint instead of blanking the page. A failure here
   * is reported ABOVE the table rather than through `error`, which would replace
   * a register the owner is mid-read with an error card.
   */
  const refresh = useCallback(async () => {
    setRefreshing(true)
    setRefreshError(null)
    try {
      applyData(await fetchRegister())
    } catch (err) {
      setRefreshError(messageOf(err))
    } finally {
      setRefreshing(false)
    }
  }, [applyData])

  useEffect(() => {
    listModelCategories().then(
      rows => setCategoryRows(rows),
      () => setCategoryRows([]),
    )
  }, [])

  const categories = useMemo(
    () => {
      const names = categoryRows
        .map(categoryName)
        .filter((name): name is string => name !== null)
      return [...new Set(names)].sort()
    },
    [categoryRows],
  )

  const analyticsById = useMemo(
    () => new Map(analytics.map((row): [string, VehicleAnalytics] => [row.vehicle_id, row])),
    [analytics],
  )

  // Filter options come from the fleet itself — offering a category with no
  // trucks behind it is a dead end.
  const fleetCategories = useMemo(() => {
    const names = vehicles
      .map(v => v.model_category)
      .filter((name): name is string => Boolean(name))
    return [...new Set(names)].sort()
  }, [vehicles])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return vehicles.filter(v => {
      if (categoryFilter && v.model_category !== categoryFilter) return false
      if (!q) return true
      return v.rc_number.toLowerCase().includes(q)
        || (v.maker_model ?? '').toLowerCase().includes(q)
    })
  }, [vehicles, query, categoryFilter])

  const coveredCount = useMemo(
    () => vehicles.filter(v => analyticsById.get(v.id)?.score.covered === true).length,
    [vehicles, analyticsById],
  )
  const shortCount = useMemo(
    () => vehicles.filter(v => analyticsById.get(v.id)?.score.covered === false).length,
    [vehicles, analyticsById],
  )
  const avgDistancePct = useMemo(() => {
    const values = vehicles
      .map(v => analyticsById.get(v.id)?.utilization.distance_pct)
      .filter((n): n is number => typeof n === 'number')
    if (values.length === 0) return null
    return values.reduce((sum, n) => sum + n, 0) / values.length
  }, [vehicles, analyticsById])

  const periodLabel = period ? `${shortDate(period.from)} – ${shortDate(period.to)}` : null

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Trucks"
        subtitle="Every asset you own, and whether it clears its own EMI"
        actions={
          <>
            <button type="button" className={secondaryBtn} onClick={() => setBulkOpen(true)}>
              <span className="inline-flex items-center gap-1.5">
                <Upload className="w-4 h-4" />
                Bulk upload
              </span>
            </button>
            <button type="button" className={primaryBtn} onClick={() => setAddOpen(true)}>
              <span className="inline-flex items-center gap-1.5">
                <Plus className="w-4 h-4" />
                Add truck
              </span>
            </button>
          </>
        }
      />

      {loading ? (
        <Loading label="Loading trucks" />
      ) : error ? (
        <ErrorNote message={error} />
      ) : (
        <>
          {vehicles.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
              <Stat label="Trucks" value={vehicles.length} icon={<Truck className="w-4 h-4" />} />
              <Stat
                label="Clearing EMI"
                value={analyticsError ? '—' : coveredCount}
                tone={!analyticsError && coveredCount > 0 ? 'good' : 'neutral'}
                sub={periodLabel ?? undefined}
              />
              <Stat
                label="Short"
                value={analyticsError ? '—' : shortCount}
                tone={!analyticsError && shortCount > 0 ? 'bad' : 'neutral'}
                sub={periodLabel ?? undefined}
              />
              <Stat
                label="Avg distance use"
                value={pct(avgDistancePct)}
                sub={avgDistancePct === null ? 'Not enough data' : 'Against category norm'}
              />
            </div>
          )}

          {refreshError && (
            <div className="mb-4">
              <ErrorNote message={`Could not refresh the register — ${refreshError}. The rows below may be out of date.`} />
            </div>
          )}

          {analyticsError && (
            <div className="mb-4 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
              <span className="inline-flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  Utilisation and EMI coverage could not be loaded ({analyticsError}). The register
                  below is complete; those two columns read as dashes until the report comes back.
                </span>
              </span>
            </div>
          )}

          <Card>
            <CardHead
              title="Fleet register"
              sub={
                vehicles.length === 0
                  ? undefined
                  : `Showing ${filtered.length} of ${vehicles.length}${periodLabel ? ` · utilisation ${periodLabel}` : ''}`
              }
              actions={
                refreshing
                  ? (
                    <span className="inline-flex items-center gap-2 text-xs text-gray-400">
                      <span className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                      Updating
                    </span>
                  )
                  : undefined
              }
            />

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-2 px-4 py-3 border-b border-gray-100">
              <div className="relative flex-1 min-w-0">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search RC number or make / model"
                  aria-label="Search trucks"
                  className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <select
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value)}
                aria-label="Filter by model category"
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent sm:w-64"
              >
                <option value="">All categories</option>
                {fleetCategories.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>

            {vehicles.length === 0 ? (
              <Empty
                title="No trucks yet"
                hint="Add your first truck, or bulk upload the register you already keep."
              />
            ) : filtered.length === 0 ? (
              <Empty
                title="No trucks match"
                hint="Clear the search box or pick a different category."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px]">
                  <thead>
                    <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                      <th className="py-3 px-4 text-left font-medium">RC number</th>
                      <th className="py-3 px-4 text-left font-medium">Make / model</th>
                      <th className="py-3 px-4 text-left font-medium">Category</th>
                      <th className="py-3 px-4 text-left font-medium">Norm</th>
                      <th className="py-3 px-4 text-right font-medium">Age</th>
                      <th className="py-3 px-4 text-right font-medium">Capacity</th>
                      <th className="py-3 px-4 text-right font-medium">Odometer</th>
                      <th className="py-3 px-4 text-left font-medium">Distance use</th>
                      <th className="py-3 px-4 text-left font-medium">EMI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(v => {
                      const row = analyticsById.get(v.id)
                      const age = vehicleAge(v.manufacture_year)
                      return (
                        <tr key={v.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="py-3 px-4 text-sm">
                            <Link
                              href={`/vehicles/${v.id}`}
                              className="font-semibold text-blue-600 hover:text-blue-700 hover:underline"
                            >
                              {v.rc_number}
                            </Link>
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-900">
                            {v.maker_model ?? <span className="text-gray-400">—</span>}
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-600">
                            {v.model_category ?? <span className="text-gray-400">—</span>}
                          </td>
                          <td className="py-3 px-4 text-sm">
                            {v.emission_norm ? (
                              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                                {normLabel(v.emission_norm)}
                              </span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-sm text-right text-gray-900 tabular-nums">
                            {age === null ? <span className="text-gray-400">—</span> : `${age} yr`}
                          </td>
                          <td className="py-3 px-4 text-sm text-right text-gray-900 tabular-nums">
                            {v.capacity_tons === null
                              ? <span className="text-gray-400">—</span>
                              : `${v.capacity_tons.toFixed(1)} t`}
                          </td>
                          <td className="py-3 px-4 text-sm text-right text-gray-900 tabular-nums">
                            {v.current_odometer_km === null
                              ? <span className="text-gray-400">—</span>
                              : km(v.current_odometer_km)}
                          </td>
                          <td className="py-3 px-4 text-sm">
                            {row ? (
                              <div className="w-36">
                                <Meter
                                  pct={row.utilization.distance_pct}
                                  label={km(row.utilization.distance_km)}
                                />
                              </div>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-sm">
                            {row ? (
                              <div className="flex flex-col items-start gap-1">
                                <CoverPill covered={row.score.covered} />
                                <span className={`text-xs tabular-nums ${
                                  row.score.surplus_inr >= 0 ? 'text-emerald-700' : 'text-red-600'
                                }`}>
                                  {inrSigned(row.score.surplus_inr)}
                                </span>
                              </div>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <AddTruckDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        categories={categories}
        onCreated={() => { setAddOpen(false); void refresh() }}
      />

      <BulkUploadDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        onImported={() => { void refresh() }}
      />
    </div>
  )
}

// ── Add truck ─────────────────────────────────────────────────

function AddTruckDialog({
  open, onOpenChange, categories, onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  categories: string[]
  onCreated: () => void
}) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [errorField, setErrorField] = useState<keyof FormState | null>(null)

  function set(key: keyof FormState, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
    if (errorField === key) setErrorField(null)
  }

  function reset() {
    setForm(EMPTY_FORM)
    setFormError(null)
    setErrorField(null)
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setErrorField(null)

    // model_category and manufacture_year are required by the service even though
    // the columns are nullable — without them the asset has no cost model.
    const body: Partial<Vehicle> = { rc_number: form.rc_number.trim() }

    const category = form.model_category.trim()
    if (category) body.model_category = category

    const year = toInt(form.manufacture_year)
    if (year !== null) body.manufacture_year = year

    const norm = oneOf(EMISSION_NORMS, form.emission_norm)
    if (norm !== null) body.emission_norm = norm

    const makerModel = form.maker_model.trim()
    if (makerModel) body.maker_model = makerModel

    const capacity = toNumber(form.capacity_tons)
    if (capacity !== null) body.capacity_tons = capacity

    const volume = toNumber(form.volume_cuft)
    if (volume !== null) body.volume_cuft = volume

    const odometer = toInt(form.current_odometer_km)
    if (odometer !== null) body.current_odometer_km = odometer

    const bodyType = oneOf(BODY_TYPES, form.body_type)
    if (bodyType !== null) body.body_type = bodyType

    const axle = oneOf(AXLE_CONFIGS, form.axle_config)
    if (axle !== null) body.axle_config = axle

    setSubmitting(true)
    try {
      await createVehicle(body)
      reset()
      onCreated()
    } catch (err) {
      const message = messageOf(err)
      setFormError(message)
      setErrorField(fieldForMessage(message))
    } finally {
      setSubmitting(false)
    }
  }

  const cls = (key: keyof FormState) => (errorField === key ? errorInputClass : inputClass)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl bg-white border border-gray-200 max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add truck</DialogTitle>
          <DialogDescription>
            Category and year are what make the per-truck P&amp;L computable, so both are required.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4">
          {formError && <ErrorNote message={formError} />}

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="rc_number" className={labelClass}>RC number *</label>
              <input
                id="rc_number"
                value={form.rc_number}
                onChange={e => set('rc_number', e.target.value.toUpperCase())}
                required
                minLength={4}
                maxLength={20}
                placeholder="MH31CQ4512"
                className={cls('rc_number')}
              />
            </div>
            <div>
              <label htmlFor="maker_model" className={labelClass}>Make / model</label>
              <input
                id="maker_model"
                value={form.maker_model}
                onChange={e => set('maker_model', e.target.value)}
                maxLength={100}
                placeholder="Tata Signa 4825.TK"
                className={cls('maker_model')}
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="model_category" className={labelClass}>Model category *</label>
              {categories.length > 0 ? (
                <select
                  id="model_category"
                  value={form.model_category}
                  onChange={e => set('model_category', e.target.value)}
                  required
                  className={`${cls('model_category')} bg-white`}
                >
                  <option value="">Select a category</option>
                  {categories.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              ) : (
                <>
                  <input
                    id="model_category"
                    value={form.model_category}
                    onChange={e => set('model_category', e.target.value)}
                    required
                    placeholder="HCV Cargo 42-48T"
                    className={cls('model_category')}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    The category list could not be loaded. Type it exactly as it appears in the
                    cost norms — an unknown value is rejected.
                  </p>
                </>
              )}
            </div>
            <div>
              <label htmlFor="emission_norm" className={labelClass}>Emission norm</label>
              <select
                id="emission_norm"
                value={form.emission_norm}
                onChange={e => set('emission_norm', e.target.value)}
                className={`${cls('emission_norm')} bg-white`}
              >
                <option value="">Older than BS4</option>
                {EMISSION_NORMS.map(norm => (
                  <option key={norm} value={norm}>{normLabel(norm)}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="manufacture_year" className={labelClass}>Year *</label>
              <input
                id="manufacture_year"
                type="number"
                inputMode="numeric"
                min={1990}
                max={2100}
                step={1}
                value={form.manufacture_year}
                onChange={e => set('manufacture_year', e.target.value)}
                required
                placeholder="2023"
                className={cls('manufacture_year')}
              />
            </div>
            <div>
              <label htmlFor="capacity_tons" className={labelClass}>Capacity (t)</label>
              <input
                id="capacity_tons"
                type="number"
                inputMode="decimal"
                min={0.1}
                max={100}
                step="any"
                value={form.capacity_tons}
                onChange={e => set('capacity_tons', e.target.value)}
                placeholder="45"
                className={cls('capacity_tons')}
              />
            </div>
            <div>
              <label htmlFor="volume_cuft" className={labelClass}>Volume (cu ft)</label>
              <input
                id="volume_cuft"
                type="number"
                inputMode="decimal"
                min={1}
                max={100000}
                step="any"
                value={form.volume_cuft}
                onChange={e => set('volume_cuft', e.target.value)}
                placeholder="2048"
                className={cls('volume_cuft')}
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="body_type" className={labelClass}>Body type</label>
              <select
                id="body_type"
                value={form.body_type}
                onChange={e => set('body_type', e.target.value)}
                className={`${cls('body_type')} bg-white capitalize`}
              >
                <option value="">Not set</option>
                {BODY_TYPES.map(type => (
                  <option key={type} value={type} className="capitalize">{type}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="axle_config" className={labelClass}>Axle config</label>
              <select
                id="axle_config"
                value={form.axle_config}
                onChange={e => set('axle_config', e.target.value)}
                className={`${cls('axle_config')} bg-white`}
              >
                <option value="">Not set</option>
                {AXLE_CONFIGS.map(config => (
                  <option key={config} value={config}>{config}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="current_odometer_km" className={labelClass}>Odometer (km)</label>
              <input
                id="current_odometer_km"
                type="number"
                inputMode="numeric"
                min={0}
                max={5000000}
                step={1}
                value={form.current_odometer_km}
                onChange={e => set('current_odometer_km', e.target.value)}
                placeholder="214500"
                className={cls('current_odometer_km')}
              />
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
            <button
              type="button"
              className={secondaryBtn}
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className={primaryBtn} disabled={submitting}>
              {submitting ? 'Adding…' : 'Add truck'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Bulk upload ───────────────────────────────────────────────

/** Kept under Fastify's default 1 MiB body limit, with room for JSON escaping. */
const MAX_UPLOAD_BYTES = 900_000

function BulkUploadDialog({
  open, onOpenChange, onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BulkImportResult | null>(null)

  const fileName = file?.name ?? ''

  function reset() {
    setFile(null)
    setError(null)
    setResult(null)
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  /** Extension -> the service's `format` enum. Anything unrecognised is sent as csv so the
   *  server's own validation decides, rather than this component silently guessing. */
  function formatOf(name: string): BulkImportFormat {
    const ext = name.split('.').pop()?.toLowerCase()
    if (ext === 'xlsx' || ext === 'xls') return 'xlsx'
    if (ext === 'pdf') return 'pdf'
    if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') return 'image'
    return 'csv'
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file) return
    setError(null)
    setResult(null)

    // The file rides inside a JSON body and the service runs on Fastify's default
    // 1 MiB limit, so an oversized upload would come back as an opaque 413. Say it
    // here instead. A 500-row register is ~50 KB, so this is not a real ceiling.
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(
        `${fileName} is ${(file.size / 1_000_000).toFixed(1)} MB. The importer takes about 1 MB `
        + 'per upload — export just the truck rows, or split the sheet.',
      )
      return
    }

    setSubmitting(true)
    try {
      // CSV is sent as text because that is what the importer parses. The binary
      // formats are sent too — the service answers 501 for them, and surfacing that
      // real rejection is more honest than blocking the upload client-side and
      // pretending the pipeline exists.
      const content = await file.text()
      const res = await bulkImportVehicles(formatOf(file.name), content)
      setResult(res)
      onImported()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg bg-white border border-gray-200 max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk upload trucks</DialogTitle>
          <DialogDescription>
            Import a register you already keep instead of typing each truck.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5 text-xs text-orange-900">
          <span className="inline-flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <strong className="font-semibold">OCR extraction is not live yet — rows will need
              review.</strong> A CSV is parsed row by row and those trucks really are created.
              Spreadsheets, PDFs and scans need the document/OCR pipeline, which is not wired, so
              they come back rejected rather than half-imported — export the sheet to CSV instead.
              Rows that fail validation are skipped with a reason while the rest still import, so
              read the summary before you trust the register.
            </span>
          </span>
        </div>

        <form onSubmit={submit} className="grid gap-4">
          <div>
            <label htmlFor="bulk_file" className={labelClass}>Document</label>
            <input
              id="bulk_file"
              type="file"
              accept=".xlsx,.csv,.pdf"
              onChange={e => {
                setFile(e.target.files?.[0] ?? null)
                setError(null)
                setResult(null)
              }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
            />
            <p className="mt-1 text-xs text-gray-500">
              .xlsx, .csv or .pdf — up to 500 trucks per upload. The header needs an rc_number (or
              registration_no) column and a model_category column. CSV is the only format parsed
              end-to-end today.
            </p>
            {fileName && formatOf(fileName) !== 'csv' && (
              <p className="mt-1 text-xs text-orange-700">
                {fileName} is not a CSV, so this upload will be rejected by the importer.
              </p>
            )}
          </div>

          {error && <ErrorNote message={error} />}

          {result !== null && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wide">Created</div>
                  <div className="text-lg font-bold tabular-nums text-emerald-700">
                    {result.imported}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wide">Skipped</div>
                  <div className="text-lg font-bold tabular-nums text-orange-600">
                    {result.skipped}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wide">Errors</div>
                  <div className="text-lg font-bold tabular-nums text-red-600">
                    {result.errors.length}
                  </div>
                </div>
              </div>

              {result.errors.length > 0 && (
                <ul className="mt-3 space-y-1 max-h-40 overflow-y-auto border-t border-gray-200 pt-3">
                  {result.errors.map((rowError, index) => (
                    <li key={`${rowError.row}-${index}`} className="text-xs text-red-700">
                      <span className="font-medium">Row {rowError.row}</span>
                      {rowError.rc_number ? ` · ${rowError.rc_number}` : ''} — {rowError.message}
                    </li>
                  ))}
                </ul>
              )}

              {result.imported === 0 && result.errors.length === 0 && (
                <p className="mt-3 text-xs text-gray-500 text-center">
                  Nothing was imported and nothing was reported as failing. Check that the sheet has
                  a header row and at least one truck under it.
                </p>
              )}

              {result.imported > 0 && (
                <p className="mt-3 text-xs text-gray-500 text-center">
                  Imported rows are already in the register behind this dialog. Review them before
                  trusting the economics — an import fills in only what the sheet carried.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
            <button
              type="button"
              className={secondaryBtn}
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              {result === null ? 'Cancel' : 'Done'}
            </button>
            <button type="submit" className={primaryBtn} disabled={submitting || !fileName}>
              {submitting ? 'Importing…' : 'Run import'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
