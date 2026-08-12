'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function Navbar() {
  const pathname = usePathname()

  const isActive = (path: string) =>
    pathname === path || (path !== '/bookings/new' && pathname.startsWith(path + '/'))

  return (
    <nav
      className="sticky top-0 z-50 border-b"
      style={{
        background: 'rgba(6, 12, 27, 0.88)',
        backdropFilter: 'blur(24px) saturate(180%)',
        borderColor: 'rgba(255,255,255,0.07)',
      }}
    >
      {/* Top accent line */}
      <div
        className="absolute top-0 inset-x-0 h-px"
        style={{ background: 'linear-gradient(90deg, transparent, #2563EB 30%, #818CF8 60%, #F59E0B 80%, transparent)' }}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo + Nav */}
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="flex items-center gap-2.5 group">
              {/* Animated gradient logo */}
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg transition-transform duration-200 group-hover:scale-105"
                style={{
                  background: 'linear-gradient(135deg, #1D4ED8 0%, #7C3AED 50%, #F59E0B 100%)',
                  boxShadow: '0 0 16px rgba(37,99,235,0.4)',
                }}
              >
                <span className="text-white font-black text-sm tracking-tight">BT</span>
              </div>
              <div>
                <span className="font-black text-lg tracking-tight text-white group-hover:opacity-90 transition-opacity leading-none block">
                  BharatTruck
                </span>
                <span className="text-[9px] font-black text-white/25 tracking-[0.2em] uppercase block mt-0.5">
                  Shipper Portal
                </span>
              </div>
            </Link>

            {/* Nav links */}
            <div className="hidden sm:flex items-center gap-1">
              <Link
                href="/dashboard"
                className={`relative px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                  isActive('/dashboard')
                    ? 'text-blue-400'
                    : 'text-white/40 hover:text-white hover:bg-card/5'
                }`}
              >
                {isActive('/dashboard') && (
                  <span className="absolute inset-0 rounded-xl bg-blue-600/12 border border-blue-500/20" />
                )}
                <span className="relative">My Bookings</span>
              </Link>
              <Link
                href="/bookings/new"
                className={`relative px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                  pathname === '/bookings/new'
                    ? 'text-blue-400'
                    : 'text-white/40 hover:text-white hover:bg-card/5'
                }`}
              >
                {pathname === '/bookings/new' && (
                  <span className="absolute inset-0 rounded-xl bg-blue-600/12 border border-blue-500/20" />
                )}
                <span className="relative">New Booking</span>
              </Link>
              <Link
                href="/settings"
                className={`relative px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                  isActive('/settings')
                    ? 'text-blue-400'
                    : 'text-white/40 hover:text-white hover:bg-card/5'
                }`}
              >
                {isActive('/settings') && (
                  <span className="absolute inset-0 rounded-xl bg-blue-600/12 border border-blue-500/20" />
                )}
                <span className="relative">Settings</span>
              </Link>
            </div>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-3">
            {/* New booking CTA (mobile) */}
            <Link
              href="/bookings/new"
              className="sm:hidden flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-all"
              style={{ background: 'linear-gradient(135deg, #2563EB, #4F46E5)' }}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              New
            </Link>

            {/* Avatar */}
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-black shadow-lg"
              style={{
                background: 'linear-gradient(135deg, #2563EB 0%, #7C3AED 100%)',
                boxShadow: '0 0 12px rgba(124,58,237,0.35)',
              }}
            >
              S
            </div>

            {/* Logout */}
            <Link
              href="/login"
              className="text-xs font-semibold text-white/25 hover:text-red-400 transition-colors px-2.5 py-2 rounded-lg hover:bg-red-500/10"
            >
              Logout
            </Link>
          </div>
        </div>
      </div>
    </nav>
  )
}
