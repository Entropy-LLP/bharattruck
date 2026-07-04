'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, ShieldCheck, MapPin, Truck,
  Users, AlertCircle, ChevronRight, Zap
} from 'lucide-react'

const OPS_NAV = [
  { href: '/ops/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/ops/kyc',       icon: ShieldCheck,    label: 'KYC Review',  badge: '12' },
  { href: '/ops/trips',     icon: MapPin,         label: 'Live Trips',  badge: '34' },
  { href: '/ops/users',     icon: Users,          label: 'Users' },
  { href: '/ops/disputes',  icon: AlertCircle,    label: 'Disputes',    badge: '3' },
]

const FLEET_NAV = [
  { href: '/portal/dashboard', icon: LayoutDashboard, label: 'Overview' },
  { href: '/portal/vehicles',  icon: Truck,           label: 'Vehicles' },
  { href: '/portal/drivers',   icon: Users,           label: 'Drivers' },
]

interface SidebarProps { role: 'ops' | 'fleet' }

export function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname()
  const nav = role === 'ops' ? OPS_NAV : FLEET_NAV
  const sectionLabel = role === 'ops' ? 'OPERATIONS' : 'FLEET PORTAL'

  return (
    <aside className="w-60 shrink-0 flex flex-col h-screen
      dark:bg-[#111111] bg-white
      dark:border-[#2A2A2A] border-[#E4E4E7] border-r">

      {/* Logo */}
      <div className="px-5 py-5 flex items-center gap-3 dark:border-[#2A2A2A] border-[#E4E4E7] border-b">
        <div className="w-8 h-8 rounded-lg bg-[#F97316] flex items-center justify-center shrink-0">
          <Zap size={16} className="text-white" fill="white" />
        </div>
        <div>
          <p className="font-bold text-sm dark:text-white text-[#09090B] leading-none">BharatTruck</p>
          <p className="text-[10px] dark:text-[#888] text-[#71717A] mt-0.5 leading-none">
            {role === 'ops' ? 'Ops Console' : 'Fleet Portal'}
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        <p className="text-[10px] font-semibold dark:text-[#555] text-[#A1A1AA] tracking-widest px-3 py-2">
          {sectionLabel}
        </p>
        {nav.map(({ href, icon: Icon, label, badge }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link key={href} href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group
                ${active
                  ? 'bg-[#F97316]/10 text-[#F97316]'
                  : 'dark:text-[#888] dark:hover:text-white dark:hover:bg-[#1A1A1A] text-[#71717A] hover:text-[#09090B] hover:bg-[#F4F4F5]'
                }`}
            >
              <Icon size={16} className={active ? 'text-[#F97316]' : ''} />
              <span className="flex-1">{label}</span>
              {badge && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold
                  ${active
                    ? 'bg-[#F97316]/20 text-[#F97316]'
                    : 'dark:bg-[#2A2A2A] dark:text-[#888] bg-[#E4E4E7] text-[#71717A]'
                  }`}>
                  {badge}
                </span>
              )}
              {active && <ChevronRight size={12} className="text-[#F97316]" />}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 dark:border-[#2A2A2A] border-[#E4E4E7] border-t">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-[#F97316]/20 flex items-center justify-center text-[#F97316] text-xs font-bold">
            A
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium dark:text-white text-[#09090B] truncate">Admin User</p>
            <p className="text-[10px] dark:text-[#888] text-[#71717A]">
              {role === 'ops' ? 'Ops Team' : 'Fleet Owner'}
            </p>
          </div>
        </div>
      </div>
    </aside>
  )
}
