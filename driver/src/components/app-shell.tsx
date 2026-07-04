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
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    ),
  },
  {
    href: '/my-quotes',
    label: 'My Quotes',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
  },
  {
    href: '/profile',
    label: 'Profile',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!token) return null

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-gray-200 px-4 h-14 flex items-center justify-between">
        <h1 className="font-bold text-lg text-gray-900">BharatTruck</h1>
        <button
          onClick={() => { logout(); router.replace('/login') }}
          className="text-sm text-gray-500 hover:text-red-600 transition-colors px-3 py-1.5"
        >
          Logout
        </button>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto pb-20">
        {children}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200">
        <div className="flex">
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
                className={`flex-1 flex flex-col items-center py-2 pt-3 min-h-[56px] transition-colors ${
                  isActive ? 'text-blue-600' : 'text-gray-400'
                }`}
              >
                {item.icon}
                <span className="text-xs mt-0.5 font-medium">{item.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
