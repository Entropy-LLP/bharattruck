'use client'

import { useState, useEffect, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { getOnboardingProfile, submitLicense, updateLicense } from '@/lib/api'
import type { License } from '@/lib/types'
import Spinner from '@/components/spinner'

const VEHICLE_CLASSES = [
  { value: 'LMV', label: 'LMV — Light Motor Vehicle' },
  { value: 'HMV', label: 'HMV — Heavy Motor Vehicle' },
  { value: 'HGMV', label: 'HGMV — Heavy Goods Motor Vehicle' },
  { value: 'HPMV', label: 'HPMV — Heavy Passenger Motor Vehicle' },
  { value: 'TRANS', label: 'TRANS — Transport' },
  { value: 'TRAILR', label: 'TRAILR — Trailer' },
] as const

const FIELD =
  'w-full rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/25'
const FIELD_LABEL = 'text-sm font-medium text-foreground/75'

export default function LicenseStep() {
  const router = useRouter()

  const [existing, setExisting] = useState<License | null>(null)
  const [loading, setLoading] = useState(true)

  const [dlNumber, setDlNumber] = useState('')
  const [vehicleClasses, setVehicleClasses] = useState<string[]>([])
  const [expiryDate, setExpiryDate] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const data = await getOnboardingProfile()
        if (data.license) {
          setExisting(data.license)
          setDlNumber(data.license.dl_number)
          setVehicleClasses(data.license.vehicle_classes ?? [])
          setExpiryDate(data.license.expiry_date ?? '')
        }
      } catch {
        // No profile yet
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  function toggleClass(cls: string) {
    setVehicleClasses(prev =>
      prev.includes(cls)
        ? prev.filter(c => c !== cls)
        : [...prev, cls]
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    if (!dlNumber.trim()) {
      toast.error('Driving license number is required')
      return
    }

    setSubmitting(true)
    try {
      const body = {
        dl_number: dlNumber.trim().toUpperCase(),
        ...(vehicleClasses.length > 0 ? { vehicle_classes: vehicleClasses } : {}),
        ...(expiryDate ? { expiry_date: expiryDate } : {}),
      }

      if (existing) {
        const { license } = await updateLicense(body)
        setExisting(license)
        toast.success('License updated')
      } else {
        const { license } = await submitLicense(body)
        setExisting(license)
        toast.success('License submitted')
      }
      router.push('/onboarding/insurance')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save license'
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

  return (
    <div className="px-4 py-6 flex flex-col items-center">
      <div className="w-full max-w-[414px] flex flex-col gap-4">

        {/* Header */}
        <div className="text-center mb-2">
          <div className="w-12 h-12 rounded-full bg-primary/12 flex items-center justify-center mx-auto mb-2">
            <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0" />
            </svg>
          </div>
          <p className="text-xs text-muted-foreground">Step 3 — Driving license details</p>
        </div>

        {/* Status badge if already submitted */}
        {existing && (
          <div className={`rounded-xl border px-4 py-3 text-sm flex items-center gap-2 ${
            existing.status === 'verified'
              ? 'bg-emerald-500/12 border-emerald-500/25 text-emerald-600 dark:text-emerald-400'
              : existing.status === 'rejected'
                ? 'bg-red-500/12 border-red-500/25 text-red-500'
                : 'bg-amber-500/12 border-amber-500/25 text-amber-600 dark:text-amber-400'
          }`}>
            <span className="font-medium capitalize">{existing.status}</span>
            <span className="text-xs opacity-75">
              {existing.status === 'verified'
                ? '— Your license has been verified'
                : existing.status === 'rejected'
                  ? '— Please re-submit with correct details'
                  : '— Verification in progress'}
            </span>
          </div>
        )}

        {/* License form */}
        <div className="bg-card rounded-2xl border border-border/60 p-5 shadow-sm">
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">

            {/* DL Number */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dl-number" className={FIELD_LABEL}>
                DL Number <span className="text-primary">*</span>
              </label>
              <input
                id="dl-number"
                type="text"
                value={dlNumber}
                onChange={e => setDlNumber(e.target.value)}
                placeholder="e.g. MH0420230012345"
                required
                autoCapitalize="characters"
                className={`${FIELD} uppercase`}
              />
            </div>

            {/* Vehicle classes */}
            <div className="flex flex-col gap-1.5">
              <label className={FIELD_LABEL}>Vehicle Classes</label>
              <div className="flex flex-wrap gap-2">
                {VEHICLE_CLASSES.map(cls => {
                  const selected = vehicleClasses.includes(cls.value)
                  return (
                    <button
                      key={cls.value}
                      type="button"
                      onClick={() => toggleClass(cls.value)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                        selected
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-card text-muted-foreground border-border hover:border-primary/50'
                      }`}
                    >
                      {cls.value}
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground">Select classes endorsed on your license</p>
            </div>

            {/* Expiry date */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dl-expiry" className={FIELD_LABEL}>Expiry Date</label>
              <input
                id="dl-expiry"
                type="date"
                value={expiryDate}
                onChange={e => setExpiryDate(e.target.value)}
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
                : existing ? 'Update & Next' : 'Submit & Next'
              }
            </button>
          </form>
        </div>

        {/* Navigation */}
        <div className="flex gap-3 mt-2">
          <button
            type="button"
            onClick={() => router.push('/onboarding/vehicle')}
            className="flex-1 rounded-xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => router.push('/onboarding/insurance')}
            className="flex-1 rounded-xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors"
          >
            Skip for now
          </button>
        </div>

      </div>
    </div>
  )
}
