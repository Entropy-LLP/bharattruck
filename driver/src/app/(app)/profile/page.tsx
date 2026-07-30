// driver/src/app/(app)/profile/page.tsx
'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { registerProfile } from '@/lib/api'
import Spinner from '@/components/spinner'

const TRUCK_TYPES = [
  { value: 'mini_truck', label: 'Mini Truck', sub: 'Up to 1 ton', emoji: '🚐' },
  { value: 'lcv', label: 'LCV', sub: 'Light Commercial · 1–3.5 ton', emoji: '🚌' },
  { value: 'hcv', label: 'HCV', sub: 'Heavy Commercial · 3.5–12 ton', emoji: '🚛' },
  { value: 'trailer', label: 'Trailer', sub: '12+ ton', emoji: '🚚' },
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

  const initials = user?.full_name
    ? user.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  return (
    <div className="min-h-full bg-gradient-to-b from-background via-muted/20 to-background px-4 py-6 flex flex-col items-center">
      <div className="w-full max-w-xl flex flex-col gap-4">

        {/* Account info — read-only */}
        <section
          aria-label="Account information"
          className="bg-card rounded-2xl border border-border/60 shadow-sm overflow-hidden"
        >
          {/* Gradient header band */}
          <div className="h-16 bg-gradient-to-r from-primary via-orange-500 to-amber-400 relative">
            <div className="absolute inset-0 opacity-30 bg-[radial-gradient(ellipse_at_top_right,_white_0%,_transparent_70%)]" />
          </div>

          {/* `relative` is load-bearing: the gradient band above is positioned,
              and positioned elements paint over static ones regardless of DOM
              order — without it the band covers the overlapping avatar. */}
          <div className="relative px-5 pb-5 -mt-8">
            {/* Avatar */}
            <div className="flex items-end justify-between mb-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-primary to-amber-400 flex items-center justify-center shadow-lg shadow-primary/30 border-2 border-card">
                <span className="text-white font-black text-xl tracking-tight">{initials}</span>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-emerald-500/12 border border-emerald-500/25 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1">
                Driver
              </span>
            </div>

            <h2 className="font-bold text-foreground text-lg leading-none mb-0.5">
              {user?.full_name || 'Your Name'}
            </h2>
            <p className="text-sm text-muted-foreground truncate">
              {user?.email || user?.phone || '—'}
            </p>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-border/50">
              {[
                { label: 'Phone', value: user?.phone || '—' },
                { label: 'Role', value: user?.role || 'driver' },
                { label: 'Status', value: 'Active' },
              ].map(({ label, value }) => (
                <div key={label} className="text-center">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">{label}</p>
                  <p className="text-xs font-bold text-foreground capitalize truncate">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Driver profile form */}
        <section
          aria-label="Driver profile setup"
          className="bg-card rounded-2xl border border-border/60 shadow-sm p-5"
        >
          <div className="flex items-center gap-2 mb-5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-foreground leading-none">Vehicle Details</h2>
              <p className="text-[10px] text-muted-foreground mt-0.5">Select your truck to start receiving loads</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">

            {/* Truck type — card picker */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-foreground uppercase tracking-wider">
                Truck Type <span className="text-primary">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {TRUCK_TYPES.map(t => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTruckType(t.value)}
                    className={`flex flex-col items-start gap-1 p-3 rounded-xl border transition-all text-left active:scale-[0.97] ${
                      truckType === t.value
                        ? 'border-primary bg-primary/8 shadow-sm shadow-primary/15'
                        : 'border-border/60 bg-secondary/30 hover:border-border hover:bg-secondary/50'
                    }`}
                  >
                    <span className="text-xl">{t.emoji}</span>
                    <span className={`text-sm font-bold leading-none ${truckType === t.value ? 'text-primary' : 'text-foreground'}`}>
                      {t.label}
                    </span>
                    <span className="text-[10px] font-medium text-muted-foreground leading-tight">{t.sub}</span>
                    {truckType === t.value && (
                      <span className="absolute top-2.5 right-2.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                        <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Vehicle number */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="truck-number" className="text-xs font-bold text-foreground uppercase tracking-wider">
                Vehicle Registration
                <span className="text-muted-foreground text-[10px] font-normal normal-case tracking-normal ml-1.5">Optional</span>
              </label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                </div>
                <input
                  id="truck-number"
                  type="text"
                  value={truckNumber}
                  onChange={e => setTruckNumber(e.target.value)}
                  placeholder="e.g. MH 04 AB 1234"
                  autoComplete="off"
                  className="w-full rounded-xl border border-border/70 bg-secondary/30 pl-9 pr-3 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
                />
              </div>
            </div>

            {/* License number */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="license-number" className="text-xs font-bold text-foreground uppercase tracking-wider">
                Driving License
                <span className="text-muted-foreground text-[10px] font-normal normal-case tracking-normal ml-1.5">Optional</span>
              </label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                  </svg>
                </div>
                <input
                  id="license-number"
                  type="text"
                  value={licenseNumber}
                  onChange={e => setLicenseNumber(e.target.value)}
                  placeholder="e.g. MH0420230012345"
                  autoComplete="off"
                  className="w-full rounded-xl border border-border/70 bg-secondary/30 pl-9 pr-3 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || !truckType}
              aria-busy={submitting}
              className="mt-1 w-full rounded-xl bg-gradient-to-r from-primary to-orange-500 px-4 py-3.5 text-sm font-bold text-white hover:from-primary/90 hover:to-orange-500/90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary/30 hover:shadow-primary/40 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {submitting ? (
                <>
                  <Spinner />
                  Saving…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Save Profile
                </>
              )}
            </button>
          </form>
        </section>

      </div>
    </div>
  )
}
