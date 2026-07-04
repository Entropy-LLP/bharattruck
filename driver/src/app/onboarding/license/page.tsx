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
          <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-2">
            <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0" />
            </svg>
          </div>
          <p className="text-xs text-gray-400">Step 3 — Driving license details</p>
        </div>

        {/* Status badge if already submitted */}
        {existing && (
          <div className={`rounded-xl border px-4 py-3 text-sm flex items-center gap-2 ${
            existing.status === 'verified'
              ? 'bg-green-50 border-green-200 text-green-700'
              : existing.status === 'rejected'
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-yellow-50 border-yellow-200 text-yellow-700'
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
        <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">

            {/* DL Number */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dl-number" className="text-sm font-medium text-gray-700">
                DL Number <span className="text-blue-600">*</span>
              </label>
              <input
                id="dl-number"
                type="text"
                value={dlNumber}
                onChange={e => setDlNumber(e.target.value)}
                placeholder="e.g. MH0420230012345"
                required
                autoCapitalize="characters"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-shadow uppercase"
              />
            </div>

            {/* Vehicle classes */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700">Vehicle Classes</label>
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
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                      }`}
                    >
                      {cls.value}
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-gray-400">Select classes endorsed on your license</p>
            </div>

            {/* Expiry date */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dl-expiry" className="text-sm font-medium text-gray-700">Expiry Date</label>
              <input
                id="dl-expiry"
                type="date"
                value={expiryDate}
                onChange={e => setExpiryDate(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-shadow"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
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
            className="flex-1 rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => router.push('/onboarding/insurance')}
            className="flex-1 rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors"
          >
            Skip for now
          </button>
        </div>

      </div>
    </div>
  )
}
