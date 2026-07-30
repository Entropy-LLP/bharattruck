'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth'

const NAV_ITEMS = [
  {
    href: '/available',
    label: 'Browse',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    ),
  },
  {
    href: '/my-quotes',
    label: 'My Quotes',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
  },
  {
    href: '/profile',
    label: 'Profile',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const { token, isReady, logout } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (isReady && !token) {
      router.replace('/login')
    }
  }, [isReady, token, router])

  if (!isReady) {
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
          {NAV_ITEMS.map(item => {
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
                <div className={`p-1.5 rounded-xl transition-all duration-200 ${
                  isActive
                    ? 'bg-primary/12 scale-110 nav-active-glow'
                    : 'hover:bg-secondary'
                }`}>
                  {item.icon}
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
