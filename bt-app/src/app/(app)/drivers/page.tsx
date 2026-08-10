'use client'

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  AlertTriangle, Clock, Pencil, RotateCcw, Star, TrendingUp, UserMinus,
  UserPlus, Users, Wallet, X,
} from 'lucide-react'
import { PageHeader } from '@/components/app-shell'
import { Card, CardHead, Empty, ErrorNote, InfoDot, Loading, Stat } from '@/components/stat'
import {
  ApiError, getDriverAnalytics, inviteDriver, listFleetDrivers, removeFleetDriver,
  updateFleetDriver,
} from '@/lib/api'
import { inr, km, shortDate, timeAgo } from '@/lib/format'
import type { DriverAnalytics, FleetDriver, FleetDriverStatus, Period } from '@/lib/types'

/**
 * The driver roster.
 *
 * CONSENT IS THE WHOLE DESIGN OF THIS PAGE. bt-fleet-service/src/routes/drivers.ts
 * refuses PATCH status on a 'pending' row ("CONSENT GATE") — only the driver can
 * move an invitation to 'active', from their own app via
 * POST /fleet/drivers/invites/:id/respond, which this console cannot call. So the
 * pending section deliberately renders NO activate/accept control at all: an owner
 * conscripting a driver who never agreed was a real defect, and a disabled-looking
 * button here would still imply the owner is the one who decides. Salary is the
 * only thing editable before acceptance.
 */

// GET /fleet/drivers returns the affiliation row with the identity NESTED under
// `driver` (routes/drivers.ts maps `{ ...row, driver: identities.get(...) }`),
// while FleetDriver in lib/types.ts declares those fields flat. Read both and
// prefer the nested one, so the page renders whichever shape the service sends.
type DriverIdentity = {
  driver_id: string
  user_id: string
  full_name: string | null
  phone_number: string | null
  kyc_status: string | null
  average_rating: number | null
  total_trips: number | null
}
type RosterRow = FleetDriver & { driver?: DriverIdentity | null }

const PHONE_RE = /^[6-9]\d{9}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_SALARY = 10_000_000

const nameOf = (r: RosterRow) => r.driver?.full_name ?? r.full_name ?? null
const phoneOf = (r: RosterRow) => r.driver?.phone_number ?? r.phone_number ?? null
const ratingOf = (r: RosterRow) => r.driver?.average_rating ?? r.average_rating ?? null
const lifetimeTripsOf = (r: RosterRow) => r.driver?.total_trips ?? r.total_trips ?? null
const kycOf = (r: RosterRow) => r.driver?.kyc_status ?? null

const FORMER_LABEL: Record<'left' | 'rejected' | 'suspended', { label: string; color: string }> = {
  left:      { label: 'Left',                color: 'bg-gray-100 text-gray-600' },
  rejected:  { label: 'Declined invitation', color: 'bg-red-100 text-red-800' },
  suspended: { label: 'Suspended',           color: 'bg-orange-100 text-orange-800' },
}

function errText(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return fallback
}

function sum(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0)
}

export default function DriversPage() {
  const [rows, setRows] = useState<RosterRow[] | null>(null)
  const [analytics, setAnalytics] = useState<{ period: Period; drivers: DriverAnalytics[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [analyticsError, setAnalyticsError] = useState<string | null>(null)

  const [inviteOpen, setInviteOpen] = useState(false)
  const [salaryTarget, setSalaryTarget] = useState<RosterRow | null>(null)
  const [removeTarget, setRemoveTarget] = useState<RosterRow | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setAnalyticsError(null)
    // Settled, not all: a failing analytics roll-up must not blank the roster —
    // the roster is the part of this page you cannot work without.
    const [roster, ana] = await Promise.allSettled([listFleetDrivers(), getDriverAnalytics()])
    if (roster.status === 'fulfilled') setRows(roster.value)
    else setError(errText(roster.reason, 'Could not load the driver roster'))
    if (ana.status === 'fulfilled') setAnalytics(ana.value)
    else setAnalyticsError(errText(ana.reason, 'Could not load per-driver economics'))
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  function mergeRow(updated: FleetDriver) {
    // PATCH returns the bare affiliation row (no nested identity), so spread the
    // existing row first and keep the name/phone we already have.
    setRows(prev => prev?.map(r => (r.id === updated.id ? { ...r, ...updated } : r)) ?? prev)
  }

  async function handleReinstate(row: RosterRow) {
    setBusyId(row.id)
    setRowError(null)
    try {
      mergeRow(await updateFleetDriver(row.id, { status: 'active' }))
    } catch (e) {
      // The client maps CONFLICT to a truck-centric string; the real cause here is
      // fleet_drivers_one_live_per_driver — they joined someone else meanwhile.
      setRowError(e instanceof ApiError && e.code === 'CONFLICT'
        ? 'That driver has since taken a pending or active affiliation with another fleet.'
        : errText(e, 'Could not reinstate this driver'))
    } finally {
      setBusyId(null)
    }
  }

  const anaById = new Map((analytics?.drivers ?? []).map(d => [d.driver_id, d]))
  const periodLabel = analytics
    ? `${shortDate(analytics.period.from)} – ${shortDate(analytics.period.to)}`
    : null

  const active = rows?.filter(r => r.status === 'active') ?? []
  const pending = rows?.filter(r => r.status === 'pending') ?? []
  const former = rows?.filter(
    (r): r is RosterRow & { status: 'left' | 'rejected' | 'suspended' } =>
      r.status === 'left' || r.status === 'rejected' || r.status === 'suspended',
  ) ?? []

  const salaried = active.filter(r => r.monthly_salary_inr !== null)
  const wageBill = sum(salaried.map(r => r.monthly_salary_inr ?? 0))
  const unsalaried = active.length - salaried.length
  const periodProfit = analytics ? sum(analytics.drivers.map(d => d.net_profit_inr)) : null
  const periodTrips = analytics ? sum(analytics.drivers.map(d => d.trips)) : null
  const periodDistance = analytics ? sum(analytics.drivers.map(d => d.distance_km)) : null

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Drivers"
        info="Fleet drivers see the job, not the price — you assign their truck and trip."
        subtitle={rows ? `${active.length} active · ${pending.length} invited · ${former.length} former` : undefined}
        actions={
          <button
            onClick={() => setInviteOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 active:scale-[0.98] transition-transform"
          >
            <UserPlus className="w-4 h-4" />
            Invite driver
          </button>
        }
      />


      {loading ? (
        <Loading label="Loading roster" />
      ) : error ? (
        <div className="space-y-3">
          <ErrorNote message={error} />
          <button
            onClick={() => void load()}
            className="rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium px-4 py-2.5"
          >
            Try again
          </button>
        </div>
      ) : !rows || rows.length === 0 ? (
        <Card>
          <Empty
            title="No drivers on the roster yet"
            hint="Invite a driver by their BharatTruck phone number."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat
              label="Active drivers"
              value={active.length}
              sub={lifetimeTripsLine(active)}
              icon={<Users className="w-4 h-4" />}
            />
            <Stat
              label="Awaiting acceptance"
              value={pending.length}
              tone={pending.length > 0 ? 'warn' : 'neutral'}
              sub={pending.length > 0 ? 'The driver has to accept' : 'No open invitations'}
              icon={<Clock className="w-4 h-4" />}
            />
            <Stat
              label="Monthly wage bill"
              value={inr(wageBill)}
              sub={unsalaried > 0 ? `${unsalaried} without a salary set` : `${salaried.length} salaried`}
              icon={<Wallet className="w-4 h-4" />}
            />
            <Stat
              label="Net profit contributed"
              value={inr(periodProfit)}
              tone={periodProfit === null ? 'neutral' : periodProfit >= 0 ? 'good' : 'bad'}
              sub={periodTrips !== null ? `${periodTrips} trips · ${km(periodDistance)}` : 'Not available'}
              icon={<TrendingUp className="w-4 h-4" />}
            />
          </div>

          {analyticsError && <ErrorNote message={`Per-driver economics unavailable — ${analyticsError}`} />}
          {rowError && <ErrorNote message={rowError} />}

          {/* ── Active ─────────────────────────────────────────── */}
          <Card>
            <CardHead
              title="Active"
              sub={periodLabel
                ? `${active.length} on the roster · trips, distance, profit and wages are for ${periodLabel}`
                : `${active.length} on the roster`}
            />
            {active.length === 0 ? (
              <Empty title="Nobody active" hint="Invited drivers appear here once they accept." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px]">
                  <thead>
                    <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                      <th className="py-2.5 px-4 text-left font-medium">Driver</th>
                      <th className="py-2.5 px-4 text-left font-medium">Phone</th>
                      <th className="py-2.5 px-4 text-right font-medium">Rating</th>
                      <th className="py-2.5 px-4 text-right font-medium">Lifetime trips</th>
                      <th className="py-2.5 px-4 text-right font-medium">Monthly salary</th>
                      <th className="py-2.5 px-4 text-right font-medium border-l border-gray-100">Trips</th>
                      <th className="py-2.5 px-4 text-right font-medium">Distance</th>
                      <th className="py-2.5 px-4 text-right font-medium">Net profit</th>
                      <th className="py-2.5 px-4 text-right font-medium">Wage allocated</th>
                      <th className="py-2.5 px-4 text-right font-medium"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.map(row => {
                      const a = anaById.get(row.driver_id)
                      return (
                        <tr key={row.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="py-3 px-4 text-sm">
                            <div className="font-medium text-gray-900">{nameOf(row) ?? 'Unnamed driver'}</div>
                            <KycPill status={kycOf(row)} />
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-600 tabular-nums">{phoneOf(row) ?? '—'}</td>
                          <td className="py-3 px-4 text-sm text-right">
                            <Rating value={ratingOf(row)} />
                          </td>
                          <td className="py-3 px-4 text-sm text-right tabular-nums text-gray-600">
                            {lifetimeTripsOf(row)?.toLocaleString('en-IN') ?? '—'}
                          </td>
                          <td className="py-3 px-4 text-sm text-right">
                            <SalaryButton row={row} onEdit={setSalaryTarget} />
                          </td>
                          <td className="py-3 px-4 text-sm text-right tabular-nums text-gray-600 border-l border-gray-100">
                            {a ? a.trips.toLocaleString('en-IN') : '—'}
                          </td>
                          <td className="py-3 px-4 text-sm text-right tabular-nums text-gray-600">
                            {a ? km(a.distance_km) : '—'}
                          </td>
                          <td className={`py-3 px-4 text-sm text-right tabular-nums font-medium ${
                            !a ? 'text-gray-400' : a.net_profit_inr >= 0 ? 'text-emerald-700' : 'text-red-600'
                          }`}>
                            {a ? inr(a.net_profit_inr) : '—'}
                          </td>
                          <td className="py-3 px-4 text-sm text-right tabular-nums text-gray-600">
                            {a ? inr(a.wage_allocated_inr) : '—'}
                          </td>
                          <td className="py-3 px-4 text-sm text-right">
                            <button
                              onClick={() => { setRowError(null); setRemoveTarget(row) }}
                              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
                            >
                              <UserMinus className="w-3.5 h-3.5" />
                              Remove
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* ── Pending ────────────────────────────────────────── */}
          {pending.length > 0 && (
            <Card>
              <CardHead
                title="Pending invitation"
                info="Only the driver can accept, from their own app."
              />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px]">
                  <thead>
                    <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                      <th className="py-2.5 px-4 text-left font-medium">Driver</th>
                      <th className="py-2.5 px-4 text-left font-medium">Phone</th>
                      <th className="py-2.5 px-4 text-left font-medium">Invited</th>
                      <th className="py-2.5 px-4 text-left font-medium">Waiting on</th>
                      <th className="py-2.5 px-4 text-right font-medium">Monthly salary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map(row => (
                      <tr key={row.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="py-3 px-4 text-sm">
                          <div className="font-medium text-gray-900">{nameOf(row) ?? 'Unnamed driver'}</div>
                          <KycPill status={kycOf(row)} />
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-600 tabular-nums">{phoneOf(row) ?? '—'}</td>
                        <td className="py-3 px-4 text-sm text-gray-600">
                          Invited {timeAgo(row.invited_at)}
                          <div className="text-xs text-gray-400">{shortDate(row.invited_at)}</div>
                        </td>
                        <td className="py-3 px-4 text-sm">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-orange-100 text-orange-800">
                            <Clock className="w-3 h-3" />
                            The driver must accept
                          </span>
                        </td>
                        <td className="py-3 px-4 text-sm text-right">
                          <SalaryButton row={row} onEdit={setSalaryTarget} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* ── Former ─────────────────────────────────────────── */}
          {former.length > 0 && (
            <Card>
              <CardHead title="Former" sub="Left, declined or suspended" />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px]">
                  <thead>
                    <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                      <th className="py-2.5 px-4 text-left font-medium">Driver</th>
                      <th className="py-2.5 px-4 text-left font-medium">Phone</th>
                      <th className="py-2.5 px-4 text-left font-medium">Status</th>
                      <th className="py-2.5 px-4 text-left font-medium">Since</th>
                      <th className="py-2.5 px-4 text-right font-medium">Last salary</th>
                      <th className="py-2.5 px-4 text-right font-medium"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {former.map(row => {
                      const cfg = FORMER_LABEL[row.status]
                      return (
                        <tr key={row.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="py-3 px-4 text-sm font-medium text-gray-900">
                            {nameOf(row) ?? 'Unnamed driver'}
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-600 tabular-nums">{phoneOf(row) ?? '—'}</td>
                          <td className="py-3 px-4 text-sm">
                            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${cfg.color}`}>
                              {cfg.label}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-600">
                            {shortDate(row.left_at ?? row.responded_at ?? row.invited_at)}
                          </td>
                          <td className="py-3 px-4 text-sm text-right tabular-nums text-gray-600">
                            {inr(row.monthly_salary_inr)}
                          </td>
                          <td className="py-3 px-4 text-sm text-right">
                            {row.status === 'suspended' && (
                              <button
                                onClick={() => void handleReinstate(row)}
                                disabled={busyId === row.id}
                                title="Put this driver back on the active roster"
                                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 transition-colors disabled:opacity-50"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                {busyId === row.id ? 'Reinstating…' : 'Reinstate'}
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {inviteOpen && (
        <InviteDialog
          onClose={() => setInviteOpen(false)}
          onInvited={created => {
            setRows(prev => (prev ? [created, ...prev] : [created]))
            setInviteOpen(false)
          }}
        />
      )}

      {salaryTarget && (
        <SalaryDialog
          row={salaryTarget}
          onClose={() => setSalaryTarget(null)}
          onSaved={updated => { mergeRow(updated); setSalaryTarget(null) }}
        />
      )}

      {removeTarget && (
        <RemoveDialog
          row={removeTarget}
          onClose={() => setRemoveTarget(null)}
          onRemoved={id => {
            // The service soft-deletes: the row becomes 'left' and keeps its history,
            // so it moves to the Former section rather than disappearing.
            setRows(prev => prev?.map(r => (
              r.id === id
                ? { ...r, status: 'left' as FleetDriverStatus, left_at: new Date().toISOString() }
                : r
            )) ?? prev)
            setRemoveTarget(null)
          }}
        />
      )}
    </div>
  )
}

// ── Small pieces ──────────────────────────────────────────────

function lifetimeTripsLine(active: RosterRow[]): string {
  const known = active.map(r => lifetimeTripsOf(r)).filter((n): n is number => n !== null)
  if (known.length === 0) return 'No trip history yet'
  return `${sum(known).toLocaleString('en-IN')} lifetime trips`
}

function Rating({ value }: { value: number | null }) {
  if (value === null) return <span className="text-gray-400">—</span>
  return (
    <span className="inline-flex items-center gap-1 tabular-nums text-gray-900">
      <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
      {value.toFixed(1)}
    </span>
  )
}

/** KYC state from users.kyc_status — the only verification signal the roster returns. */
function KycPill({ status }: { status: string | null }) {
  if (!status) return null
  const verified = status.toLowerCase() === 'verified'
  return (
    <span className={`mt-1 inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${
      verified ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'
    }`}>
      {verified ? 'KYC verified' : `KYC ${status.replace(/_/g, ' ')}`}
    </span>
  )
}

function SalaryButton({ row, onEdit }: { row: RosterRow; onEdit: (r: RosterRow) => void }) {
  const set = row.monthly_salary_inr !== null
  return (
    <button
      onClick={() => onEdit(row)}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 -mr-2 text-sm tabular-nums hover:bg-gray-100 transition-colors ${
        set ? 'text-gray-900' : 'text-blue-600 font-medium'
      }`}
    >
      {set ? inr(row.monthly_salary_inr) : 'Set salary'}
      <Pencil className="w-3.5 h-3.5 text-gray-400" />
    </button>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/30 cursor-default" />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-md bg-white rounded-xl border border-gray-200 shadow-lg">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

// ── Invite ────────────────────────────────────────────────────

function InviteDialog({ onClose, onInvited }: { onClose: () => void; onInvited: (r: RosterRow) => void }) {
  // The owner invites by whichever channel they have for the driver — phone or email.
  const [channel, setChannel] = useState<'phone' | 'email'>('phone')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    // Phones are stored E.164 (+91…), so the lookup needs the country code prefixed.
    let payload: { driver_phone: string } | { driver_email: string }
    if (channel === 'phone') {
      if (!PHONE_RE.test(phone)) {
        setErr('Enter a valid 10-digit Indian mobile number (starting 6, 7, 8 or 9).')
        return
      }
      payload = { driver_phone: `+91${phone}` }
    } else {
      if (!EMAIL_RE.test(email.trim())) {
        setErr('Enter a valid email address.')
        return
      }
      payload = { driver_email: email.trim() }
    }
    setBusy(true)
    try {
      onInvited(await inviteDriver(payload))
    } catch (e2) {
      if (e2 instanceof ApiError && e2.code === 'NOT_FOUND') {
        setErr(channel === 'phone'
          ? 'No driver account with that number — ask them to sign up first.'
          : 'No driver account with that email — ask them to sign up first.')
      } else if (e2 instanceof ApiError && e2.code === 'CONFLICT') {
        // The shared client maps CONFLICT to a truck-centric message; on invite the
        // real cause is fleet_drivers_one_live_per_driver.
        setErr('That driver already has a pending or active fleet affiliation.')
      } else {
        setErr(errText(e2, 'Could not send the invitation'))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Invite a driver" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {/* Channel: phone or email — the owner's choice. */}
        <div className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-0.5">
          {(['phone', 'email'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => { setChannel(c); setErr(null) }}
              className={`rounded-[10px] px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
                channel === c ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {channel === 'phone' ? (
          <div>
            <label htmlFor="invite-phone" className="text-xs text-gray-400 uppercase tracking-wide">
              Driver mobile number
            </label>
            <div className="mt-1.5 flex items-center rounded-xl border border-gray-200 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 overflow-hidden">
              <span className="pl-3 pr-2 text-sm text-gray-400 select-none">+91</span>
              <input
                id="invite-phone"
                type="tel"
                inputMode="numeric"
                autoFocus
                autoComplete="off"
                placeholder="9876543210"
                value={phone}
                onChange={e => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); setErr(null) }}
                className="flex-1 py-2.5 pr-3 text-sm tabular-nums outline-none"
              />
            </div>
          </div>
        ) : (
          <div>
            <label htmlFor="invite-email" className="text-xs text-gray-400 uppercase tracking-wide">
              Driver email
            </label>
            <input
              id="invite-email"
              type="email"
              autoFocus
              autoComplete="off"
              placeholder="driver@example.com"
              value={email}
              onChange={e => { setEmail(e.target.value); setErr(null) }}
              className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
        )}

        {err && <ErrorNote message={err} />}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium px-4 py-2.5"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 active:scale-[0.98] transition-transform disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Send invitation'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Salary ────────────────────────────────────────────────────

function SalaryDialog({
  row, onClose, onSaved,
}: { row: RosterRow; onClose: () => void; onSaved: (updated: FleetDriver) => void }) {
  const [value, setValue] = useState(row.monthly_salary_inr !== null ? String(row.monthly_salary_inr) : '')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const n = Number(value)
    if (value.trim() === '' || !Number.isFinite(n) || n < 0 || n > MAX_SALARY) {
      setErr(`Enter a monthly salary between ${inr(0)} and ${inr(MAX_SALARY)}.`)
      return
    }
    setBusy(true)
    setErr(null)
    try {
      onSaved(await updateFleetDriver(row.id, { monthly_salary_inr: Math.round(n) }))
    } catch (e2) {
      setErr(errText(e2, 'Could not update the salary'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Monthly salary" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <div className="text-sm font-medium text-gray-900">{nameOf(row) ?? 'Unnamed driver'}</div>
          <div className="text-xs text-gray-500">{phoneOf(row) ?? 'No phone on file'}</div>
        </div>
        <div>
          <label htmlFor="salary" className="text-xs text-gray-400 uppercase tracking-wide inline-flex items-center gap-1.5">
            Monthly salary (₹)
            <InfoDot text="Allocated across this driver's trips as wage cost." />
          </label>
          <input
            id="salary"
            type="text"
            inputMode="numeric"
            autoFocus
            value={value}
            onChange={e => setValue(e.target.value.replace(/\D/g, '').slice(0, 8))}
            placeholder="25000"
            className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm tabular-nums outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>
        {row.status === 'pending' && (
          <p className="text-xs text-gray-500 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
            Setting a salary does not accept the invitation for them.
          </p>
        )}
        {err && <ErrorNote message={err} />}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium px-4 py-2.5"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 active:scale-[0.98] transition-transform disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save salary'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Remove ────────────────────────────────────────────────────

function RemoveDialog({
  row, onClose, onRemoved,
}: { row: RosterRow; onClose: () => void; onRemoved: (id: string) => void }) {
  const [err, setErr] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    setErr(null)
    setHint(null)
    try {
      await removeFleetDriver(row.id)
      onRemoved(row.id)
    } catch (e) {
      setErr(errText(e, 'Could not remove this driver'))
      // Both codes the service can raise here mean the same thing on the ground, and
      // the shared client rewrites them to something generic — say what to do next.
      if (e instanceof ApiError && (e.code === 'INVALID_TRANSITION' || e.code === 'CONFLICT')) {
        setHint('This driver is on a live trip. It has to finish before they can leave the fleet.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Remove from fleet" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex gap-2.5 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
          <p className="text-sm text-orange-900">
            Removing is blocked while the driver is on a live trip — release or finish the assignment first.
          </p>
        </div>
        <p className="text-sm text-gray-600">
          Remove <span className="font-medium text-gray-900">{nameOf(row) ?? 'this driver'}</span> from
          your fleet?
        </p>
        {err && <ErrorNote message={err} />}
        {hint && <p className="text-xs text-gray-500">{hint}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium px-4 py-2.5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className="rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-2.5 active:scale-[0.98] transition-transform disabled:opacity-50"
          >
            {busy ? 'Removing…' : 'Remove driver'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
