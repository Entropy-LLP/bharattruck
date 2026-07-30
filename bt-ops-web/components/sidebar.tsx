'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, MapPin, ChevronRight, Zap, type LucideIcon
} from 'lucide-react'

interface NavItem {
  href: string
  icon: LucideIcon
  label: string
  badge?: string
}

// Ops console only. Only real, built pages are surfaced. KYC review (backend
// KYC is 501-stubbed — W5), Users, and Disputes are deferred to their own
// slices and intentionally not linked until they're real. The fleet-owner
// portal is a separate persona/slice (not part of the ops console).
const OPS_NAV: NavItem[] = [
  { href: '/ops/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/ops/trips',     icon: MapPin,         label: 'Live Trips' },
]

export function Sidebar() {
  const pathname = usePathname()
  const nav = OPS_NAV
  const sectionLabel = 'OPERATIONS'

  return (
    <aside className="w-64 shrink-0 flex flex-col h-screen relative dark:bg-[#0E1117] bg-white dark:border-[#1E2535] border-[#E2E8F0] border-r overflow-hidden">
      {/* Subtle vertical gradient line at right edge */}
      <div className="absolute right-0 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-[#FF7A00]/20 to-transparent" />

      {/* Background decoration */}
      <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full opacity-5 dark:block hidden"
        style={{ background: 'radial-gradient(circle, #FF7A00, transparent)' }} />

      {/* Logo */}
      <div className="px-5 py-5 flex items-center gap-3 dark:border-[#1E2535] border-[#E2E8F0] border-b">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 animate-glow-pulse shadow-accent"
          style={{ background: 'linear-gradient(135deg, #FF7A00 0%, #FFB347 100%)' }}
        >
          <Zap size={16} className="text-white drop-shadow-sm" fill="white" />
        </div>
        <div>
          <p className="font-bold text-sm dark:text-white text-[#0F172A] leading-none tracking-tight">BharatTruck</p>
          <p className="text-[9px] dark:text-[#8892A4] text-[#64748B] mt-0.5 leading-none font-semibold uppercase tracking-[0.12em]">
            Ops Console
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        <p className="text-[9px] font-black dark:text-[#434D5E] text-[#A1A1AA] tracking-[0.18em] uppercase px-3 py-2.5">
          {sectionLabel}
        </p>
        {nav.map(({ href, icon: Icon, label, badge }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link key={href} href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 group relative
                ${active
                  ? 'dark:bg-[#FF7A00]/10 bg-[#FF7A00]/8 dark:text-[#FF7A00] text-[#EA6E00] nav-active-glow'
                  : 'dark:text-[#8892A4] dark:hover:text-white dark:hover:bg-[#161B25] text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9]'
                }`}
            >
              {/* Active left border */}
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full bg-[#FF7A00]" />
              )}

              <div className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                active
                  ? 'bg-[#FF7A00]/15'
                  : 'dark:bg-[#161B25] bg-[#F1F5F9] group-hover:bg-[#FF7A00]/8'
              }`}>
                <Icon size={15} className={active ? 'text-[#FF7A00]' : 'opacity-70'} />
              </div>

              <span className="flex-1">{label}</span>
              {badge && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-black
                  ${active
                    ? 'bg-[#FF7A00]/20 text-[#FF7A00]'
                    : 'dark:bg-[#1E2535] dark:text-[#8892A4] bg-[#E2E8F0] text-[#64748B]'
                  }`}>
                  {badge}
                </span>
              )}
              {active && <ChevronRight size={12} className="text-[#FF7A00] opacity-60" />}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 dark:border-[#1E2535] border-[#E2E8F0] border-t">
        <div className="flex items-center gap-3 p-2.5 rounded-xl dark:bg-[#161B25] bg-[#F8FAFC] border dark:border-[#1E2535] border-[#E2E8F0] group cursor-pointer hover:dark:bg-[#1E2535] hover:bg-[#F1F5F9] transition-colors">
          {/* Avatar with gradient */}
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-black shadow-sm shrink-0"
            style={{ background: 'linear-gradient(135deg, #FF7A00, #FFB347)' }}
          >
            A
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold dark:text-white text-[#0F172A] truncate leading-none">Admin User</p>
            <p className="text-[10px] dark:text-[#8892A4] text-[#64748B] mt-0.5 font-medium">Ops Team</p>
          </div>
          {/* Online dot */}
          <div className="relative w-2 h-2 rounded-full bg-emerald-500 shrink-0">
            <div className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-60" />
          </div>
        </div>
      </div>
    </aside>
  )
}
