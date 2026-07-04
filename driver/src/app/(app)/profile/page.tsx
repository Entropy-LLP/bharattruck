// driver/src/app/(app)/profile/page.tsx
'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { registerProfile } from '@/lib/api'
import Spinner from '@/components/spinner'

const TRUCK_TYPES = [
  { value: 'mini_truck', label: 'Mini Truck (up to 1 ton)' },
  { value: 'lcv', label: 'LCV – Light Commercial (1–3.5 ton)' },
  { value: 'hcv', label: 'HCV – Heavy Commercial (3.5–12 ton)' },
  { value: 'trailer', label: 'Trailer (12+ ton)' },
] as const

type TruckTypeValue = (typeof TRUCK_TYPES)[number]['value']

export default function ProfilePage() {
  const { user } = useAuth()
  const router = useRouter()

  const [truckType, setTruckType] = useState<TruckTypeValue | ''>('')
  const [truckNumber, setTruckNumber] = useState('')
  const [licenseNumber, setLicenseNumber] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!truckType) {
      toast.error('Please select a truck type to continue')
      return
    }

    setSubmitting(true)
    try {
      await registerProfile({
        full_name: user?.full_name ?? '',
        role: 'driver',
        ...(user?.email ? { email: user.email } : {}),
        truck_type: truckType,
        ...(truckNumber.trim() ? { truck_number: truckNumber.trim() } : {}),
        ...(licenseNumber.trim() ? { license_number: licenseNumber.trim() } : {}),
      })
      toast.success('Profile saved successfully')
      router.replace('/available')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save profile'
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-full bg-gray-50 px-4 py-6 flex flex-col items-center">
      <div className="w-full max-w-[414px] flex flex-col gap-4">

        {/* Account info — read-only */}
        <section
          aria-label="Account information"
          className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100"
        >
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Account
          </h2>

          {/* Avatar initial */}
          <div className="flex items-center gap-4 mb-4">
            <div
              aria-hidden="true"
              className="w-14 h-14 rounded-full bg-blue-600 flex items-center justify-center shrink-0"
            >
              <span className="text-white font-bold text-xl">
                {user?.full_name ? user.full_name.charAt(0).toUpperCase() : '?'}
              </span>
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 truncate">
                {user?.full_name || '—'}
              </p>
              <p className="text-sm text-gray-500 truncate">
                {user?.email || user?.phone || '—'}
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3">
            {user?.phone && (
              <>
                <dt className="text-xs text-gray-400 font-medium">Phone</dt>
                <dd className="text-xs text-gray-700 text-right truncate">{user.phone}</dd>
              </>
            )}
            {user?.email && (
              <>
                <dt className="text-xs text-gray-400 font-medium">Email</dt>
                <dd className="text-xs text-gray-700 text-right truncate">{user.email}</dd>
              </>
            )}
            <dt className="text-xs text-gray-400 font-medium">Role</dt>
            <dd className="text-xs text-gray-700 text-right capitalize">{user?.role || 'driver'}</dd>
          </dl>
        </section>

        {/* Driver profile form */}
        <section
          aria-label="Driver profile setup"
          className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100"
        >
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Driver Profile
          </h2>

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">

            {/* Truck type — required */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="truck-type"
                className="text-sm font-medium text-gray-700"
              >
                Truck Type
                <span aria-hidden="true" className="text-blue-600 ml-0.5">*</span>
              </label>
              <select
                id="truck-type"
                value={truckType}
                onChange={e => setTruckType(e.target.value as TruckTypeValue)}
                required
                aria-required="true"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-shadow appearance-none"
              >
                <option value="" disabled>Select your truck type</option>
                {TRUCK_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400">Required to start receiving load requests</p>
            </div>

            {/* Vehicle number — optional */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="truck-number"
                className="text-sm font-medium text-gray-700"
              >
                Vehicle Registration Number
                <span className="text-gray-400 text-xs font-normal ml-1">(optional)</span>
              </label>
              <input
                id="truck-number"
                type="text"
                value={truckNumber}
                onChange={e => setTruckNumber(e.target.value)}
                placeholder="e.g. MH 04 AB 1234"
                autoComplete="off"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-shadow"
              />
            </div>

            {/* License number — optional */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="license-number"
                className="text-sm font-medium text-gray-700"
              >
                Driving License Number
                <span className="text-gray-400 text-xs font-normal ml-1">(optional)</span>
              </label>
              <input
                id="license-number"
                type="text"
                value={licenseNumber}
                onChange={e => setLicenseNumber(e.target.value)}
                placeholder="e.g. MH0420230012345"
                autoComplete="off"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-shadow"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              aria-busy={submitting}
              className="mt-1 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              {submitting ? (
                <>
                  <Spinner />
                  Saving…
                </>
              ) : (
                'Save Profile'
              )}
            </button>
          </form>
        </section>

      </div>
    </div>
  )
}
