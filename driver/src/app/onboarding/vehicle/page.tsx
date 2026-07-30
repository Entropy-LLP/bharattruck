'use client'

import { useState, useEffect, useRef, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { getVehicles, createVehicle, updateVehicle, deleteVehicle, ApiError } from '@/lib/api'
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

/**
 * The armed confirmation for one vehicle card.
 *
 * Its own component so the focus move can be a mount effect. Tapping Remove
 * unmounts the trigger, which drops focus to <body> with nothing announced —
 * on the destructive path that is the worst place to go quiet. As an
 * alertdialog described by its own copy, with focus landing on the safe
 * control, the consequence is read out before anything can be confirmed.
 */
function RemoveConfirm({
  vehicle,
  pending,
  busy,
  onCancel,
  onConfirm,
}: {
  vehicle: Vehicle
  /** This vehicle's DELETE is the one in flight — show the spinner here. */
  pending: boolean
  /** A removal or a save is in flight — nothing here may be actioned. */
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const goBackRef = useRef<HTMLButtonElement>(null)
  const descriptionId = `remove-vehicle-${vehicle.id}-description`

  useEffect(() => {
    goBackRef.current?.focus()
  }, [])

  /**
   * Park focus on 'Go back' before the request starts. It is the one control
   * here that stays focusable while inert, so focus survives the whole DELETE
   * however the confirm was reached — including a keyboard user activating the
   * destructive button, which is about to be disabled under them.
   */
  function handleConfirm() {
    goBackRef.current?.focus()
    onConfirm()
  }

  return (
    <div
      role="alertdialog"
      aria-label={`Remove vehicle ${vehicle.rc_number}`}
      aria-describedby={descriptionId}
      className="mt-3 pt-3 border-t border-border/50 flex flex-col gap-3"
    >
      {/* Only consequences the code actually produces: the verification badge
          recomputes from active vehicles and is persisted, and a revived truck
          comes back unverified. Nothing here claims per-vehicle load matching —
          a solo driver's trips name the driver, never the truck. */}
      <p id={descriptionId} className="text-xs font-semibold text-foreground">
        Remove {vehicle.rc_number}? It comes out of your garage, and if it is your only verified
        truck your profile drops back to pending. Trips it has already run keep their record. You
        can add it back later with the same RC number — it will need verifying again.
      </p>
      {/* Focus is parked on an inert button for the length of the request and
          the only other signal is a spinner — say what is happening out loud. */}
      <p aria-live="polite" className="sr-only">
        {pending ? `Removing ${vehicle.rc_number}…` : ''}
      </p>
      <div className="flex gap-2">
        <button
          ref={goBackRef}
          type="button"
          // Inert rather than `disabled`: browsers blur a focused element the
          // moment it is disabled, and this one holds focus for the whole
          // removal — disabling it would drop focus to <body> mid-request.
          aria-disabled={busy}
          onClick={() => {
            if (busy) return
            onCancel()
          }}
          className={`flex-1 h-11 rounded-xl border border-border bg-card text-xs font-bold text-foreground transition-all ${
            busy ? 'opacity-40' : 'active:scale-95'
          }`}
        >
          Go back
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={busy}
          className="flex-1 h-11 rounded-xl bg-red-500 text-white text-xs font-bold shadow-sm shadow-red-500/25 hover:bg-red-500/90 transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {pending ? <><Spinner className="h-3.5 w-3.5" /> Removing…</> : 'Remove'}
        </button>
      </div>
    </div>
  )
}

export default function VehicleStep() {
  const router = useRouter()

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<FormMode>({ kind: 'closed' })
  /** id of the vehicle whose removal is in flight — freezes the page while set. */
  const [removingId, setRemovingId] = useState<string | null>(null)
  /** id awaiting remove confirmation; removal is destructive, so never one-tap. */
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  /** Remove triggers by vehicle id, so focus can be handed back to the one that opened the confirm. */
  const removeTriggers = useRef(new Map<string, HTMLButtonElement | null>())
  /** Vehicle whose Remove trigger takes focus back once the confirm is gone. */
  const refocusRef = useRef<string | null>(null)

  // Form state
  const [rcNumber, setRcNumber] = useState('')
  const [capacityTons, setCapacityTons] = useState('')
  const [bodyType, setBodyType] = useState<BodyType | ''>('')
  const [axleConfig, setAxleConfig] = useState<AxleConfig | ''>('')
  const [makerModel, setMakerModel] = useState('')
  const [fuelType, setFuelType] = useState('')
  const [rcExpiry, setRcExpiry] = useState('')
  const [submitting, setSubmitting] = useState(false)

  /**
   * Mirrors of the two pieces of state the removal handler has to read *after*
   * its await. The click-time closure is a snapshot of a page the driver may
   * have moved on from, and acting on it either drops a vehicle registered in
   * the meantime or closes a form opened in the meantime.
   */
  const vehiclesRef = useRef<Vehicle[]>(vehicles)
  const modeRef = useRef<FormMode>(mode)
  useEffect(() => {
    vehiclesRef.current = vehicles
    modeRef.current = mode
  }, [vehicles, mode])

  /**
   * Closing the confirm unmounts the button holding focus. An alertdialog owes
   * focus back to the control that opened it, so the trigger — remounted in the
   * same commit that cleared `confirmingId` — takes it back here. Only the two
   * paths that close WITHOUT removing arm this; on a successful removal there
   * is no card, and no trigger, left to return to.
   */
  useEffect(() => {
    const id = refocusRef.current
    if (id === null) return
    refocusRef.current = null
    removeTriggers.current.get(id)?.focus()
  }, [confirmingId])

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

  /**
   * Dismissing an armed confirm unmounts the button holding focus. Neither of these
   * paths autofocuses a form field, so without this focus would fall to <body> — the
   * same drop the confirm's own focus handling exists to avoid. Hand it back to the
   * trigger the prompt was armed from.
   */
  function dismissConfirm() {
    if (confirmingId) refocusRef.current = confirmingId
    setConfirmingId(null)
  }

  function openCreate() {
    resetForm()
    dismissConfirm()
    setMode({ kind: 'create' })
  }

  function openEdit(vehicle: Vehicle) {
    // Only one destructive prompt at a time — opening the form dismisses it.
    dismissConfirm()
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

  /**
   * Removal is a soft delete server-side (`is_active=false`), so the row is
   * dropped locally instead of refetched — a removed vehicle simply stops
   * coming back from `getVehicles`.
   */
  async function handleRemove(vehicle: Vehicle) {
    setRemovingId(vehicle.id)
    try {
      await deleteVehicle(vehicle.id)

      // Everything below runs after an await, so it reads the list and the form
      // mode as they are NOW. Removing this one row is a functional update —
      // writing back a filtered copy of the click-time array would silently
      // delete anything registered while the request was in flight.
      setVehicles(prev => prev.filter(v => v.id !== vehicle.id))
      const remaining = vehiclesRef.current.filter(v => v.id !== vehicle.id)
      const currentMode = modeRef.current
      // Keep the mirror honest until the commit lands.
      vehiclesRef.current = remaining

      setConfirmingId(null)
      toast.success(`${vehicle.rc_number} removed`)

      if (remaining.length === 0 && currentMode.kind !== 'create') {
        // Nothing left to list. Land on the same 'register your first vehicle'
        // form the first load shows, rather than a bare page whose Next button
        // can only refuse.
        resetForm()
        setMode({ kind: 'create' })
      } else if (currentMode.kind === 'edit' && currentMode.vehicle.id === vehicle.id) {
        // The form was bound to a vehicle that no longer exists. Only ever the
        // removed one — a form the driver has since opened for a different
        // truck still holds what they typed and is left alone.
        closeForm()
      }
    } catch (err: unknown) {
      // A truck mid-trip cannot be removed. The server's sentence explains why,
      // so show it — this is a legitimate refusal, not a failed request.
      if (err instanceof ApiError && err.code === 'VEHICLE_IN_USE') {
        // The card survives a refusal, so the confirm closed without removing —
        // focus goes back to the trigger rather than to <body>.
        refocusRef.current = vehicle.id
        setConfirmingId(null)
        toast.error(err.message)
        return
      }
      toast.error(
        err instanceof ApiError || err instanceof Error ? err.message : 'Failed to remove vehicle',
      )
    } finally {
      setRemovingId(null)
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
  /**
   * A removal is in flight. The whole page freezes, not just its own card:
   * Next in particular counts a list that is about to shrink, and would walk
   * the driver on to the licence step moments before they have no vehicle at
   * all. Back stays live so a hung request can never trap them here.
   */
  const removing = removingId !== null
  /**
   * Either mutation is in flight, and the freeze has to run both ways. A save
   * already blocks on a removal; without the mirror image, Remove could be
   * confirmed on the truck being saved — the shorter DELETE lands first, the
   * list empties, and the PUT's own post-await cleanup then toasts success for
   * a vehicle that is gone and closes the form over an empty page.
   */
  const mutating = removing || submitting

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
              const isRemoving = removingId === v.id
              const isConfirming = confirmingId === v.id
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
                        disabled={removing}
                        aria-label={`Edit vehicle ${v.rc_number}`}
                        className="inline-flex items-center justify-center min-h-11 px-2.5 text-[11px] font-semibold text-primary hover:text-primary/80 rounded-lg hover:bg-primary/10 transition-colors active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
                      >
                        {beingEdited ? 'Cancel' : 'Edit'}
                      </button>
                      {/* Quiet until it is armed: a sold or written-off truck has
                          to be removable, but it must never be the easy tap.
                          Quiet is about colour, not size — the first tap is the
                          one that gets mis-hit, so it is a full-height target
                          set well clear of Edit rather than a sliver beside it. */}
                      {!isConfirming && (
                        <button
                          ref={el => {
                            removeTriggers.current.set(v.id, el)
                            return () => {
                              removeTriggers.current.delete(v.id)
                            }
                          }}
                          type="button"
                          onClick={() => setConfirmingId(v.id)}
                          disabled={mutating}
                          aria-label={`Remove vehicle ${v.rc_number}`}
                          className="inline-flex items-center justify-center min-h-11 px-2.5 ml-2 text-[11px] font-semibold text-muted-foreground hover:text-red-500 rounded-lg hover:bg-red-500/10 transition-colors active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {v.body_type && <span className="capitalize">{v.body_type}</span>}
                    {v.capacity_tons && <span>{v.capacity_tons}t</span>}
                    {v.axle_config && <span>{v.axle_config}</span>}
                    {v.maker_model && <span>{v.maker_model}</span>}
                    {v.fuel_type && <span className="capitalize">{v.fuel_type}</span>}
                  </div>

                  {/* Two-step confirm, inline in the card — same shape and the
                      same touch targets as the fleet-invite accept. No dialog
                      primitive exists here. */}
                  {isConfirming && (
                    <RemoveConfirm
                      vehicle={v}
                      pending={isRemoving}
                      busy={mutating}
                      onCancel={() => {
                        refocusRef.current = v.id
                        setConfirmingId(null)
                      }}
                      onConfirm={() => handleRemove(v)}
                    />
                  )}
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
            disabled={removing}
            className="w-full rounded-xl border-2 border-dashed border-border px-4 py-3 text-sm font-medium text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
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
                  disabled={removing}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
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
                disabled={submitting || removing}
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
            disabled={removing}
            className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>

      </div>
    </div>
  )
}
