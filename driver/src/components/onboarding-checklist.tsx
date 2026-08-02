'use client'

// ============================================================
// The way INTO the onboarding wizard.
//
// /onboarding/* has six working screens — personal, vehicle, license,
// insurance, bank-account, review — that chain correctly to each other and to
// the real bt-auth-service endpoints. Nothing in the app linked to any of them.
// The whole flow was reachable only by typing the URL, so in practice no driver
// ever completed it, and the one step that matters most for the money —
// bank-account — was unreachable. That is what blocks the payout path.
//
// This is the entry point. It lives on Profile because Profile is in the bottom
// nav, so it is one tap from anywhere in the app.
//
// Deliberately a CHECKLIST rather than a "start onboarding" button: the steps
// are independent, drivers arrive with different pieces already done, and a
// linear restart would make someone who only needs a bank account walk through
// four screens they already filled in.
// ============================================================

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getOnboardingStatus } from '@/lib/api'
import { useFleetAffiliation } from '@/lib/fleet-affiliation'
import type { OnboardingChecklist } from '@/lib/types'
import Spinner from '@/components/spinner'

type Step = {
  key: keyof OnboardingChecklist
  href: string
  label: string
  hint: string
}

// Only the steps a driver can ACT on. `license_verified` and `vehicle_verified`
// are ops/Surepass outcomes — showing them as unticked boxes next to ones the
// driver can tick would read as "you still have work to do" when the work is
// ours. The badge on the card header carries verification state instead.
const STEPS: Step[] = [
  { key: 'profile_complete',   href: '/onboarding/personal',     label: 'Personal details',  hint: 'Name, phone and address' },
  { key: 'vehicle_registered', href: '/onboarding/vehicle',      label: 'Vehicle',           hint: 'Registration and truck type' },
  { key: 'license_submitted',  href: '/onboarding/license',      label: 'Driving licence',   hint: 'Licence number and expiry' },
  { key: 'insurance_uploaded', href: '/onboarding/insurance',    label: 'Insurance',         hint: 'Policy cover for your vehicle' },
  { key: 'bank_linked',        href: '/onboarding/bank-account', label: 'Bank account',      hint: 'Where your trip payments land' },
]

function StepIcon({ done }: { done: boolean }) {
  if (done) {
    return (
      <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      </div>
    )
  }
  return <div className="w-5 h-5 rounded-full border-2 border-border shrink-0" />
}

export default function OnboardingChecklistCard() {
  const { affiliation } = useFleetAffiliation()
  const [checklist, setChecklist] = useState<OnboardingChecklist | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getOnboardingStatus()
      .then(s => { if (!cancelled) setChecklist(s.checklist) })
      .catch(() => { /* leave null — the card renders its links regardless */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // A fleet driver is paid by their owner, not by the platform — the payout
  // resolves to fleet_owner_id (payment-service resolvePayee, founder Q15). So
  // a missing bank account does not block THEIR money, and telling them it does
  // would be a false alarm. The step still shows, because a driver who later
  // leaves the fleet needs it, but it is not flagged as urgent.
  const bankBlocksPay = !affiliation.is_fleet_affiliated

  const done = (k: keyof OnboardingChecklist) => checklist?.[k] === true
  const completed = STEPS.filter(s => done(s.key)).length
  const allDone = checklist !== null && completed === STEPS.length
  const payoutBlocked = bankBlocksPay && checklist !== null && !done('bank_linked')

  return (
    <section
      aria-label="Verification and payout setup"
      className="bg-card rounded-2xl border border-border/60 shadow-sm p-5"
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-foreground leading-none">Verification &amp; Payout</h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {loading ? 'Checking your documents…' : `${completed} of ${STEPS.length} complete`}
            </p>
          </div>
        </div>
        {!loading && (
          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider shrink-0 ${
            allDone
              ? 'bg-emerald-500/12 border border-emerald-500/25 text-emerald-600 dark:text-emerald-400'
              : 'bg-amber-500/12 border border-amber-500/25 text-amber-600 dark:text-amber-400'
          }`}>
            {allDone ? 'Complete' : 'Action needed'}
          </span>
        )}
      </div>

      {/* The money callout. A driver with no bank account can finish a trip and
          still not get paid, and nothing else in the app says so. */}
      {payoutBlocked && (
        <div className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-3">
          <p className="text-xs font-bold text-amber-700 dark:text-amber-400">Add a bank account to get paid</p>
          <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 mt-0.5 leading-snug">
            You can accept and run trips without one, but your payment has nowhere to land until it is added.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : (
        <ul className="flex flex-col gap-1">
          {STEPS.map(step => {
            const isDone = done(step.key)
            return (
              <li key={step.key}>
                <Link
                  href={step.href}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 -mx-1 transition-colors hover:bg-secondary/60 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <StepIcon done={isDone} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-bold leading-none ${isDone ? 'text-muted-foreground' : 'text-foreground'}`}>
                      {step.label}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1 leading-tight truncate">{step.hint}</p>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary shrink-0">
                    {isDone ? 'Edit' : 'Add'}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {!loading && (
        <Link
          href="/onboarding/review"
          className="mt-3 block text-center text-xs font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg py-2"
        >
          Review all documents
        </Link>
      )}
    </section>
  )
}
