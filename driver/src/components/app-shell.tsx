'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth'
import { listMyFleetInvites, getOnboardingStatus } from '@/lib/api'
import { useFleetAffiliation } from '@/lib/fleet-affiliation'

// Two products share this shell. A SOLO driver browses a marketplace and tracks
// the quotes they placed. A FLEET driver never bids — their owner wins loads and
// assigns them (founder Q14) — so /available is their assigned trips and
// /my-quotes can only ever be empty for them. Showing a driver a "My Quotes" tab
// they can never fill, next to a "Browse" tab that is really their job list, is
// what made a trip they were already driving look like a load to bid on.
type NavItem = {
  href: string
  label: string
  icon: React.ReactNode
  /** Badged items show the pending-invite count. */
  badged?: boolean
  /** Dotted items show a bare attention dot — no count to report, just "look here". */
  dotted?: boolean
}

const BROWSE_ITEM: NavItem = {
  href: '/available',
  label: 'Browse',
  icon: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  ),
}

const TRIPS_ITEM: NavItem = {
  href: '/available',
  label: 'My Trips',
  icon: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1" />
    </svg>
  ),
}

const QUOTES_ITEM: NavItem = {
  href: '/my-quotes',
  label: 'My Quotes',
  icon: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  ),
}

const TAIL_ITEMS: NavItem[] = [
  {
    href: '/invites',
    label: 'Invites',
    // Badged: an invitation is dead until the driver acts on it, so it has to be
    // visible from anywhere in the shell rather than only on its own tab.
    badged: true,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    href: '/profile',
    label: 'Profile',
    // Dotted: the onboarding checklist lives behind this tab, and a driver with
    // no bank account can run a whole trip and then not get paid. Without a
    // pointer here, nothing in the app ever tells them to look.
    dotted: true,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const { token, isReady, logout } = useAuth()
  const { affiliation, isReady: affiliationReady } = useFleetAffiliation()
  const router = useRouter()
  const pathname = usePathname()
  const [inviteCount, setInviteCount] = useState(0)
  const [onboardingIncomplete, setOnboardingIncomplete] = useState(false)

  const navItems = affiliation.is_fleet_affiliated
    ? [TRIPS_ITEM, ...TAIL_ITEMS]
    : [BROWSE_ITEM, QUOTES_ITEM, ...TAIL_ITEMS]

  useEffect(() => {
    if (isReady && !token) {
      router.replace('/login')
    }
  }, [isReady, token, router])

  // Re-read on navigation so the badge clears as soon as the driver responds,
  // without a store or a polling timer. The endpoint returns pending rows only,
  // and a solo driver simply gets []. Failures stay silent — a nav badge is not
  // worth a toast, and drivers with no fleet involvement would see it forever.
  useEffect(() => {
    if (!isReady || !token) return
    let cancelled = false
    listMyFleetInvites()
      .then(list => { if (!cancelled) setInviteCount(list.length) })
      .catch(() => { if (!cancelled) setInviteCount(0) })
    return () => { cancelled = true }
  }, [isReady, token, pathname])

  // Onboarding state, on the same re-read-on-navigation footing as invites, so
  // the dot clears the moment the driver finishes the last step. Only the steps
  // the driver can act on count — license_verified/vehicle_verified are ops
  // outcomes, and dotting the tab for those would leave a permanent nag on a
  // driver who has already done everything asked of them.
  //
  // Failures leave it false: a nag that cannot be cleared is worse than a
  // missing one, and Profile stays one tap away regardless.
  useEffect(() => {
    if (!isReady || !token) return
    let cancelled = false
    getOnboardingStatus()
      .then(({ checklist: c }) => {
        if (cancelled) return
        setOnboardingIncomplete(
          !c.profile_complete || !c.vehicle_registered || !c.license_submitted || !c.insurance_uploaded || !c.bank_linked,
        )
      })
      .catch(() => { if (!cancelled) setOnboardingIncomplete(false) })
    return () => { cancelled = true }
  }, [isReady, token, pathname])

  // Hold the shell until affiliation is known as well as auth. The default is
  // SOLO, so rendering early would flash the marketplace — "Browse", "My Quotes",
  // "Available Loads" — at a fleet driver on every page load, which is the exact
  // wrong-persona UI this whole change exists to remove. The lookup races
  // getMe() (see FleetAffiliationProvider), so this waits on the slower of two
  // parallel requests rather than adding one.
  if (!isReady || !affiliationReady) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          {/* Brand pulse loader */}
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-primary to-amber-400 animate-pulse opacity-40" />
            <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-tr from-primary to-amber-400 flex items-center justify-center shadow-lg">
              <span className="text-white font-black text-xl">BT</span>
            </div>
          </div>
          <div className="flex gap-1.5">
            {[0,1,2].map(i => (
              <div
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-primary"
                style={{ animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }}
              />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!token) return null

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      {/* Header */}
      {/* Full-bleed: list pages use the whole window and add columns as it gets
          wider. Reading/form pages (booking detail, profile) set their own
          narrow max-width, since long lines are hard to scan. */}
      <header className="sticky top-0 z-30 bg-card/90 backdrop-blur-xl border-b border-border/50 shadow-sm">
        <div className="flex h-14 w-full items-center justify-between px-4">
        <div className="flex items-center gap-2.5">
          {/* Logo */}
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-primary via-orange-500 to-amber-400 flex items-center justify-center shadow-md shadow-primary/30 animate-glow-pulse">
            <span className="text-white font-black text-sm tracking-tight">BT</span>
          </div>
          <div>
            <h1 className="font-extrabold text-base tracking-tight leading-none text-foreground">
              BharatTruck
            </h1>
            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-widest mt-0.5">Driver</p>
          </div>
        </div>

        {/* Online status indicator */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">Online</span>
          </div>
          <button
            onClick={() => { logout(); router.replace('/login') }}
            className="text-xs font-semibold text-muted-foreground hover:text-red-500 transition-colors px-2.5 py-1.5 rounded-lg hover:bg-red-500/10 active:scale-95"
          >
            Logout
          </button>
        </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto pb-28">
        <div className="w-full px-1">
          {children}
        </div>
      </main>

      {/* Bottom Navigation — glassmorphism floating pill */}
      <nav className="fixed bottom-4 left-4 right-4 z-30 mx-auto max-w-md bg-card/85 backdrop-blur-2xl border border-border/50 rounded-2xl shadow-2xl shadow-black/15 overflow-hidden">
        {/* Subtle gradient highlight at top */}
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
        <div className="flex px-3 py-1">
          {navItems.map(item => {
            const isActive = item.href === '/profile'
              ? pathname === '/profile'
              : pathname === item.href
                || pathname.startsWith(item.href + '/')
                || (item.href === '/available' && pathname.startsWith('/bookings/'))
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-1 flex flex-col items-center py-2.5 pt-3 transition-all duration-200 relative ${
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {/* Active indicator dot */}
                {isActive && (
                  <span className="absolute top-1 w-1 h-1 rounded-full bg-primary nav-active-glow" />
                )}
                {/* Icon container */}
                <div className={`relative p-1.5 rounded-xl transition-all duration-200 ${
                  isActive
                    ? 'bg-primary/12 scale-110 nav-active-glow'
                    : 'hover:bg-secondary'
                }`}>
                  {item.icon}
                  {item.dotted && onboardingIncomplete && (
                    <span
                      aria-label="Verification incomplete"
                      className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-500 border-2 border-card"
                    />
                  )}
                  {item.badged && inviteCount > 0 && (
                    <span
                      aria-label={`${inviteCount} pending invitation${inviteCount !== 1 ? 's' : ''}`}
                      className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 border-2 border-card flex items-center justify-center text-[9px] font-black text-white leading-none"
                    >
                      {inviteCount > 9 ? '9+' : inviteCount}
                    </span>
                  )}
                </div>
                <span className={`text-[9.5px] mt-1 font-bold tracking-wider uppercase transition-all ${
                  isActive ? 'text-primary' : ''
                }`}>
                  {item.label}
                </span>
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
