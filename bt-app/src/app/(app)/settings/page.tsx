'use client'

/**
 * Fleet settings.
 *
 * Three things live here and nothing else: the company profile, the ONE cost
 * input the owner actually owns (monthly overhead), and a plain statement of how
 * the P&L is modelled.
 *
 * The two forms PATCH the same endpoint but are saved separately, because they
 * answer different questions — "who are we on an invoice" and "what does the
 * business cost me before a single truck moves". Each save sends only the fields
 * that changed: PATCH /fleet/owners/me (bt-fleet-service/src/routes/owners.ts)
 * rejects an empty body, and the schema there is the exact contract this page
 * validates against, so a bad value is caught before the round-trip.
 *
 * One asymmetry worth knowing: gstin, pan and contact_phone are length-checked
 * (`.length(15)`, `.length(10)`, `.min(8)`) and are NOT nullable in that schema,
 * so once set they can be corrected but not blanked from this console. The form
 * says so instead of sending a value the service will bounce.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Building2, Wallet } from 'lucide-react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/app-shell'
import { Card, CardHead, Empty, ErrorNote, Loading } from '@/components/stat'
import CompletenessSection from '@/components/completeness-section'
import { ApiError, becomeFleetOwner, getMyFleet, updateMyFleet } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { dateTime, inr } from '@/lib/format'
import type { FleetOwner } from '@/lib/types'

// Mirrors OwnerProfileBody in bt-fleet-service/src/routes/owners.ts exactly.
const COMPANY_MIN = 2
const COMPANY_MAX = 120
const GSTIN_LEN = 15
const PAN_LEN = 10
const PHONE_MIN = 8
const PHONE_MAX = 20
const ADDRESS_MAX = 500
const CITY_MAX = 100
const STATE_MAX = 100
const OVERHEAD_MAX = 100_000_000

const INPUT =
  'w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none ' +
  'focus:border-blue-500 focus:ring-2 focus:ring-blue-100'

const PRIMARY_BTN =
  'rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 ' +
  'active:scale-[0.98] transition-transform disabled:opacity-50 disabled:active:scale-100'

const SECONDARY_BTN =
  'rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium px-4 py-2.5'

type ProfileForm = {
  company_name: string
  gstin: string
  pan: string
  contact_phone: string
  billing_address: string
  city: string
  state: string
}

type ProfilePatch = Partial<ProfileForm>

function errText(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return fallback
}

/** numeric(12,2) columns arrive as strings from PostgREST often enough to guard. */
function overheadOf(owner: FleetOwner): number {
  const n = Number(owner.monthly_overhead_inr)
  return Number.isFinite(n) ? n : 0
}

const orig = (v: string | null) => (v ?? '').trim()

export default function SettingsPage() {
  const [owner, setOwner] = useState<FleetOwner | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    getMyFleet()
      .then(data => {
        if (cancelled) return
        setOwner(data)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        // NOT_FOUND is a different situation from a broken call: the account is
        // real but has never registered a fleet profile, so say that plainly.
        if (e instanceof ApiError && e.code === 'NOT_FOUND') setMissing(true)
        else setError(errText(e, 'Could not load your fleet profile'))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [nonce])

  function retry() {
    setLoading(true)
    setError(null)
    setMissing(false)
    setNonce(n => n + 1)
  }

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Settings"
        subtitle="Your company profile and monthly overhead."
      />

      {/* Persona completeness (D-33) — cross-persona, so it sits ABOVE the fleet-owner-gated
          content below and shows for every account (shipper / driver / fleet owner). */}
      <CompletenessSection />

      {loading ? (
        <Loading label="Loading fleet profile" />
      ) : error ? (
        <div className="space-y-3">
          <ErrorNote message={error} />
          <button onClick={retry} className={SECONDARY_BTN}>Try again</button>
        </div>
      ) : missing ? (
        <SetUpFleetCard onDone={retry} />
      ) : !owner ? (
        <Card>
          <Empty title="Nothing to show" hint="The service returned no fleet profile." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-5">
            <ProfileCard owner={owner} onSaved={setOwner} />
            <OverheadCard owner={owner} onSaved={setOwner} />
          </div>
          <div className="space-y-5">
            <AccountCard owner={owner} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Become a fleet owner ──────────────────────────────────────
//
// The self-serve path into the fleet persona for an account that has no profile yet
// — a driver who buys a truck, or a shipper standing up a carrier arm. becomeFleetOwner
// creates the profile; refreshing the auth snapshot opens the fleet console (the rail
// gates on having a profile now), and the page reloads into the company-details form.

function SetUpFleetCard({ onDone }: { onDone: () => void }) {
  const { refresh } = useAuth()
  const [busy, setBusy] = useState(false)

  async function setUp() {
    setBusy(true)
    try {
      await becomeFleetOwner()
      await refresh()
      toast.success('Fleet profile created — fill in your company details below')
      onDone()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not create the fleet profile')
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="text-center py-12 px-4">
        <p className="text-sm font-medium text-gray-900">Run your own trucks?</p>
        <p className="text-xs text-gray-500 mt-1 mb-4">Add trucks, invite drivers, and bid on loads.</p>
        <button
          onClick={setUp}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2.5 active:scale-[0.98] transition-transform"
        >
          {busy && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          Set up fleet management
        </button>
      </div>
    </Card>
  )
}

// ── Company profile ───────────────────────────────────────────

function ProfileCard({ owner, onSaved }: { owner: FleetOwner; onSaved: (o: FleetOwner) => void }) {
  const [form, setForm] = useState<ProfileForm>(() => toForm(owner))
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const patch = buildProfilePatch(form, owner)
  // Dirty is measured on the RAW form, not on the sendable patch: a change the
  // service would reject still has to be submittable, otherwise the button sits
  // disabled and the reason never gets shown.
  const dirty = (Object.keys(form) as (keyof ProfileForm)[])
    .some(k => form[k].trim() !== orig(owner[k]))

  function set<K extends keyof ProfileForm>(key: K, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (patch.message) { setErr(patch.message); return }
    if (Object.keys(patch.fields).length === 0) return
    setBusy(true)
    setErr(null)
    try {
      const updated = await updateMyFleet(patch.fields)
      onSaved(updated)
      setForm(toForm(updated))
      toast.success('Company profile saved')
    } catch (e2) {
      setErr(errText(e2, 'Could not save the company profile'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHead
        title="Company profile"
        sub="What shippers, invoices and your GST filings see."
        actions={<Building2 className="w-4 h-4 text-gray-300" />}
      />
      <form onSubmit={submit}>
        <div className="p-4 space-y-4">
          <Field id="company_name" label="Company name">
            <input
              id="company_name"
              type="text"
              value={form.company_name}
              onChange={e => set('company_name', e.target.value.slice(0, COMPANY_MAX))}
              placeholder="Sharma Transport Company"
              className={INPUT}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              id="gstin"
              label="GSTIN"
              hint={`${GSTIN_LEN} characters. Leave blank if you are not registered.`}
            >
              <input
                id="gstin"
                type="text"
                autoComplete="off"
                value={form.gstin}
                onChange={e => set('gstin', alnum(e.target.value, GSTIN_LEN))}
                placeholder="29ABCDE1234F1Z5"
                className={`${INPUT} font-mono tracking-wide uppercase`}
              />
            </Field>
            <Field id="pan" label="PAN" hint={`${PAN_LEN} characters.`}>
              <input
                id="pan"
                type="text"
                autoComplete="off"
                value={form.pan}
                onChange={e => set('pan', alnum(e.target.value, PAN_LEN))}
                placeholder="ABCDE1234F"
                className={`${INPUT} font-mono tracking-wide uppercase`}
              />
            </Field>
          </div>

          <Field id="contact_phone" label="Contact phone" hint="The number a shipper or our ops team calls.">
            <input
              id="contact_phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={form.contact_phone}
              onChange={e => set('contact_phone', e.target.value.replace(/[^\d+\-\s]/g, '').slice(0, PHONE_MAX))}
              placeholder="+91 98765 43210"
              className={`${INPUT} tabular-nums`}
            />
          </Field>

          <Field id="billing_address" label="Billing address">
            <textarea
              id="billing_address"
              rows={3}
              value={form.billing_address}
              onChange={e => set('billing_address', e.target.value.slice(0, ADDRESS_MAX))}
              placeholder="Plot 14, Transport Nagar, near NH-48"
              className={`${INPUT} resize-y`}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field id="city" label="City">
              <input
                id="city"
                type="text"
                value={form.city}
                onChange={e => set('city', e.target.value.slice(0, CITY_MAX))}
                placeholder="Bengaluru"
                className={INPUT}
              />
            </Field>
            <Field id="state" label="State">
              <input
                id="state"
                type="text"
                value={form.state}
                onChange={e => set('state', e.target.value.slice(0, STATE_MAX))}
                placeholder="Karnataka"
                className={INPUT}
              />
            </Field>
          </div>

          {err && <ErrorNote message={err} />}
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-100">
          <p className="text-xs text-gray-500">
            {dirty ? 'Unsaved changes' : 'Everything here is saved'}
          </p>
          <button type="submit" disabled={busy || !dirty} className={PRIMARY_BTN}>
            {busy ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </form>
    </Card>
  )
}

function toForm(owner: FleetOwner): ProfileForm {
  return {
    company_name: owner.company_name ?? '',
    gstin: owner.gstin ?? '',
    pan: owner.pan ?? '',
    contact_phone: owner.contact_phone ?? '',
    billing_address: owner.billing_address ?? '',
    city: owner.city ?? '',
    state: owner.state ?? '',
  }
}

function alnum(value: string, max: number): string {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, max)
}

/**
 * The changed subset, plus the first reason it cannot be sent. Validation is a
 * transcription of OwnerProfileBody, so the button is only ever pressed with a
 * body the service will accept.
 */
function buildProfilePatch(form: ProfileForm, owner: FleetOwner): { fields: ProfilePatch; message: string | null } {
  const fields: ProfilePatch = {}
  let message: string | null = null
  const fail = (m: string) => { if (!message) message = m }

  const name = form.company_name.trim()
  if (name.length < COMPANY_MIN || name.length > COMPANY_MAX) {
    fail(`Company name must be between ${COMPANY_MIN} and ${COMPANY_MAX} characters.`)
  } else if (name !== orig(owner.company_name)) {
    fields.company_name = name
  }

  for (const f of [
    { key: 'gstin' as const, label: 'GSTIN', length: GSTIN_LEN, current: owner.gstin },
    { key: 'pan' as const, label: 'PAN', length: PAN_LEN, current: owner.pan },
  ]) {
    const value = form[f.key].trim()
    const before = orig(f.current)
    if (value === before) continue
    if (value === '') {
      fail(`${f.label} cannot be cleared from here — it can only be corrected to another ${f.length}-character value.`)
      continue
    }
    if (value.length !== f.length) {
      fail(`${f.label} must be exactly ${f.length} characters.`)
      continue
    }
    fields[f.key] = value
  }

  const phone = form.contact_phone.trim()
  const phoneBefore = orig(owner.contact_phone)
  if (phone !== phoneBefore) {
    if (phone === '') {
      fail('Contact phone cannot be cleared from here — replace it with another number instead.')
    } else if (phone.length < PHONE_MIN || phone.length > PHONE_MAX) {
      fail(`Contact phone must be between ${PHONE_MIN} and ${PHONE_MAX} characters.`)
    } else {
      fields.contact_phone = phone
    }
  }

  // Address, city and state are length-capped only, so blanking them is a legal
  // update — unlike the three above.
  for (const f of [
    { key: 'billing_address' as const, label: 'Billing address', max: ADDRESS_MAX, current: owner.billing_address },
    { key: 'city' as const, label: 'City', max: CITY_MAX, current: owner.city },
    { key: 'state' as const, label: 'State', max: STATE_MAX, current: owner.state },
  ]) {
    const value = form[f.key].trim()
    if (value === orig(f.current)) continue
    if (value.length > f.max) { fail(`${f.label} must be ${f.max} characters or fewer.`); continue }
    fields[f.key] = value
  }

  return { fields, message }
}

// ── Monthly overhead ──────────────────────────────────────────

function OverheadCard({ owner, onSaved }: { owner: FleetOwner; onSaved: (o: FleetOwner) => void }) {
  const saved = overheadOf(owner)
  const [value, setValue] = useState(String(saved))
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const parsed = value.trim() === '' ? null : Number(value)
  const valid = parsed !== null && Number.isFinite(parsed) && parsed >= 0 && parsed <= OVERHEAD_MAX
  // Same rule as the profile form: enable on any edit, so an empty or oversized
  // figure produces a message rather than a dead button.
  const dirty = value.trim() !== String(saved)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) {
      setErr(`Enter a monthly overhead between ${inr(0)} and ${inr(OVERHEAD_MAX)}.`)
      return
    }
    if (parsed === saved) { setValue(String(saved)); return }
    setBusy(true)
    setErr(null)
    try {
      const updated = await updateMyFleet({ monthly_overhead_inr: parsed })
      onSaved(updated)
      setValue(String(overheadOf(updated)))
      toast.success('Monthly overhead saved')
    } catch (e2) {
      setErr(errText(e2, 'Could not save the monthly overhead'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHead
        title="Monthly overhead"
        info="Fixed monthly business cost, not tied to any truck."
        actions={<Wallet className="w-4 h-4 text-gray-300" />}
      />
      <form onSubmit={submit}>
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
            <Field
              id="monthly_overhead_inr"
              label="Overhead per month (₹)"
            >
              <input
                id="monthly_overhead_inr"
                type="text"
                inputMode="numeric"
                value={value}
                onChange={e => setValue(e.target.value.replace(/\D/g, '').slice(0, 9))}
                placeholder="120000"
                className={`${INPUT} tabular-nums`}
              />
            </Field>
            <div className="rounded-xl bg-gray-50 border border-gray-200 px-3 py-2.5">
              <div className="text-xs text-gray-400 uppercase tracking-wide">Currently saved</div>
              <div className="mt-1 text-xl font-bold text-gray-900 tabular-nums">{inr(saved)}</div>
              <div className="text-xs text-gray-500 mt-0.5">per month</div>
            </div>
          </div>

          {err && <ErrorNote message={err} />}
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-100">
          <p className="text-xs text-gray-500">
            {dirty ? 'Unsaved changes' : 'Saved'}
          </p>
          <button type="submit" disabled={busy || !dirty} className={PRIMARY_BTN}>
            {busy ? 'Saving…' : 'Save overhead'}
          </button>
        </div>
      </form>
    </Card>
  )
}

// ── Account meta ──────────────────────────────────────────────

function AccountCard({ owner }: { owner: FleetOwner }) {
  return (
    <Card>
      <CardHead title="Account" />
      <dl className="p-4 space-y-3">
        <Row label="Status">
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
            owner.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'
          }`}>
            {owner.is_active ? 'Active' : 'Inactive'}
          </span>
        </Row>
        <Row label="Fleet ID">
          <span className="font-mono text-xs text-gray-600 break-all">{owner.id}</span>
        </Row>
        <Row label="Registered">
          <span className="text-sm text-gray-600">{dateTime(owner.created_at)}</span>
        </Row>
        <Row label="Last updated">
          <span className="text-sm text-gray-600">{dateTime(owner.updated_at)}</span>
        </Row>
      </dl>
    </Card>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-xs text-gray-400 uppercase tracking-wide pt-0.5 shrink-0">{label}</dt>
      <dd className="text-right min-w-0">{children}</dd>
    </div>
  )
}

// ── Field wrapper ─────────────────────────────────────────────

function Field({
  id, label, hint, children,
}: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="text-xs text-gray-400 uppercase tracking-wide">{label}</label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}
