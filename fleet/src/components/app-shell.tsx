'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { PanelLeftClose, PanelLeftOpen, LogOut, Building2, Menu, X } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { NAV, isActive } from '@/lib/nav'
import { getMyFleet } from '@/lib/api'
import type { FleetOwner } from '@/lib/types'

const RAIL_KEY = 'bt_fleet_rail_collapsed'

/**
 * Desktop-first shell: a persistent left rail plus a content column.
 *
 * Unlike driver/ (mobile PWA, fixed bottom nav) and shipper/ (sticky top bar),
 * a fleet owner works at a desk across many trucks at once, so navigation is a
 * rail that stays put and the content column is what scrolls. The rail collapses
 * to icons for map-heavy screens; the choice is remembered.
 *
 * The route guard lives here, exactly as it does in driver/src/components/
 * app-shell.tsx — so every page under (app)/ is protected by construction and
 * nothing outside it is.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { token, isReady, logout, user } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [fleet, setFleet] = useState<FleetOwner | null>(null)

  useEffect(() => {
    if (isReady && !token) router.replace('/login')
  }, [isReady, token, router])

  useEffect(() => {
    setCollapsed(localStorage.getItem(RAIL_KEY) === '1')
  }, [])

  useEffect(() => {
    if (!token) return
    getMyFleet().then(setFleet).catch(() => setFleet(null))
  }, [token])

  // Close the mobile drawer on navigation, otherwise it covers the page you
  // just asked for.
  useEffect(() => { setMobileOpen(false) }, [pathname])

  function toggleRail() {
    setCollapsed(prev => {
      localStorage.setItem(RAIL_KEY, prev ? '0' : '1')
      return !prev
    })
  }

  if (!isReady) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (!token) return null

  const railWidth = collapsed ? 'w-16' : 'w-60'

  const rail = (
    <nav className="flex flex-col h-full bg-white border-r border-gray-200">
      {/* Brand */}
      <div className={`h-14 flex items-center border-b border-gray-200 ${collapsed ? 'justify-center px-0' : 'px-4'}`}>
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
          <Building2 className="w-4.5 h-4.5 text-white" strokeWidth={2.2} />
        </div>
        {!collapsed && (
          <div className="ml-2.5 min-w-0">
            <div className="font-bold text-sm text-gray-900 leading-tight truncate">
              {fleet?.company_name ?? 'BharatTruck'}
            </div>
            <div className="text-[11px] text-gray-400 leading-tight">Fleet console</div>
          </div>
        )}
      </div>

      {/* Links */}
      <div className="flex-1 overflow-y-auto py-3">
        {NAV.map(item => {
          const active = isActive(pathname, item.href)
          const Icon = item.icon
          return (
            <div key={item.href}>
              {item.startsGroup && <div className="my-2 mx-3 border-t border-gray-100" />}
              <Link
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={`mx-2 flex items-center gap-3 rounded-lg text-sm font-medium transition-colors ${
                  collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'
                } ${
                  active
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" strokeWidth={active ? 2.3 : 1.9} />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            </div>
          )
        })}
      </div>

      {/* Footer: who am I, and out */}
      <div className="border-t border-gray-200 p-2">
        {!collapsed && (
          <div className="px-2 pb-2 pt-1 min-w-0">
            <div className="text-xs font-medium text-gray-900 truncate">
              {user?.full_name ?? 'Fleet owner'}
            </div>
            <div className="text-[11px] text-gray-400 truncate">{user?.email ?? ''}</div>
          </div>
        )}
        <button
          onClick={logout}
          title={collapsed ? 'Sign out' : undefined}
          className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors ${
            collapsed ? 'justify-center px-0' : ''
          }`}
        >
          <LogOut className="w-5 h-5 shrink-0" strokeWidth={1.9} />
          {!collapsed && <span>Sign out</span>}
        </button>
        <button
          onClick={toggleRail}
          className={`hidden lg:flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors ${
            collapsed ? 'justify-center px-0' : ''
          }`}
        >
          {collapsed
            ? <PanelLeftOpen className="w-5 h-5 shrink-0" strokeWidth={1.9} />
            : <><PanelLeftClose className="w-5 h-5 shrink-0" strokeWidth={1.9} /><span>Collapse</span></>}
        </button>
      </div>
    </nav>
  )

  return (
    <div className="h-full flex bg-gray-50">
      {/* Desktop rail */}
      <aside className={`hidden lg:block shrink-0 transition-[width] duration-200 ${railWidth}`}>
        {rail}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="w-60 h-full">{rail}</div>
          <button
            aria-label="Close menu"
            className="flex-1 bg-black/30"
            onClick={() => setMobileOpen(false)}
          />
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile top bar — the rail is hidden below lg */}
        <header className="lg:hidden sticky top-0 z-30 bg-white border-b border-gray-200 px-4 h-14 flex items-center justify-between">
          <button onClick={() => setMobileOpen(true)} className="p-1.5 -ml-1.5 text-gray-600">
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <span className="font-bold text-base text-gray-900 truncate">
            {fleet?.company_name ?? 'Fleet console'}
          </span>
          <span className="w-5" />
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}

/** Standard page header. Every screen uses this so titles line up across routes. */
export function PageHeader({
  title, subtitle, actions,
}: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-5">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-gray-900 truncate">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
