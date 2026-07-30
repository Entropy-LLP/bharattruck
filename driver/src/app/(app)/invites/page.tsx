'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { listMyFleetInvites, respondToFleetInvite, ApiError } from '@/lib/api'
import type { FleetInvite } from '@/lib/types'
import { formatPrice, relativeTime } from '@/lib/utils'

/**
 * Fleet invitation inbox — the driver half of the consent gate.
 *
 * An owner can invite, but ONLY the driver can move an invitation off 'pending'
 * (bt-fleet-service refuses an owner PATCH that sets status='active'). Without
 * this screen invitations sit pending forever and no fleet can onboard anyone.
 *
 * Accepting is consequential: the owner then bids on the driver's behalf and is
 * paid instead of them, and the booking service strips every money field from
 * what this driver sees. That is spelled out before the driver commits, and
 * accept is confirmed twice — reject is not, since it is the safe direction.
 */
export default function FleetInvitesPage() {
  const [invites, setInvites] = useState<FleetInvite[]>([])
  const [loading, setLoading] = useState(true)
  /** id of the invite currently in flight — disables just that card's buttons. */
  const [busyId, setBusyId] = useState<string | null>(null)
  /** id awaiting accept confirmation; reject needs none. */
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const router = useRouter()

  const fetchInvites = useCallback(async () => {
    try {
      setInvites(await listMyFleetInvites())
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchInvites() }, [fetchInvites])

  async function handleRespond(invite: FleetInvite, action: 'accept' | 'reject') {
    setBusyId(invite.id)
    const fleet = invite.company_name ?? 'the fleet'
    try {
      await respondToFleetInvite(invite.id, action)
      // Drop it locally rather than refetching — the server only ever returns
      // pending rows, so a responded invite is gone from this list either way.
      setInvites(prev => prev.filter(i => i.id !== invite.id))
      setConfirmingId(null)
      toast.success(
        action === 'accept' ? `You have joined ${fleet}` : `Invitation from ${fleet} declined`,
      )
      if (action === 'accept') router.push('/available')
    } catch (err) {
      // INVALID_TRANSITION means someone already resolved it (the owner
      // withdrew, or a second tab responded). Not a failure — just stale.
      if (err instanceof ApiError && err.code === 'INVALID_TRANSITION') {
        toast.info('That invitation is no longer pending')
        setConfirmingId(null)
        fetchInvites()
        return
      }
      toast.error(err instanceof ApiError ? err.message : 'Could not send your response')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-primary/20 to-amber-400/20 animate-pulse" />
          <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-tr from-primary/10 to-amber-400/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
        </div>
        <p className="text-sm font-medium text-muted-foreground animate-pulse">Loading invitations…</p>
      </div>
    )
  }

  if (invites.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
        <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-muted to-secondary flex items-center justify-center mb-6 animate-float shadow-lg">
          <svg className="w-12 h-12 text-muted-foreground/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h3 className="text-lg font-bold text-foreground mb-1">No invitations</h3>
        <p className="text-sm text-muted-foreground mb-6 max-w-xs">
          When a fleet owner invites you to drive for them, it will appear here for you to accept or decline.
        </p>
        <button
          onClick={() => router.push('/available')}
          className="px-7 py-3 bg-gradient-to-r from-primary to-orange-500 text-white rounded-xl text-sm font-bold active:scale-95 transition-all shadow-lg shadow-primary/30 hover:-translate-y-0.5"
        >
          Browse Loads
        </button>
      </div>
    )
  }

  return (
    // Constrained, unlike the full-bleed load list: this is a decision surface
    // with short content, and a salary offer stretched across a desktop window
    // reads as an accident. Matches the profile page's reading-width container.
    <div className="px-4 py-5 flex flex-col items-center">
      <div className="w-full max-w-xl space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-extrabold text-foreground tracking-tight">Invitations</h2>
            <span className="px-2 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-black animate-pulse">
              {invites.length}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {invites.length} fleet{invites.length !== 1 ? 's' : ''} waiting on your response
          </p>
        </div>
        <button
          onClick={() => { setLoading(true); fetchInvites() }}
          className="flex items-center gap-1.5 text-xs font-semibold text-primary bg-primary/10 hover:bg-primary/15 px-3 py-1.5 rounded-full transition-all active:scale-95 border border-primary/20"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* What joining a fleet means — shown once, above the list, so the driver
          reads it before looking at any single offer. */}
      <div className="rounded-2xl border border-amber-500/25 bg-amber-500/8 p-4">
        <div className="flex gap-3">
          <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.71-3.03l-6.93-11a2 2 0 00-3.42 0l-6.93 11A2 2 0 005.07 19z" />
          </svg>
          <div className="space-y-1">
            <p className="text-xs font-bold text-foreground">Before you accept</p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Joining a fleet means the owner bids for loads on your behalf and is paid for
              your trips — you will no longer see freight prices or bid yourself. You keep
              your licence, vehicles and account. Declining changes nothing.
            </p>
          </div>
        </div>
      </div>

      {/* Invites */}
      {invites.map(invite => {
        const isBusy = busyId === invite.id
        const isConfirming = confirmingId === invite.id
        const fleetName = invite.company_name ?? 'Unnamed fleet'

        return (
          <div
            key={invite.id}
            className="bg-card rounded-2xl border border-border/60 shadow-sm overflow-hidden"
          >
            <div className="p-4">
              {/* Fleet identity */}
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-primary to-amber-400 flex items-center justify-center shadow-md shadow-primary/25 shrink-0">
                  <span className="text-white font-black text-sm tracking-tight">
                    {fleetName.slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold text-foreground leading-tight truncate">
                    {fleetName}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {invite.fleet_city ?? 'Location not set'} · invited {relativeTime(invite.invited_at)}
                  </p>
                </div>
                <span className="px-2 py-1 rounded-full bg-amber-500/12 border border-amber-500/25 text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider shrink-0">
                  Pending
                </span>
              </div>

              {/* Offer terms */}
              <div className="mt-4 pt-4 border-t border-border/50">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">
                  Monthly salary offered
                </p>
                {invite.monthly_salary_inr != null ? (
                  <p className="text-lg font-black text-foreground leading-none">
                    {formatPrice(invite.monthly_salary_inr)}
                    <span className="text-xs font-semibold text-muted-foreground"> / month</span>
                  </p>
                ) : (
                  <p className="text-sm font-semibold text-muted-foreground leading-none">
                    Not specified — agree this with the owner directly
                  </p>
                )}
              </div>
            </div>

            {/* Actions */}
            {isConfirming ? (
              <div className="border-t border-border/50 bg-secondary/30 p-4 space-y-3">
                <p className="text-xs font-semibold text-foreground">
                  Join {fleetName}? You will stop bidding for your own loads.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmingId(null)}
                    disabled={isBusy}
                    className="flex-1 h-11 rounded-xl border border-border bg-card text-xs font-bold text-foreground transition-all active:scale-95 disabled:opacity-40"
                  >
                    Go back
                  </button>
                  <button
                    onClick={() => handleRespond(invite, 'accept')}
                    disabled={isBusy}
                    className="flex-1 h-11 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/25 transition-all active:scale-95 disabled:opacity-60"
                  >
                    {isBusy ? 'Joining…' : `Yes, join ${fleetName.split(' ')[0]}`}
                  </button>
                </div>
              </div>
            ) : (
              <div className="border-t border-border/50 bg-secondary/20 p-4 flex gap-2">
                <button
                  onClick={() => handleRespond(invite, 'reject')}
                  disabled={isBusy}
                  className="flex-1 h-11 rounded-xl border border-border bg-card text-xs font-bold text-muted-foreground hover:text-red-500 hover:border-red-500/40 transition-all active:scale-95 disabled:opacity-40"
                >
                  {isBusy ? 'Declining…' : 'Decline'}
                </button>
                <button
                  onClick={() => setConfirmingId(invite.id)}
                  disabled={isBusy}
                  className="flex-1 h-11 rounded-xl bg-gradient-to-r from-primary to-orange-500 text-white text-xs font-bold shadow-lg shadow-primary/30 transition-all active:scale-95 hover:-translate-y-0.5 disabled:opacity-60"
                >
                  Accept
                </button>
              </div>
            )}
          </div>
        )
      })}
      </div>
    </div>
  )
}
