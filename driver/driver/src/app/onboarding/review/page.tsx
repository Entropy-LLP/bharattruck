'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getOnboardingStatus, getOnboardingProfile } from '@/lib/api'
import type { OnboardingStatus, OnboardingProfile } from '@/lib/types'
import Spinner from '@/components/spinner'

function CheckIcon({ done }: { done: boolean }) {
  if (done) {
    return (
      <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center shrink-0">
        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      </div>
    )
  }
  return (
    <div className="w-5 h-5 rounded-full border-2 border-gray-300 shrink-0" />
  )
}

const BADGE_CONFIG = {
  pending: { bg: 'bg-yellow-50', border: 'border-yellow-300', text: 'text-yellow-700', label: 'Pending' },
  verified: { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-700', label: 'Verified' },
  premium: { bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-700', label: 'Premium' },
} as const

export default function ReviewStep() {
  const router = useRouter()

  const [status, setStatus] = useState<OnboardingStatus | null>(null)
  const [profile, setProfile] = useState<OnboardingProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [s, p] = await Promise.all([getOnboardingStatus(), getOnboardingProfile()])
        setStatus(s)
        setProfile(p)
      } catch {
        // Will show empty state
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    )
  }

  const badge = status?.verification_badge ?? 'pending'
  const badgeStyle = BADGE_CONFIG[badge]
  const checklist = status?.checklist

  const completedCount = checklist
    ? Object.values(checklist).filter(Boolean).length
    : 0
  const totalItems = 7

  return (
    <div className="px-4 py-6 flex flex-col items-center">
      <div className="w-full max-w-[414px] flex flex-col gap-4">

        {/* Header */}
        <div className="text-center mb-2">
          <div className={`w-16 h-16 rounded-full ${badgeStyle.bg} border-2 ${badgeStyle.border} flex items-center justify-center mx-auto mb-3`}>
            {badge === 'pending' ? (
              <svg className={`w-7 h-7 ${badgeStyle.text}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : badge === 'verified' ? (
              <svg className={`w-7 h-7 ${badgeStyle.text}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            ) : (
              <svg className={`w-7 h-7 ${badgeStyle.text}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
            )}
          </div>
          <h2 className={`text-lg font-bold ${badgeStyle.text}`}>{badgeStyle.label}</h2>
          <p className="text-xs text-gray-400 mt-1">
            {completedCount} of {totalItems} items completed
          </p>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-green-500 h-2 rounded-full transition-all duration-500"
            style={{ width: `${(completedCount / totalItems) * 100}%` }}
          />
        </div>

        {/* Checklist */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Verification Checklist
          </h3>

          <div className="flex flex-col gap-3">
            <ChecklistItem
              done={checklist?.profile_complete ?? false}
              label="Profile complete"
              detail={profile?.driver ? `${profile.user.full_name ?? '—'}, ${profile.driver.home_base_city ?? '—'}` : 'Name, photo, languages, city'}
              onFix={() => router.push('/onboarding/personal')}
            />
            <ChecklistItem
              done={checklist?.vehicle_registered ?? false}
              label="Vehicle registered"
              detail={profile?.vehicles.length ? `${profile.vehicles.length} vehicle(s)` : 'At least one vehicle'}
              onFix={() => router.push('/onboarding/vehicle')}
            />
            <ChecklistItem
              done={checklist?.vehicle_verified ?? false}
              label="Vehicle verified"
              detail={checklist?.vehicle_verified ? 'RC verified by team' : 'Pending admin verification'}
            />
            <ChecklistItem
              done={checklist?.license_submitted ?? false}
              label="License submitted"
              detail={checklist?.license_submitted ? 'DL on file' : 'Upload your driving license'}
              onFix={() => router.push('/onboarding/license')}
            />
            <ChecklistItem
              done={checklist?.license_verified ?? false}
              label="License verified"
              detail={checklist?.license_verified ? 'DL verified by team' : 'Pending admin verification'}
            />
            <ChecklistItem
              done={checklist?.insurance_uploaded ?? false}
              label="Insurance uploaded"
              detail={checklist?.insurance_uploaded ? 'Policy on file' : 'Add vehicle insurance'}
              onFix={() => router.push('/onboarding/insurance')}
            />
            <ChecklistItem
              done={checklist?.bank_linked ?? false}
              label="Bank account linked"
              detail={
                profile?.bank_accounts.length
                  ? `●●●● ${profile.bank_accounts[0].account_number_last4}`
                  : 'Required for payouts'
              }
              onFix={() => router.push('/onboarding/bank-account')}
            />
          </div>
        </div>

        {/* Badge tier explanation */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Verification Tiers
          </h3>
          <div className="flex flex-col gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-yellow-400 shrink-0" />
              <span className="text-gray-600"><span className="font-medium text-gray-800">Pending</span> — Complete your profile to start</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              <span className="text-gray-600"><span className="font-medium text-gray-800">Verified</span> — Profile + license + vehicle + bank linked</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
              <span className="text-gray-600"><span className="font-medium text-gray-800">Premium</span> — Verified + insurance + KYC approved</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 mt-2">
          <button
            type="button"
            onClick={() => router.push('/onboarding/bank-account')}
            className="flex-1 rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => router.push('/available')}
            className="flex-1 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 active:scale-[0.98] transition-all"
          >
            Start Browsing Loads
          </button>
        </div>

      </div>
    </div>
  )
}

function ChecklistItem({
  done,
  label,
  detail,
  onFix,
}: {
  done: boolean
  label: string
  detail: string
  onFix?: () => void
}) {
  return (
    <div className="flex items-center gap-3">
      <CheckIcon done={done} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${done ? 'text-gray-900' : 'text-gray-500'}`}>{label}</p>
        <p className="text-xs text-gray-400 truncate">{detail}</p>
      </div>
      {!done && onFix && (
        <button
          type="button"
          onClick={onFix}
          className="text-xs text-blue-600 font-medium hover:text-blue-800 shrink-0"
        >
          Fix
        </button>
      )}
    </div>
  )
}
