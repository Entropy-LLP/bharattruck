'use client'

import { useState, useEffect, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { getVehicles, createVehicle, updateVehicle, ApiError } from '@/lib/api'
import type { CreateVehicleInput, UpdateVehicleInput } from '@/lib/api'
import type { Vehicle } from '@/lib/types'
import Spinner from '@/components/spinner'

const BODY_TYPES = [
  { value: 'open', label: 'Open Body' },
  { value: 'closed', label: 'Closed / Container' },
  { value: 'container', label: 'ISO Container' },
  { value: 'flatbed', label: 'Flatbed' },
  { value: 'tanker', label: 'Tanker' },
  { value: 'refrigerated', label: 'Refrigerated' },
] as const

const AXLE_CONFIGS = [
  { value: '4x2', label: '4x2 — 2 axle (Mini / LCV)' },
  { value: '6x2', label: '6x2 — 3 axle' },
  { value: '6x4', label: '6x4 — 3 axle (HCV)' },
  { value: '8x4', label: '8x4 — 4 axle' },
  { value: '10x2', label: '10x2 — Multi-axle trailer' },
] as const

const FUEL_TYPES = ['Diesel', 'Petrol', 'CNG', 'Electric', 'LNG'] as const

type BodyType = (typeof BODY_TYPES)[number]['value']
type AxleConfig = (typeof AXLE_CONFIGS)[number]['value']

/** Closed, adding a new vehicle, or editing an existing one. */
type FormMode =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; vehicle: Vehicle }

const FIELD =
  'w-full rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/25'
const SELECT = `${FIELD} appearance-none`
const FIELD_LABEL = 'text-sm font-medium text-foreground/75'

/** `<input type="date">` only accepts YYYY-MM-DD; the API may send a full timestamp. */
function toDateInput(value: string | null): string {
  return value ? value.slice(0, 10) : ''
}

export default function VehicleStep() {
  const router = useRouter()

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<FormMode>({ kind: 'closed' })

  // Form state
  const [rcNumber, setRcNumber] = useState('')
  const [capacityTons, setCapacityTons] = useState('')
  const [bodyType, setBodyType] = useState<BodyType | ''>('')
  const [axleConfig, setAxleConfig] = useState<AxleConfig | ''>('')
  const [makerModel, setMakerModel] = useState('')
  const [fuelType, setFuelType] = useState('')
  const [rcExpiry, setRcExpiry] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const data = await getVehicles()
        setVehicles(data.vehicles)
        if (data.vehicles.length === 0) setMode({ kind: 'create' })
      } catch {
        setMode({ kind: 'create' })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  function resetForm() {
    setRcNumber('')
    setCapacityTons('')
    setBodyType('')
    setAxleConfig('')
    setMakerModel('')
    setFuelType('')
    setRcExpiry('')
  }

  function openCreate() {
    resetForm()
    setMode({ kind: 'create' })
  }

  function openEdit(vehicle: Vehicle) {
    setRcNumber(vehicle.rc_number)
    setCapacityTons(vehicle.capacity_tons != null ? String(vehicle.capacity_tons) : '')
    setBodyType((vehicle.body_type as BodyType | null) ?? '')
    setAxleConfig((vehicle.axle_config as AxleConfig | null) ?? '')
    setMakerModel(vehicle.maker_model ?? '')
    // Stored lower-case; the select's options are title-case.
    setFuelType(
      FUEL_TYPES.find(f => f.toLowerCase() === vehicle.fuel_type?.toLowerCase()) ?? '',
    )
    setRcExpiry(toDateInput(vehicle.rc_expiry))
    setMode({ kind: 'edit', vehicle })
  }

  function closeForm() {
    resetForm()
    setMode({ kind: 'closed' })
  }

  /** The form's current values, normalised the way the API wants them. */
  function currentValues(): CreateVehicleInput {
    return {
      rc_number: rcNumber.trim().toUpperCase(),
      ...(capacityTons ? { capacity_tons: parseFloat(capacityTons) } : {}),
      ...(bodyType ? { body_type: bodyType } : {}),
      ...(axleConfig ? { axle_config: axleConfig } : {}),
      ...(makerModel.trim() ? { maker_model: makerModel.trim() } : {}),
      ...(fuelType ? { fuel_type: fuelType.toLowerCase() } : {}),
      ...(rcExpiry ? { rc_expiry: rcExpiry } : {}),
    }
  }

  /**
   * Only what actually changed. The server rejects an empty body outright, and
   * resending an unchanged `rc_number` would needlessly risk its uniqueness
   * check, so an untouched field is never sent.
   */
  function changedFields(original: Vehicle): UpdateVehicleInput {
    const next = currentValues()
    const before: UpdateVehicleInput = {
      rc_number: original.rc_number,
      ...(original.capacity_tons != null ? { capacity_tons: original.capacity_tons } : {}),
      ...(original.body_type ? { body_type: original.body_type } : {}),
      ...(original.axle_config ? { axle_config: original.axle_config } : {}),
      ...(original.maker_model ? { maker_model: original.maker_model } : {}),
      ...(original.fuel_type ? { fuel_type: original.fuel_type.toLowerCase() } : {}),
      ...(original.rc_expiry ? { rc_expiry: toDateInput(original.rc_expiry) } : {}),
    }

    const diff: UpdateVehicleInput = {}
    for (const key of Object.keys(next) as (keyof CreateVehicleInput)[]) {
      if (next[key] !== before[key]) {
        Object.assign(diff, { [key]: next[key] })
      }
    }
    return diff
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    if (!rcNumber.trim()) {
      toast.error('RC number is required')
      return
    }

    setSubmitting(true)
    try {
      if (mode.kind === 'edit') {
        const diff = changedFields(mode.vehicle)
        if (Object.keys(diff).length === 0) {
          toast.info('Nothing to save — no details changed')
          setSubmitting(false)
          return
        }
        const { vehicle } = await updateVehicle(mode.vehicle.id, diff)
        setVehicles(prev => prev.map(v => (v.id === vehicle.id ? vehicle : v)))
        toast.success('Vehicle updated')
      } else {
        const { vehicle } = await createVehicle(currentValues())
        setVehicles(prev => [vehicle, ...prev])
        toast.success('Vehicle registered')
      }
      closeForm()
    } catch (err: unknown) {
      const fallback = mode.kind === 'edit' ? 'Failed to update vehicle' : 'Failed to register vehicle'
      toast.error(err instanceof ApiError || err instanceof Error ? err.message : fallback)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    )
  }

  const isEditing = mode.kind === 'edit'
  const formOpen = mode.kind !== 'closed'

  return (
    <div className="px-4 py-6 flex flex-col items-center">
      <div className="w-full max-w-[414px] flex flex-col gap-4">

        {/* Header */}
        <div className="text-center mb-2">
          <div className="w-12 h-12 rounded-full bg-primary/12 flex items-center justify-center mx-auto mb-2">
            <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10m10 0h-3m3 0h2m-2 0V9a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16" />
            </svg>
          </div>
          <p className="text-xs text-muted-foreground">Step 2 — Register your vehicle(s)</p>
        </div>

        {/* Existing vehicles */}
        {vehicles.length > 0 && (
          <div className="flex flex-col gap-3">
            {vehicles.map(v => {
              const beingEdited = isEditing && mode.vehicle.id === v.id
              return (
                <div
                  key={v.id}
                  className={`bg-card rounded-2xl border p-4 shadow-sm transition-colors ${
                    beingEdited ? 'border-primary/50 ring-2 ring-primary/15' : 'border-border/60'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <span className="font-semibold text-foreground text-sm truncate">{v.rc_number}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold border ${
                          v.rc_status === 'verified'
                            ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border-emerald-500/25'
                            : v.rc_status === 'rejected'
                              ? 'bg-red-500/12 text-red-500 border-red-500/25'
                              : 'bg-amber-500/12 text-amber-600 dark:text-amber-400 border-amber-500/25'
                        }`}
                      >
                        {v.rc_status}
                      </span>
                      {/* Details are entered on a phone, often at a roadside — a
                          typo in an RC number must be fixable without support. */}
                      <button
                        type="button"
                        onClick={() => (beingEdited ? closeForm() : openEdit(v))}
                        aria-label={`Edit vehicle ${v.rc_number}`}
                        className="text-[11px] font-semibold text-primary hover:text-primary/80 px-2 py-1 rounded-lg hover:bg-primary/10 transition-colors active:scale-95"
                      >
                        {beingEdited ? 'Cancel' : 'Edit'}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {v.body_type && <span className="capitalize">{v.body_type}</span>}
                    {v.capacity_tons && <span>{v.capacity_tons}t</span>}
                    {v.axle_config && <span>{v.axle_config}</span>}
                    {v.maker_model && <span>{v.maker_model}</span>}
                    {v.fuel_type && <span className="capitalize">{v.fuel_type}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Add vehicle button */}
        {!formOpen && (
          <button
            type="button"
            onClick={openCreate}
            className="w-full rounded-xl border-2 border-dashed border-border px-4 py-3 text-sm font-medium text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add another vehicle
          </button>
        )}

        {/* Vehicle form — create and edit share it, so the fields can never drift */}
        {formOpen && (
          <div className="bg-card rounded-2xl border border-border/60 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground">
                {isEditing
                  ? `Edit ${mode.vehicle.rc_number}`
                  : vehicles.length === 0 ? 'Register Vehicle' : 'Add Vehicle'}
              </h3>
              {(vehicles.length > 0 || isEditing) && (
                <button
                  type="button"
                  onClick={closeForm}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>

            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">

              {/* RC Number */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="rc-number" className={FIELD_LABEL}>
                  RC Number <span className="text-primary">*</span>
                </label>
                <input
                  id="rc-number"
                  type="text"
                  value={rcNumber}
                  onChange={e => setRcNumber(e.target.value)}
                  placeholder="e.g. MH 04 AB 1234"
                  required
                  autoCapitalize="characters"
                  className={`${FIELD} uppercase`}
                />
              </div>

              {/* Body type + Axle config row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="body-type" className={FIELD_LABEL}>Body Type</label>
                  <select
                    id="body-type"
                    value={bodyType}
                    onChange={e => setBodyType(e.target.value as BodyType)}
                    className={SELECT}
                  >
                    <option value="">Select</option>
                    {BODY_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="axle-config" className={FIELD_LABEL}>Axle Config</label>
                  <select
                    id="axle-config"
                    value={axleConfig}
                    onChange={e => setAxleConfig(e.target.value as AxleConfig)}
                    className={SELECT}
                  >
                    <option value="">Select</option>
                    {AXLE_CONFIGS.map(a => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Capacity + Fuel row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="capacity" className={FIELD_LABEL}>Capacity (tons)</label>
                  <input
                    id="capacity"
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="100"
                    value={capacityTons}
                    onChange={e => setCapacityTons(e.target.value)}
                    placeholder="e.g. 9.5"
                    className={FIELD}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="fuel-type" className={FIELD_LABEL}>Fuel Type</label>
                  <select
                    id="fuel-type"
                    value={fuelType}
                    onChange={e => setFuelType(e.target.value)}
                    className={SELECT}
                  >
                    <option value="">Select</option>
                    {FUEL_TYPES.map(f => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Maker/Model */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="maker-model" className={FIELD_LABEL}>Make &amp; Model</label>
                <input
                  id="maker-model"
                  type="text"
                  value={makerModel}
                  onChange={e => setMakerModel(e.target.value)}
                  placeholder="e.g. Tata 407, Ashok Leyland Dost"
                  className={FIELD}
                />
              </div>

              {/* RC Expiry */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="rc-expiry" className={FIELD_LABEL}>RC Expiry Date</label>
                <input
                  id="rc-expiry"
                  type="date"
                  value={rcExpiry}
                  onChange={e => setRcExpiry(e.target.value)}
                  className={FIELD}
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {submitting
                  ? <><Spinner className="h-4 w-4" /> Saving…</>
                  : isEditing ? 'Save changes' : 'Register Vehicle'}
              </button>
            </form>
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-3 mt-2">
          <button
            type="button"
            onClick={() => router.push('/onboarding/personal')}
            className="flex-1 rounded-xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => {
              if (vehicles.length === 0) {
                toast.error('Register at least one vehicle to continue')
                return
              }
              router.push('/onboarding/license')
            }}
            className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all"
          >
            Next
          </button>
        </div>

      </div>
    </div>
  )
}
