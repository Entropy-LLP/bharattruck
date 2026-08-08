'use client'

/**
 * Emergence CTA — the growth-loop nudge (D-32/D-33 §3.5). When a fact about the user's
 * assets implies an un-taken next step, surface ONE contextual prompt: the app taking the
 * shape of the business, not a settings screen. Derived from the persona snapshot
 * (/auth/me), never chosen. Dismissible (D-21: a preference may SUPPRESS a surface, never
 * gate one) — a dismissed nudge stays gone, and the underlying capability is untouched.
 *
 * The primary moment: an owner-driver who RUNS trucks (`operate`) but has not set up fleet
 * management (no `fleet_owner_id`). The CTA PERFORMS the transition — POST /fleet-owners/me —
 * which, with the fleet-service de-role (feat/derole-fleet-service), is what opens the fleet
 * surfaces to them. It never links to a page that would 403; it makes the fact true first,
 * then routes.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowRight, X } from 'lucide-react'

import { ApiError, becomeFleetOwner } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import type { PersonaSnapshot } from '@/lib/types'

type Prompt = {
  kind: string
  title: string
  body: string
  cta: string
  action: 'become_fleet_owner' | 'navigate'
  href?: string
}

function dismissKey(kind: string): string { return `bt-app-emergence-dismissed:${kind}` }

function isDismissed(kind: string): boolean {
  if (typeof window === 'undefined') return false
  try { return window.localStorage.getItem(dismissKey(kind)) === '1' } catch { return false }
}

// The single most relevant emergence prompt for the current assets, or null. Order is
// priority: the fleet-management setup gates the driver-invite step, so it wins first.
function computePrompt(p: PersonaSnapshot): Prompt | null {
  const caps = p.capabilities ?? []

  // 1) Runs trucks but hasn't set up fleet management → become a fleet owner. This is what
  //    opens the (de-roled) fleet surfaces; without a fleet_owner profile they still 404.
  if (caps.includes('operate') && !p.fleet_owner_id) {
    return {
      kind: 'setup_fleet',
      title: `You run ${p.owned_vehicle_count} trucks`,
      body: 'Set up fleet management to invite drivers and assign them to your trucks.',
      cta: 'Set up fleet management',
      action: 'become_fleet_owner',
    }
  }

  // 2) Has a fleet but no drivers yet → invite the first one (the surface now works).
  if (p.fleet_owner_id && p.held_driver_count === 0 && p.owned_vehicle_count >= 1) {
    return {
      kind: 'invite_driver',
      title: "You're managing a fleet",
      body: 'Invite your first driver to start assigning trucks to trips.',
      cta: 'Invite a driver',
      action: 'navigate',
      href: '/drivers',
    }
  }

  return null
}

export default function EmergenceCta() {
  const { personas, refresh } = useAuth()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [, bumpDismissed] = useState(0)

  function dismiss(kind: string) {
    try { window.localStorage.setItem(dismissKey(kind), '1') } catch { /* storage may be unavailable */ }
    bumpDismissed((n) => n + 1)
  }

  async function act(p: Prompt) {
    if (p.action === 'navigate') { router.push(p.href ?? '/home'); return }
    // become_fleet_owner: make the fact true, refresh the snapshot so the shell + this CTA
    // re-evaluate (fleet_owner_id now set), then route into the newly-open fleet surface.
    setBusy(true)
    try {
      await becomeFleetOwner()
      await refresh()
      toast.success('Fleet management is set up — invite drivers to assign your trucks')
      router.push('/drivers')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not set up fleet management')
      setBusy(false)
    }
  }

  if (!personas) return null
  const prompt = computePrompt(personas)
  if (!prompt || isDismissed(prompt.kind)) return null

  return (
    <div className="mb-4 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{prompt.title}</p>
          <p className="text-xs text-gray-600 mt-0.5">{prompt.body}</p>
        </div>
        <button onClick={() => dismiss(prompt.kind)} aria-label="Dismiss" className="shrink-0 text-gray-400 hover:text-gray-600">
          <X className="w-4 h-4" />
        </button>
      </div>
      <button
        onClick={() => act(prompt)}
        disabled={busy}
        className="mt-3 inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50 transition-colors"
      >
        {busy && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
        {prompt.cta}
        {!busy && <ArrowRight className="w-4 h-4" />}
      </button>
    </div>
  )
}
