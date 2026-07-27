import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard, Map, Truck, Users, Gavel, Route, TrendingUp, Fuel, Settings,
} from 'lucide-react'

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  /** Section break above this item in the rail. */
  startsGroup?: boolean
}

/**
 * The rail. Order is deliberate — it follows the owner's daily loop:
 * "where are my trucks" -> "what do I own" -> "who drives" -> "what work is
 * there" -> "did it pay".
 */
export const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/map',       label: 'Live Map',  icon: Map },

  { href: '/vehicles',  label: 'Trucks',    icon: Truck, startsGroup: true },
  { href: '/drivers',   label: 'Drivers',   icon: Users },

  { href: '/auctions',  label: 'Auctions',  icon: Gavel, startsGroup: true },
  { href: '/trips',     label: 'Trips',     icon: Route },

  { href: '/analytics', label: 'Utilisation', icon: TrendingUp, startsGroup: true },
  { href: '/fuel',      label: 'Fuel',        icon: Fuel },

  { href: '/settings',  label: 'Settings',  icon: Settings, startsGroup: true },
]

/** Longest-prefix match, so /vehicles/<id> keeps "Trucks" lit. */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}
