'use client'

// Truck detail — the per-asset P&L, and the screen the whole console exists for.
//
// Everything on this page comes from two calls: GET /fleet/vehicles/:id (the
// record: finance, permits, corridors) and GET /fleet/analytics/vehicles/:id
// (the money: score, utilization, cost_breakdown_inr). No other fetches.

import { use, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Gauge, Info, Pencil, Plus, Route, ShieldCheck, Trash2, Wallet, X,
} from 'lucide-react'
import {
  ApiError, getOneVehicleAnalytics, getVehicle,
  setVehicleFinance, setVehicleLanes, setVehiclePermits,
} from '@/lib/api'
import type { CostBreakdown, Vehicle, VehicleFinance, VehicleLane, VehiclePermit } from '@/lib/types'
import { inr, km, pct, periodDays, shortDate, tons, vehicleAge, inrSigned } from '@/lib/format'
import { Card, CardHead, CoverPill, Empty, ErrorNote, Loading, Meter, Stat } from '@/components/stat'
import { PageHeader } from '@/components/app-shell'

const PERIODS = [30, 90, 180] as const
type PeriodDays = (typeof PERIODS)[number]

type VehicleDetail = Awaited<ReturnType<typeof getVehicle>>
type VehicleReport = Awaited<ReturnType<typeof getOneVehicleAnalytics>>

const FIELD =
  'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 tabular-nums ' +
  'focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20'
const LABEL = 'text-xs text-gray-400 uppercase tracking-wide'
const BTN_PRIMARY =
  'rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 ' +
  'active:scale-[0.98] transition-transform disabled:opacity-50 disabled:active:scale-100'
const BTN_SECONDARY =
  'rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium px-4 py-2.5'
const BTN_LINK =
  'inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 ' +
  'text-xs font-medium text-gray-700 px-2.5 py-1.5'

// ── Shape adapters ────────────────────────────────────────────
//
// Two places where the client types in src/lib/types.ts and what
// bt-fleet-service actually sends have drifted. Both are read defensively here
// rather than by editing the shared foundation files.

/**
 * GET /fleet/vehicles/:id (bt-fleet-service/src/routes/vehicles.ts) spreads the
 * vehicle row at the TOP level next to finance/permits/lanes, while api.ts types
 * it nested under `vehicle`. Accept either so the page is never blank.
 */
function readVehicle(detail: VehicleDetail): Vehicle | null {
  if (detail.vehicle) return detail.vehicle
  const flat = detail as unknown as Partial<Vehicle>
  return typeof flat.rc_number === 'string' ? (flat as Vehicle) : null
}

/**
 * analytics.ts costBreakdown() emits bare keys — fuel, def, tyres, driver_wage —
 * while the CostBreakdown type declares the *_inr suffixed form. Read both.
 */
function costOf(cb: CostBreakdown, primary: keyof CostBreakdown, wire: string): number {
  const rec = cb as unknown as Record<string, unknown>
  const value = rec[primary] ?? rec[wire]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

type CostLine = {
  label: string
  key: keyof CostBreakdown
  wire: string
  /** Toll and recorded "other" spend sit OUTSIDE modelled running cost. */
  outsideRunning?: boolean
}

const COST_LINES: CostLine[] = [
  { label: 'Fuel',        key: 'fuel_inr',        wire: 'fuel' },
  { label: 'DEF',         key: 'def_inr',         wire: 'def' },
  { label: 'Engine oil',  key: 'engine_oil_inr',  wire: 'engine_oil' },
  { label: 'Gear oil',    key: 'gear_oil_inr',    wire: 'gear_oil' },
  { label: 'Service',     key: 'service_inr',     wire: 'service' },
  { label: 'Tyres',       key: 'tyre_inr',        wire: 'tyres' },
  { label: 'Driver wage', key: 'driver_wage_inr', wire: 'driver_wage' },
  { label: 'Toll',        key: 'toll_inr',        wire: 'toll',  outsideRunning: true },
  { label: 'Other',       key: 'other_inr',       wire: 'other', outsideRunning: true },
]

// ── Small presentational helpers ──────────────────────────────

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className={LABEL}>{label}</div>
      <div className="mt-0.5 text-sm text-gray-900 tabular-nums truncate">{value}</div>
    </div>
  )
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 px-4 py-3 border-t border-gray-100 text-xs text-gray-500">
      <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-gray-400" />
      <p>{children}</p>
    </div>
  )
}

function cuft(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return `${Math.round(n).toLocaleString('en-IN')} cu ft`
}

/** shortDate() drops the year, which an expiry or loan date needs. */
function longDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${shortDate(iso)} ${d.getFullYear()}`
}

/** Days from now — negative once the date is past. */
function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.ceil((t - Date.now()) / 86_400_000)
}

const PERMIT_LABELS: Record<VehiclePermit['permit_type'], string> = {
  national: 'National permit',
  state: 'State permit',
  contract_carriage: 'Contract carriage',
  goods: 'Goods permit',
}

// ── Modal ─────────────────────────────────────────────────────

function Modal({
  title, sub, onClose, children,
}: { title: string; sub?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 bg-black/30 overflow-y-auto">
      <div className="min-h-full flex items-start justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="bg-white rounded-xl border border-gray-200 shadow-lg w-full max-w-2xl my-8"
        >
          <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-100">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
              {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1 -m-1 text-gray-400 hover:text-gray-700 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

// ── Form value coercion ───────────────────────────────────────

function textOrNull(s: string): string | null {
  const t = s.trim()
  return t === '' ? null : t
}

function numOrNull(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function numOrZero(s: string): number {
  return numOrNull(s) ?? 0
}

function str(n: number | null | undefined): string {
  return n === null || n === undefined ? '' : String(n)
}

/** <input type="date"> wants yyyy-mm-dd; the column may come back as a timestamp. */
function dateInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

// ── Finance dialog ────────────────────────────────────────────

type FinanceForm = {
  lender: string
  loan_account_no: string
  principal_inr: string
  emi_amount_inr: string
  emi_day_of_month: string
  tenure_months: string
  interest_rate_pct: string
  start_date: string
  end_date: string
  outstanding_inr: string
  insurance_annual_inr: string
  permit_annual_inr: string
  fitness_annual_inr: string
}

function financeForm(f: VehicleFinance | null): FinanceForm {
  return {
    lender: f?.lender ?? '',
    loan_account_no: f?.loan_account_no ?? '',
    principal_inr: str(f?.principal_inr),
    emi_amount_inr: str(f?.emi_amount_inr ?? 0),
    emi_day_of_month: str(f?.emi_day_of_month),
    tenure_months: str(f?.tenure_months),
    interest_rate_pct: str(f?.interest_rate_pct),
    start_date: dateInput(f?.start_date),
    end_date: dateInput(f?.end_date),
    outstanding_inr: str(f?.outstanding_inr),
    insurance_annual_inr: str(f?.insurance_annual_inr ?? 0),
    permit_annual_inr: str(f?.permit_annual_inr ?? 0),
    fitness_annual_inr: str(f?.fitness_annual_inr ?? 0),
  }
}

/** Mirrors FinanceBody in bt-fleet-service/src/routes/vehicles.ts. */
function validateFinance(f: FinanceForm): string | null {
  const emi = numOrNull(f.emi_amount_inr)
  if (emi === null) return 'EMI is required — enter 0 for a truck with no loan'
  if (emi < 0 || emi > 10_000_000) return 'EMI must be between ₹0 and ₹1,00,00,000'

  const principal = numOrNull(f.principal_inr)
  if (principal !== null && (principal <= 0 || principal > 100_000_000)) {
    return 'Principal must be greater than 0 (leave blank if unknown)'
  }
  const day = numOrNull(f.emi_day_of_month)
  if (day !== null && (!Number.isInteger(day) || day < 1 || day > 31)) {
    return 'EMI day must be a whole number between 1 and 31'
  }
  const tenure = numOrNull(f.tenure_months)
  if (tenure !== null && (!Number.isInteger(tenure) || tenure <= 0 || tenure > 600)) {
    return 'Tenure must be a whole number of months between 1 and 600'
  }
  const rate = numOrNull(f.interest_rate_pct)
  if (rate !== null && (rate < 0 || rate > 100)) return 'Interest rate must be between 0 and 100'

  const outstanding = numOrNull(f.outstanding_inr)
  if (outstanding !== null && (outstanding < 0 || outstanding > 100_000_000)) {
    return 'Outstanding cannot be negative'
  }
  for (const [label, value] of [
    ['Insurance', numOrZero(f.insurance_annual_inr)],
    ['Permit', numOrZero(f.permit_annual_inr)],
    ['Fitness', numOrZero(f.fitness_annual_inr)],
  ] as const) {
    if (value < 0 || value > 10_000_000) return `${label} annual cost is out of range`
  }
  return null
}

function FinanceDialog({
  vehicleId, finance, onClose, onSaved,
}: {
  vehicleId: string
  finance: VehicleFinance | null
  onClose: () => void
  onSaved: (saved: VehicleFinance) => void
}) {
  const [form, setForm] = useState<FinanceForm>(() => financeForm(finance))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set(key: keyof FinanceForm, value: string) {
    setForm(prev => {
      const next: FinanceForm = { ...prev }
      next[key] = value
      return next
    })
  }

  async function submit() {
    const invalid = validateFinance(form)
    if (invalid) { setError(invalid); return }
    setSaving(true)
    setError(null)
    try {
      const saved = await setVehicleFinance(vehicleId, {
        lender: textOrNull(form.lender),
        loan_account_no: textOrNull(form.loan_account_no),
        principal_inr: numOrNull(form.principal_inr),
        emi_amount_inr: numOrZero(form.emi_amount_inr),
        emi_day_of_month: numOrNull(form.emi_day_of_month),
        tenure_months: numOrNull(form.tenure_months),
        interest_rate_pct: numOrNull(form.interest_rate_pct),
        start_date: textOrNull(form.start_date),
        end_date: textOrNull(form.end_date),
        outstanding_inr: numOrNull(form.outstanding_inr),
        insurance_annual_inr: numOrZero(form.insurance_annual_inr),
        permit_annual_inr: numOrZero(form.permit_annual_inr),
        fitness_annual_inr: numOrZero(form.fitness_annual_inr),
      })
      onSaved(saved)
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'Could not save finance')
      setSaving(false)
    }
  }

  const text = (label: string, key: keyof FinanceForm, placeholder?: string) => (
    <div>
      <label className={LABEL} htmlFor={`fin-${key}`}>{label}</label>
      <input
        id={`fin-${key}`}
        className={`${FIELD} mt-1`}
        value={form[key]}
        placeholder={placeholder}
        onChange={e => set(key, e.target.value)}
      />
    </div>
  )
  const num = (label: string, key: keyof FinanceForm, step = '1') => (
    <div>
      <label className={LABEL} htmlFor={`fin-${key}`}>{label}</label>
      <input
        id={`fin-${key}`}
        type="number"
        step={step}
        className={`${FIELD} mt-1`}
        value={form[key]}
        onChange={e => set(key, e.target.value)}
      />
    </div>
  )
  const date = (label: string, key: keyof FinanceForm) => (
    <div>
      <label className={LABEL} htmlFor={`fin-${key}`}>{label}</label>
      <input
        id={`fin-${key}`}
        type="date"
        className={`${FIELD} mt-1`}
        value={form[key]}
        onChange={e => set(key, e.target.value)}
      />
    </div>
  )

  return (
    <Modal
      title="Edit finance"
      sub="EMI and the annual carrying costs feed the verdict at the top of this page."
      onClose={onClose}
    >
      <div className="p-4 space-y-4">
        {error && <ErrorNote message={error} />}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {text('Lender', 'lender', 'e.g. Shriram Finance')}
          {text('Loan account no', 'loan_account_no')}
          {num('EMI (₹ / month)', 'emi_amount_inr')}
          {num('EMI day of month', 'emi_day_of_month')}
          {num('Principal (₹)', 'principal_inr')}
          {num('Outstanding (₹)', 'outstanding_inr')}
          {num('Interest rate (%)', 'interest_rate_pct', '0.01')}
          {num('Tenure (months)', 'tenure_months')}
          {date('Start date', 'start_date')}
          {date('End date', 'end_date')}
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-700">Annual carrying costs</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Spread over twelve months and charged to this truck alongside the EMI.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
            {num('Insurance (₹ / yr)', 'insurance_annual_inr')}
            {num('Permit (₹ / yr)', 'permit_annual_inr')}
            {num('Fitness (₹ / yr)', 'fitness_annual_inr')}
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-100">
        <button type="button" className={BTN_SECONDARY} onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className={BTN_PRIMARY} onClick={submit} disabled={saving}>
          {saving ? 'Saving…' : 'Save finance'}
        </button>
      </div>
    </Modal>
  )
}

// ── Permits dialog ────────────────────────────────────────────

type PermitForm = {
  permit_type: VehiclePermit['permit_type']
  allowed_states: string
  permit_number: string
  issued_on: string
  expiry_date: string
  is_active: boolean
}

function permitForms(permits: VehiclePermit[]): PermitForm[] {
  return permits.map(p => ({
    permit_type: p.permit_type,
    allowed_states: (p.allowed_states ?? []).join(', '),
    permit_number: p.permit_number ?? '',
    issued_on: dateInput(p.issued_on),
    expiry_date: dateInput(p.expiry_date),
    is_active: p.is_active,
  }))
}

function parseStates(raw: string): string[] {
  return raw.split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean)
}

function PermitsDialog({
  vehicleId, permits, onClose, onSaved,
}: {
  vehicleId: string
  permits: VehiclePermit[]
  onClose: () => void
  onSaved: (saved: VehiclePermit[]) => void
}) {
  const [rows, setRows] = useState<PermitForm[]>(() => permitForms(permits))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function patch(index: number, next: Partial<PermitForm>) {
    setRows(prev => prev.map((row, i) => (i === index ? { ...row, ...next } : row)))
  }

  async function submit() {
    for (const row of rows) {
      const states = parseStates(row.allowed_states)
      if (states.some(s => s.length > 5)) {
        setError('State codes are at most 5 characters — use codes like MH, KA, TN')
        return
      }
      if (states.length > 40) { setError('At most 40 states per permit'); return }
      if (row.permit_type === 'state' && states.length === 0) {
        setError('A state permit needs at least one state code')
        return
      }
    }
    setSaving(true)
    setError(null)
    try {
      const saved = await setVehiclePermits(vehicleId, rows.map(row => ({
        permit_type: row.permit_type,
        allowed_states: parseStates(row.allowed_states),
        permit_number: textOrNull(row.permit_number),
        issued_on: textOrNull(row.issued_on),
        expiry_date: textOrNull(row.expiry_date),
        is_active: row.is_active,
      })))
      onSaved(saved)
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'Could not save permits')
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Edit permits"
      sub="Saving replaces the whole permit set for this truck."
      onClose={onClose}
    >
      <div className="p-4 space-y-3">
        {error && <ErrorNote message={error} />}

        {rows.length === 0 && (
          <Empty title="No permits on this truck" hint="Add one to record where it is allowed to run." />
        )}

        {rows.map((row, i) => (
          <div key={i} className="rounded-xl border border-gray-200 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-semibold text-gray-700">Permit {i + 1}</span>
              <button
                type="button"
                aria-label={`Remove permit ${i + 1}`}
                className="p-1 text-gray-400 hover:text-red-600"
                onClick={() => setRows(prev => prev.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={LABEL} htmlFor={`permit-type-${i}`}>Type</label>
                <select
                  id={`permit-type-${i}`}
                  className={`${FIELD} mt-1`}
                  value={row.permit_type}
                  onChange={e => patch(i, { permit_type: e.target.value as VehiclePermit['permit_type'] })}
                >
                  {(Object.keys(PERMIT_LABELS) as VehiclePermit['permit_type'][]).map(t => (
                    <option key={t} value={t}>{PERMIT_LABELS[t]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL} htmlFor={`permit-no-${i}`}>Permit number</label>
                <input
                  id={`permit-no-${i}`}
                  className={`${FIELD} mt-1`}
                  value={row.permit_number}
                  onChange={e => patch(i, { permit_number: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={LABEL} htmlFor={`permit-states-${i}`}>Allowed states</label>
                <input
                  id={`permit-states-${i}`}
                  className={`${FIELD} mt-1`}
                  placeholder="MH, KA, TN — leave blank for a national permit"
                  value={row.allowed_states}
                  onChange={e => patch(i, { allowed_states: e.target.value })}
                />
              </div>
              <div>
                <label className={LABEL} htmlFor={`permit-issued-${i}`}>Issued on</label>
                <input
                  id={`permit-issued-${i}`}
                  type="date"
                  className={`${FIELD} mt-1`}
                  value={row.issued_on}
                  onChange={e => patch(i, { issued_on: e.target.value })}
                />
              </div>
              <div>
                <label className={LABEL} htmlFor={`permit-expiry-${i}`}>Expiry</label>
                <input
                  id={`permit-expiry-${i}`}
                  type="date"
                  className={`${FIELD} mt-1`}
                  value={row.expiry_date}
                  onChange={e => patch(i, { expiry_date: e.target.value })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-2">
                <input
                  type="checkbox"
                  className="rounded border-gray-300"
                  checked={row.is_active}
                  onChange={e => patch(i, { is_active: e.target.checked })}
                />
                Active
              </label>
            </div>
          </div>
        ))}

        {rows.length < 20 && (
          <button
            type="button"
            className={BTN_SECONDARY}
            onClick={() => setRows(prev => [...prev, {
              permit_type: 'national', allowed_states: '', permit_number: '',
              issued_on: '', expiry_date: '', is_active: true,
            }])}
          >
            <span className="inline-flex items-center gap-1.5"><Plus className="w-4 h-4" /> Add permit</span>
          </button>
        )}
      </div>

      <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-100">
        <button type="button" className={BTN_SECONDARY} onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className={BTN_PRIMARY} onClick={submit} disabled={saving}>
          {saving ? 'Saving…' : 'Save permits'}
        </button>
      </div>
    </Modal>
  )
}

// ── Corridors dialog ──────────────────────────────────────────

type LaneForm = {
  origin_city: string
  destination_city: string
  typical_distance_km: string
  is_primary: boolean
  // Carried through untouched — PUT replaces the row set, so dropping the
  // coordinates here would quietly erase them.
  origin_lat: number | null
  origin_lng: number | null
  dest_lat: number | null
  dest_lng: number | null
}

function laneForms(lanes: VehicleLane[]): LaneForm[] {
  return lanes.map(l => ({
    origin_city: l.origin_city,
    destination_city: l.destination_city,
    typical_distance_km: str(l.typical_distance_km),
    is_primary: l.is_primary,
    origin_lat: l.origin_lat,
    origin_lng: l.origin_lng,
    dest_lat: l.dest_lat,
    dest_lng: l.dest_lng,
  }))
}

function LanesDialog({
  vehicleId, lanes, onClose, onSaved,
}: {
  vehicleId: string
  lanes: VehicleLane[]
  onClose: () => void
  onSaved: (saved: VehicleLane[]) => void
}) {
  const [rows, setRows] = useState<LaneForm[]>(() => laneForms(lanes))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function patch(index: number, next: Partial<LaneForm>) {
    setRows(prev => prev.map((row, i) => (i === index ? { ...row, ...next } : row)))
  }

  // vehicle_lanes_one_primary is a DB constraint — only one row may be primary,
  // so selecting one clears the rest instead of erroring on save.
  function makePrimary(index: number) {
    setRows(prev => prev.map((row, i) => ({ ...row, is_primary: i === index })))
  }

  async function submit() {
    for (const row of rows) {
      if (!row.origin_city.trim() || !row.destination_city.trim()) {
        setError('Every corridor needs both an origin and a destination')
        return
      }
      const distance = numOrNull(row.typical_distance_km)
      if (distance !== null && (distance <= 0 || distance > 10_000)) {
        setError('Typical distance must be between 1 and 10,000 km')
        return
      }
    }
    setSaving(true)
    setError(null)
    try {
      const saved = await setVehicleLanes(vehicleId, rows.map(row => ({
        origin_city: row.origin_city.trim(),
        destination_city: row.destination_city.trim(),
        typical_distance_km: numOrNull(row.typical_distance_km),
        is_primary: row.is_primary,
        origin_lat: row.origin_lat,
        origin_lng: row.origin_lng,
        dest_lat: row.dest_lat,
        dest_lng: row.dest_lng,
      })))
      onSaved(saved)
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'Could not save corridors')
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Edit corridors"
      sub="Saving replaces the whole corridor set, including the observed trip counts."
      onClose={onClose}
    >
      <div className="p-4 space-y-3">
        {error && <ErrorNote message={error} />}

        {rows.length === 0 && (
          <Empty title="No corridors yet" hint="Add the lanes this truck actually runs." />
        )}

        {rows.map((row, i) => (
          <div key={i} className="rounded-xl border border-gray-200 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
                <input
                  type="radio"
                  name="primary-lane"
                  checked={row.is_primary}
                  onChange={() => makePrimary(i)}
                />
                Primary corridor
              </label>
              <button
                type="button"
                aria-label={`Remove corridor ${i + 1}`}
                className="p-1 text-gray-400 hover:text-red-600"
                onClick={() => setRows(prev => prev.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={LABEL} htmlFor={`lane-origin-${i}`}>Origin</label>
                <input
                  id={`lane-origin-${i}`}
                  className={`${FIELD} mt-1`}
                  value={row.origin_city}
                  onChange={e => patch(i, { origin_city: e.target.value })}
                />
              </div>
              <div>
                <label className={LABEL} htmlFor={`lane-dest-${i}`}>Destination</label>
                <input
                  id={`lane-dest-${i}`}
                  className={`${FIELD} mt-1`}
                  value={row.destination_city}
                  onChange={e => patch(i, { destination_city: e.target.value })}
                />
              </div>
              <div>
                <label className={LABEL} htmlFor={`lane-km-${i}`}>Typical distance (km)</label>
                <input
                  id={`lane-km-${i}`}
                  type="number"
                  className={`${FIELD} mt-1`}
                  value={row.typical_distance_km}
                  onChange={e => patch(i, { typical_distance_km: e.target.value })}
                />
              </div>
            </div>
          </div>
        ))}

        {rows.length < 20 && (
          <button
            type="button"
            className={BTN_SECONDARY}
            onClick={() => setRows(prev => [...prev, {
              origin_city: '', destination_city: '', typical_distance_km: '',
              is_primary: prev.length === 0,
              origin_lat: null, origin_lng: null, dest_lat: null, dest_lng: null,
            }])}
          >
            <span className="inline-flex items-center gap-1.5"><Plus className="w-4 h-4" /> Add corridor</span>
          </button>
        )}
      </div>

      <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-100">
        <button type="button" className={BTN_SECONDARY} onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className={BTN_PRIMARY} onClick={submit} disabled={saving}>
          {saving ? 'Saving…' : 'Save corridors'}
        </button>
      </div>
    </Modal>
  )
}

// ── Page ──────────────────────────────────────────────────────

export default function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [days, setDays] = useState<PeriodDays>(30)
  const [detail, setDetail] = useState<VehicleDetail | null>(null)
  const [report, setReport] = useState<VehicleReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [editing, setEditing] = useState<'finance' | 'permits' | 'lanes' | null>(null)

  // The effect only kicks the requests off; every setState happens in a callback.
  // Flipping `loading`/`error` synchronously here would trip
  // react-hooks/set-state-in-effect, so whoever changes the inputs owns that
  // transition — same convention as the dashboard.
  useEffect(() => {
    let cancelled = false
    Promise.all([getVehicle(id), getOneVehicleAnalytics(id, periodDays(days))])
      .then(([nextDetail, nextReport]) => {
        if (cancelled) return
        setDetail(nextDetail)
        setReport(nextReport)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : 'Could not load this truck')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id, days, reloadKey])

  const vehicle = detail ? readVehicle(detail) : null

  function reload() {
    setLoading(true)
    setError(null)
    setReloadKey(k => k + 1)
  }

  const periodSwitcher = (
    <div
      className="inline-flex rounded-xl border border-gray-200 bg-white p-0.5 shadow-sm"
      role="group"
      aria-label="Reporting period"
    >
      {PERIODS.map(d => (
        <button
          key={d}
          type="button"
          onClick={() => {
            if (d === days) return
            setLoading(true)
            setError(null)
            setDays(d)
          }}
          aria-pressed={days === d}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            days === d ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          {d}d
        </button>
      ))}
    </div>
  )

  const age = vehicle ? vehicleAge(vehicle.manufacture_year) : null
  const subtitle = vehicle
    ? [
        vehicle.maker_model,
        vehicle.model_category,
        vehicle.emission_norm?.replace('_', ' '),
        age === null ? null : age === 0 ? 'new this year' : `${age} yr old`,
      ].filter((part): part is string => Boolean(part)).join(' · ')
    : undefined

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      <Link
        href="/vehicles"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-3"
      >
        <ArrowLeft className="w-4 h-4" /> All trucks
      </Link>

      <PageHeader
        title={vehicle?.rc_number ?? 'Truck'}
        subtitle={subtitle}
        actions={periodSwitcher}
      />

      {loading && !detail && <Loading label="Loading truck" />}
      {error && !detail && <ErrorNote message={error} />}
      {!loading && !error && detail && !vehicle && (
        <Card><Empty title="Truck not found" hint="It may have been removed, or it belongs to another fleet." /></Card>
      )}

      {detail && vehicle && (
        // Stale-while-revalidate: a period switch dims the last answer rather
        // than blanking the page.
        <div className={`space-y-4 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          {error && <ErrorNote message={error} />}

          <VerdictCard report={report} days={days} loading={loading} />
          <UtilisationCard report={report} />
          <CostCard report={report} age={age} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <FinanceCard
              finance={detail.finance}
              onEdit={() => setEditing('finance')}
            />
            <PermitsCard
              permits={detail.permits ?? []}
              onEdit={() => setEditing('permits')}
            />
          </div>

          <CorridorsCard lanes={detail.lanes ?? []} onEdit={() => setEditing('lanes')} />
        </div>
      )}

      {editing === 'finance' && vehicle && (
        <FinanceDialog
          vehicleId={vehicle.id}
          finance={detail?.finance ?? null}
          onClose={() => setEditing(null)}
          onSaved={saved => {
            setDetail(prev => (prev ? { ...prev, finance: saved } : prev))
            setEditing(null)
            // EMI and the annual carrying costs change the verdict, so the score
            // has to be recomputed server-side.
            reload()
          }}
        />
      )}
      {editing === 'permits' && vehicle && (
        <PermitsDialog
          vehicleId={vehicle.id}
          permits={detail?.permits ?? []}
          onClose={() => setEditing(null)}
          onSaved={saved => {
            setDetail(prev => (prev ? { ...prev, permits: saved } : prev))
            setEditing(null)
          }}
        />
      )}
      {editing === 'lanes' && vehicle && (
        <LanesDialog
          vehicleId={vehicle.id}
          lanes={detail?.lanes ?? []}
          onClose={() => setEditing(null)}
          onSaved={saved => {
            setDetail(prev => (prev ? { ...prev, lanes: saved } : prev))
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

// ── 2. The verdict ────────────────────────────────────────────

function VerdictCard({
  report, days, loading,
}: { report: VehicleReport | null; days: PeriodDays; loading: boolean }) {
  if (!report) {
    return <Card>{loading ? <Loading label="Scoring this asset" /> : <Empty title="No P&L for this period" />}</Card>
  }

  const s = report.score
  const covered = s.covered
  const surplus = s.surplus_inr
  const otherFixed = s.fixed_cost_inr - s.emi_inr

  const verdict =
    report.trips === 0
      ? s.fixed_cost_inr > 0
        ? `No completed trips in this window, so ${inr(s.fixed_cost_inr)} of fixed cost was carried with nothing against it.`
        : 'No completed trips in this window, and no fixed cost is recorded against this truck.'
      : covered
        ? `This truck cleared its EMI by ${inr(Math.abs(surplus))} this period.`
        : `This truck fell ${inr(Math.abs(surplus))} short of its EMI this period.`

  // Stacked bar: the cost stack measured against revenue. The marker is where
  // revenue lands, so "does the bar clear the line" is the whole question.
  const stack = s.running_cost_inr + s.fixed_cost_inr
  const scale = Math.max(s.revenue_inr, stack, 1)
  const runW = Math.max(0, (s.running_cost_inr / scale) * 100)
  const fixedW = Math.max(0, (s.fixed_cost_inr / scale) * 100)
  const revMark = Math.min(100, Math.max(0, (s.revenue_inr / scale) * 100))

  return (
    <Card>
      <div className={`px-4 py-4 rounded-t-xl border-b ${
        covered ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'
      }`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={LABEL}>{covered ? 'Surplus' : 'Shortfall'} · last {days} days</span>
              <CoverPill covered={covered} />
            </div>
            <div className={`mt-1 text-4xl font-bold tabular-nums ${
              covered ? 'text-emerald-700' : 'text-red-600'
            }`}>
              {inrSigned(surplus)}
            </div>
            <p className="mt-1.5 text-sm text-gray-700">{verdict}</p>
          </div>
          <div className="text-right shrink-0">
            <div className={LABEL}>Trips</div>
            <div className="text-2xl font-bold text-gray-900 tabular-nums">{report.trips}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {shortDate(report.period.from)} – {shortDate(report.period.to)}
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 pt-4">
        <div className="relative h-3 rounded-full bg-gray-100 overflow-hidden flex">
          <div className="h-full bg-gray-400" style={{ width: `${runW}%` }} />
          <div className="h-full bg-orange-400" style={{ width: `${fixedW}%` }} />
          {/* Where revenue lands. Does the cost stack clear the line? */}
          <div className="absolute inset-y-0 w-0.5 bg-blue-600" style={{ left: `calc(${revMark}% - 1px)` }} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-gray-400" /> Running cost
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-orange-400" /> Fixed cost (EMI + carrying + overhead)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-0.5 h-3 bg-blue-600" /> Revenue
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 p-4">
        <Field label="Revenue" value={inr(s.revenue_inr)} />
        <Field label="Running cost" value={inr(s.running_cost_inr)} />
        <Field
          label="Gross margin"
          value={<span className={s.gross_margin_inr >= 0 ? 'text-emerald-700' : 'text-red-600'}>
            {inrSigned(s.gross_margin_inr)}
          </span>}
        />
        <Field label="EMI" value={inr(s.emi_inr)} />
        <Field label="Fixed cost" value={inr(s.fixed_cost_inr)} />
        <Field
          label="Surplus"
          value={<span className={covered ? 'text-emerald-700' : 'text-red-600'}>{inrSigned(surplus)}</span>}
        />
      </div>

      <Note>
        Surplus is revenue less running cost, EMI, the annual carrying costs spread over twelve
        months, and this truck&apos;s share of fleet overhead — {inr(otherFixed)} of the{' '}
        {inr(s.fixed_cost_inr)} fixed charge is everything other than the EMI. Fixed charges are
        applied once and pro-rated to the window, never allocated per trip.
      </Note>
    </Card>
  )
}

// ── 3. Utilisation ────────────────────────────────────────────

function UtilisationCard({ report }: { report: VehicleReport | null }) {
  if (!report) return null
  const u = report.utilization

  return (
    <Card>
      <CardHead
        title="Utilisation"
        sub="How full it ran, and how hard it was worked"
        actions={<Gauge className="w-4 h-4 text-gray-300" />}
      />
      {report.trips === 0 ? (
        <Empty title="No completed trips in this window" hint="Widen the period, or check that trips have been marked paid." />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4">
            <div className="rounded-xl border border-gray-100 p-3">
              <Meter pct={u.tonnage_pct} label="Tonnage" />
              <p className="mt-2 text-xs text-gray-500 tabular-nums">
                {tons(u.laden_weight_kg)} laden of {tons(u.capacity_kg)} capacity
              </p>
            </div>
            <div className="rounded-xl border border-gray-100 p-3">
              <Meter pct={u.volume_pct} label="Volume" />
              <p className="mt-2 text-xs text-gray-500 tabular-nums">
                {cuft(u.volume_used_cuft)} used of {cuft(u.capacity_cuft)}
              </p>
            </div>
            <div className="rounded-xl border border-gray-100 p-3">
              <Meter pct={u.distance_pct} label="Distance" />
              <p className="mt-2 text-xs text-gray-500 tabular-nums">
                {km(u.distance_km)} run of {km(u.expected_distance_km)} expected
              </p>
            </div>
          </div>
          <Note>
            The three are deliberately separate: a truck can run every expected kilometre while
            half empty. Expected distance comes from the annual-km norm for its model category,
            pro-rated to this window — a truck with no norm shows no distance figure.
          </Note>
        </>
      )}
    </Card>
  )
}

// ── 4. Cost breakdown ─────────────────────────────────────────

function CostCard({ report, age }: { report: VehicleReport | null; age: number | null }) {
  const lines = useMemo(() => {
    if (!report) return []
    return COST_LINES.map(line => ({
      ...line,
      value: costOf(report.cost_breakdown_inr, line.key, line.wire),
    }))
  }, [report])

  if (!report) return null

  const total = lines.reduce((sum, line) => sum + line.value, 0)
  const peak = lines.reduce((max, line) => Math.max(max, line.value), 0)

  return (
    <Card>
      <CardHead title="Cost breakdown" sub="Where the money went this period" />

      {report.trips === 0 || total === 0 ? (
        <Empty title="No costs recorded in this window" hint="Costs are written once a trip is paid." />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 border-b border-gray-100">
            <Stat
              label="Cost per km"
              value={inr(report.cost_per_km_inr)}
              sub="Modelled running cost ÷ distance"
              tone="neutral"
            />
            <Stat
              label="Revenue per km"
              value={inr(report.revenue_per_km_inr)}
              sub="Freight earned ÷ distance"
              tone="neutral"
            />
            <Stat
              label="Net profit"
              value={inr(report.net_profit_inr)}
              sub="Before EMI and fixed cost"
              tone={report.net_profit_inr >= 0 ? 'good' : 'bad'}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[38rem]">
              <thead>
                <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                  <th className="py-3 px-4 text-left font-normal">Line item</th>
                  <th className="py-3 px-4 text-right font-normal">Amount</th>
                  <th className="py-3 px-4 text-right font-normal">Share</th>
                  <th className="py-3 px-4 text-left font-normal w-2/5">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(line => {
                  const share = total > 0 ? (line.value / total) * 100 : null
                  const width = peak > 0 ? (line.value / peak) * 100 : 0
                  return (
                    <tr key={line.key} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="py-3 px-4 text-sm text-gray-900">
                        {line.label}
                        {line.outsideRunning && <span className="text-gray-400"> †</span>}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-900 text-right tabular-nums">{inr(line.value)}</td>
                      <td className="py-3 px-4 text-sm text-gray-500 text-right tabular-nums">{pct(share, 1)}</td>
                      <td className="py-3 px-4">
                        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${line.outsideRunning ? 'bg-gray-300' : 'bg-blue-500'}`}
                            style={{ width: `${width}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
                <tr className="border-b border-gray-50 bg-gray-50/60">
                  <td className="py-3 px-4 text-sm font-semibold text-gray-900">Total recorded</td>
                  <td className="py-3 px-4 text-sm font-semibold text-gray-900 text-right tabular-nums">{inr(total)}</td>
                  <td className="py-3 px-4 text-sm text-gray-500 text-right tabular-nums">100.0%</td>
                  <td className="py-3 px-4" />
                </tr>
                <tr>
                  <td className="py-3 px-4 text-sm text-gray-500">Of which modelled running cost</td>
                  <td className="py-3 px-4 text-sm text-gray-500 text-right tabular-nums">
                    {inr(report.score.running_cost_inr)}
                  </td>
                  <td className="py-3 px-4" />
                  <td className="py-3 px-4" />
                </tr>
              </tbody>
            </table>
          </div>

          <Note>
            Service cost is age-indexed and non-linear — it climbs to a peak around year three and
            tapers after, which is why an older truck can show a lower service line than a mid-life
            one{age === null ? '' : `; this one is ${age === 0 ? 'in its first year' : `${age} years old`}`}.
            Fuel, DEF and the oils are modelled from the category&apos;s norms and the emission
            norm, not from receipts.
          </Note>
          <div className="px-4 pb-3 -mt-2 text-xs text-gray-400">
            † Toll and other recorded spend are shown here but sit outside modelled running cost,
            so the total above is larger than the running cost used in the verdict.
          </div>
        </>
      )}
    </Card>
  )
}

// ── 5. Finance ────────────────────────────────────────────────

function FinanceCard({ finance, onEdit }: { finance: VehicleFinance | null; onEdit: () => void }) {
  return (
    <Card className="flex flex-col">
      <CardHead
        title="Finance"
        sub="The loan and the fixed carrying costs"
        actions={
          <button type="button" className={BTN_LINK} onClick={onEdit}>
            <Pencil className="w-3.5 h-3.5" /> {finance ? 'Edit finance' : 'Add finance'}
          </button>
        }
      />
      {!finance ? (
        <Empty
          title="No finance recorded"
          hint="Without an EMI and the annual costs, the verdict above only counts running cost."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-4">
            <Field label="Lender" value={finance.lender ?? '—'} />
            <Field label="Loan account" value={finance.loan_account_no ?? '—'} />
            <Field
              label="EMI"
              value={
                <span className="inline-flex items-baseline gap-1">
                  <Wallet className="w-3.5 h-3.5 text-gray-300 self-center" />
                  {inr(finance.emi_amount_inr)}
                </span>
              }
            />
            <Field label="Outstanding" value={inr(finance.outstanding_inr)} />
            <Field
              label="Interest"
              value={finance.interest_rate_pct === null ? '—' : pct(finance.interest_rate_pct, 2)}
            />
            <Field
              label="EMI day"
              value={finance.emi_day_of_month === null ? '—' : `${finance.emi_day_of_month} of month`}
            />
            <Field label="Start" value={longDate(finance.start_date)} />
            <Field label="End" value={longDate(finance.end_date)} />
            <Field
              label="Tenure"
              value={finance.tenure_months === null ? '—' : `${finance.tenure_months} months`}
            />
          </div>

          <div className="px-4 pb-4">
            <p className="text-xs font-semibold text-gray-700 mb-2">Annual carrying costs</p>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Insurance" value={inr(finance.insurance_annual_inr)} />
              <Field label="Permit" value={inr(finance.permit_annual_inr)} />
              <Field label="Fitness" value={inr(finance.fitness_annual_inr)} />
            </div>
          </div>

          <div className="mt-auto">
            <Note>
              These three are divided by twelve and charged to the truck each month alongside the
              EMI. Saving the form replaces the whole finance record for this truck.
            </Note>
          </div>
        </>
      )}
    </Card>
  )
}

// ── 6. Permits ────────────────────────────────────────────────

function PermitsCard({ permits, onEdit }: { permits: VehiclePermit[]; onEdit: () => void }) {
  return (
    <Card className="flex flex-col">
      <CardHead
        title="Permits"
        sub="Where this truck is allowed to run"
        actions={
          <button type="button" className={BTN_LINK} onClick={onEdit}>
            <Pencil className="w-3.5 h-3.5" /> Edit permits
          </button>
        }
      />
      {permits.length === 0 ? (
        <Empty title="No permits recorded" hint="Add the national or state permits this truck holds." />
      ) : (
        <div className="p-4 space-y-3">
          {permits.map(permit => {
            const left = daysUntil(permit.expiry_date)
            const tone =
              left === null ? 'text-gray-400'
              : left < 0 ? 'text-red-600'
              : left <= 60 ? 'text-orange-600'
              : 'text-gray-900'
            const note =
              left === null ? 'No expiry on record'
              : left < 0 ? `Expired ${Math.abs(left)} d ago`
              : left <= 60 ? `Expires in ${left} d`
              : 'Valid'

            return (
              <div key={permit.id} className="rounded-xl border border-gray-100 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-900 inline-flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-gray-300" />
                        {PERMIT_LABELS[permit.permit_type]}
                      </span>
                      {!permit.is_active && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Inactive</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 tabular-nums">
                      {permit.permit_number ?? 'No permit number'}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-sm tabular-nums ${tone}`}>{longDate(permit.expiry_date)}</div>
                    <div className={`text-xs ${tone === 'text-gray-900' ? 'text-gray-400' : tone}`}>{note}</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 mt-2">
                  {permit.allowed_states.length === 0 ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                      {permit.permit_type === 'national' ? 'All India' : 'No states listed'}
                    </span>
                  ) : (
                    permit.allowed_states.map(state => (
                      <span key={state} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                        {state}
                      </span>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ── 7. Corridors ──────────────────────────────────────────────

function CorridorsCard({ lanes, onEdit }: { lanes: VehicleLane[]; onEdit: () => void }) {
  return (
    <Card>
      <CardHead
        title="Corridors"
        sub="The lanes this truck actually runs"
        actions={
          <button type="button" className={BTN_LINK} onClick={onEdit}>
            <Pencil className="w-3.5 h-3.5" /> Edit corridors
          </button>
        }
      />
      {lanes.length === 0 ? (
        <Empty title="No corridors recorded" hint="Add the routes this truck runs so its work can be matched to loads." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem]">
            <thead>
              <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <th className="py-3 px-4 text-left font-normal">Corridor</th>
                <th className="py-3 px-4 text-right font-normal">Typical distance</th>
                <th className="py-3 px-4 text-right font-normal">Trips observed</th>
              </tr>
            </thead>
            <tbody>
              {lanes.map(lane => (
                <tr key={lane.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-4 text-sm text-gray-900">
                    <span className="inline-flex items-center gap-2 flex-wrap">
                      <Route className="w-3.5 h-3.5 text-gray-300" />
                      <span className="font-medium">{lane.origin_city}</span>
                      <span className="text-gray-400">→</span>
                      <span className="font-medium">{lane.destination_city}</span>
                      {lane.is_primary && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">Primary</span>
                      )}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-900 text-right tabular-nums">
                    {km(lane.typical_distance_km)}
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-500 text-right tabular-nums">
                    {lane.trips_observed}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Note>
        A corridor is observed, not hardcoded — it follows from the permits and the trips the truck
        has actually run, and you can change it here at any time.
      </Note>
    </Card>
  )
}
