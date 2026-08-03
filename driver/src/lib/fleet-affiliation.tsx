'use client'

// ============================================================
// Fleet affiliation — the one signal that decides which product the driver app
// is showing.
//
// A driver employed by a fleet does not self-select work: their owner bids and
// wins the load, then assigns it to them (founder Q14/Q16). So for an
// affiliated driver `/available` is a list of ASSIGNED TRIPS, not a load board,
// and a booking screen must never offer a quote form. For a solo driver every
// one of those surfaces stays the marketplace it has always been.
//
// Held in context and fetched ONCE per session because three separate surfaces
// branch on it (nav labels, the trip list, the booking screen). Fetching it per
// screen would let them disagree mid-navigation — the exact class of bug this
// module exists to close.
// ============================================================

import { createContext, useContext, useEffect, useState } from 'react'
import { getMyFleetAffiliation, getToken } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import type { FleetAffiliation } from '@/lib/types'

// The safe default while the lookup is in flight or has failed: an independent
// operator with the full marketplace. Erring toward `is_employed:false` shows a
// load board to someone who may turn out to be employed — recoverable, and the
// API refuses their bid anyway. Erring the other way hides the marketplace from
// a paying operator, which is the failure this whole module exists to avoid.
const SOLO: FleetAffiliation = {
  is_fleet_affiliated: false,
  is_employed: false,
  owns_vehicles: false,
  owned_vehicle_count: 0,
  fleet_owner_id: null,
  company_name: null,
  fleet_city: null,
  since: null,
}

type AffiliationState = {
  affiliation: FleetAffiliation
  /** False until the first answer lands. Screens must not render a
   *  marketplace/assignment decision before this flips, or an affiliated driver
   *  sees a flash of the bid UI. */
  isReady: boolean
}

const FleetAffiliationContext = createContext<AffiliationState>({
  affiliation: SOLO,
  isReady: false,
})

export function FleetAffiliationProvider({ children }: { children: React.ReactNode }) {
  const { token, isReady: authReady } = useAuth()
  const [state, setState] = useState<AffiliationState>({ affiliation: SOLO, isReady: false })

  useEffect(() => {
    // Read the stored token directly rather than waiting for authReady. auth's
    // own hydration costs a getMe() round-trip, and queueing behind it would put
    // TWO sequential requests between opening the app and knowing which product
    // it is — during which the shell below renders the SOLO default. Starting
    // from localStorage lets this race getMe() instead of following it.
    const stored = token ?? getToken()
    if (!stored) {
      // No token yet. Only conclude "solo" once auth has settled — before that,
      // a missing token may just mean AuthProvider has not hydrated.
      if (authReady) setState({ affiliation: SOLO, isReady: true })
      return
    }

    let cancelled = false
    getMyFleetAffiliation()
      .then(a => { if (!cancelled) setState({ affiliation: a, isReady: true }) })
      // A failed lookup falls back to SOLO, which is the safe direction: the
      // server is the enforcement point either way (bt-booking-service scopes an
      // affiliated driver's reads to their own assignments and refuses their
      // bids with 403), so the worst case is a bid form that cannot submit —
      // never an affiliated driver locked out of a trip they are on.
      .catch(() => { if (!cancelled) setState({ affiliation: SOLO, isReady: true }) })
    return () => { cancelled = true }
  }, [authReady, token])

  return (
    <FleetAffiliationContext.Provider value={state}>
      {children}
    </FleetAffiliationContext.Provider>
  )
}

export function useFleetAffiliation(): AffiliationState {
  return useContext(FleetAffiliationContext)
}
