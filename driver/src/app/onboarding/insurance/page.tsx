'use client'

import { useState, useEffect, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { getOnboardingProfile, submitInsurance } from '@/lib/api'
import type { Vehicle, Insurance } from '@/lib/types'
import Spinner from '@/components/spinner'

const FIELD =
  'w-full rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/25'
const SELECT = `${FIELD} appearance-none`
const FIELD_LABEL = 'text-sm font-medium text-foreground/75'

export default function InsuranceStep() {
  const router = useRouter()

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)

  // Form state
  const [selectedVehicleId, setSelectedVehicleId] = useState('')
  const [policyNumber, setPolicyNumber] = useState('')
  const [provider, setProvider] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const data = await getOnboardingProfile()
        setVehicles(data.vehicles)
        // Show form if no vehicle has insurance yet
        const hasAnyInsurance = data.vehicles.some(v => (v.driver_insurance?.length ?? 0) > 0)
        if (!hasAnyInsurance && data.vehicles.length > 0) {
          setShowForm(true)
          setSelectedVehicleId(data.vehicles[0].id)
        }
      } catch {
        // No profile
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  function resetForm() {
    setPolicyNumber('')
    setProvider('')
    setExpiryDate('')
    setSelectedVehicleId(vehicles[0]?.id ?? '')
  }

  function allInsurances(): { vehicle: Vehicle; insurance: Insurance }[] {
    const results: { vehicle: Vehicle; insurance: Insurance }[] = []
    for (const v of vehicles) {
      for (const ins of v.driver_insurance ?? []) {
        results.push({ vehicle: v, insurance: ins })
      }
    }
    return results
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    if (!selectedVehicleId) {
      toast.error('Select a vehicle')
      return
    }
    if (!policyNumber.trim()) {
      toast.error('Policy number is required')
      return
    }

    setSubmitting(true)
    try {
      const { insurance } = await submitInsurance(selectedVehicleId, {
        policy_number: policyNumber.trim(),
        ...(provider.trim() ? { provider: provider.trim() } : {}),
        ...(expiryDate ? { expiry_date: expiryDate } : {}),
      })
      // Update local state
      setVehicles(prev => prev.map(v => {
        if (v.id !== selectedVehicleId) return v
        return { ...v, driver_insurance: [...(v.driver_insurance ?? []), insurance] }
      }))
      resetForm()
      setShowForm(false)
      toast.success('Insurance added')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add insurance'
      toast.error(message)
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

  const existing = allInsurances()

  // No vehicles registered yet
  if (vehicles.length === 0) {
    return (
      <div className="px-4 py-6 flex flex-col items-center">
        <div className="w-full max-w-[414px] text-center">
          <div className="w-12 h-12 rounded-full bg-amber-500/12 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <p className="text-sm text-foreground mb-1">No vehicles registered yet</p>
          <p className="text-xs text-muted-foreground mb-4">Insurance is linked to a vehicle. Register a vehicle first.</p>
          <button
            type="button"
            onClick={() => router.push('/onboarding/vehicle')}
            className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all"
          >
            Go to Vehicle Registration
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-6 flex flex-col items-center">
      <div className="w-full max-w-[414px] flex flex-col gap-4">

        {/* Header */}
        <div className="text-center mb-2">
          <div className="w-12 h-12 rounded-full bg-primary/12 flex items-center justify-center mx-auto mb-2">
            <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <p className="text-xs text-muted-foreground">Step 4 — Vehicle insurance details</p>
        </div>

        {/* Existing insurance entries */}
        {existing.length > 0 && (
          <div className="flex flex-col gap-3">
            {existing.map(({ vehicle, insurance }) => (
              <div
                key={insurance.id}
                className="bg-card rounded-2xl border border-border/60 p-4 shadow-sm"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-foreground text-sm">{insurance.policy_number}</span>
                  <span
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold border ${
                      insurance.status === 'verified'
                        ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border-emerald-500/25'
                        : insurance.status === 'rejected'
                          ? 'bg-red-500/12 text-red-500 border-red-500/25'
                          : 'bg-amber-500/12 text-amber-600 dark:text-amber-400 border-amber-500/25'
                    }`}
                  >
                    {insurance.status}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Vehicle: {vehicle.rc_number}</span>
                  {insurance.provider && <span>{insurance.provider}</span>}
                  {insurance.expiry_date && <span>Exp: {insurance.expiry_date}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add button */}
        {!showForm && (
          <button
            type="button"
            onClick={() => { setShowForm(true); setSelectedVehicleId(vehicles[0]?.id ?? '') }}
            className="w-full rounded-xl border-2 border-dashed border-border px-4 py-3 text-sm font-medium text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add insurance
          </button>
        )}

        {/* Insurance form */}
        {showForm && (
          <div className="bg-card rounded-2xl border border-border/60 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground">Add Insurance</h3>
              {existing.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setShowForm(false); resetForm() }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              )}
            </div>

            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">

              {/* Vehicle selector */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="vehicle-select" className={FIELD_LABEL}>
                  Vehicle <span className="text-primary">*</span>
                </label>
                <select
                  id="vehicle-select"
                  value={selectedVehicleId}
                  onChange={e => setSelectedVehicleId(e.target.value)}
                  className={SELECT}
                >
                  {vehicles.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.rc_number}{v.maker_model ? ` — ${v.maker_model}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Policy number */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="policy-number" className={FIELD_LABEL}>
                  Policy Number <span className="text-primary">*</span>
                </label>
                <input
                  id="policy-number"
                  type="text"
                  value={policyNumber}
                  onChange={e => setPolicyNumber(e.target.value)}
                  placeholder="e.g. POL-2025-12345678"
                  required
                  className={FIELD}
                />
              </div>

              {/* Provider + Expiry row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="provider" className={FIELD_LABEL}>Provider</label>
                  <input
                    id="provider"
                    type="text"
                    value={provider}
                    onChange={e => setProvider(e.target.value)}
                    placeholder="e.g. ICICI Lombard"
                    className={FIELD}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="ins-expiry" className={FIELD_LABEL}>Expiry</label>
                  <input
                    id="ins-expiry"
                    type="date"
                    value={expiryDate}
                    onChange={e => setExpiryDate(e.target.value)}
                    className={FIELD}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {submitting ? <><Spinner className="h-4 w-4" /> Saving…</> : 'Add Insurance'}
              </button>
            </form>
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-3 mt-2">
          <button
            type="button"
            onClick={() => router.push('/onboarding/license')}
            className="flex-1 rounded-xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => router.push('/onboarding/bank-account')}
            className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all"
          >
            {existing.length > 0 ? 'Next' : 'Skip for now'}
          </button>
        </div>

      </div>
    </div>
  )
}
