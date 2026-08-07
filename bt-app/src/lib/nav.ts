import type { LucideIcon } from 'lucide-react'
import {
  Home, Package, PackagePlus, Navigation,
  LayoutDashboard, Map, Truck, Users, Gavel, Route, TrendingUp, Fuel, Settings,
} from 'lucide-react'
import type { Capability } from './types'

/**
 * A surface is shown when the viewer HAS its capability — never when they hold some
 * role string (D-27/D-36). 'always' is for the surfaces every human gets: the Home
 * feed and Settings (one identity, D-4).
 */
export type NavGate = Capability | 'always'

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  /** The capability that reveals this item. */
  gate: NavGate
  /**
   * True while the destination is a "coming soon" placeholder rather than a built
   * surface. bt-app is Phase 1: the operate+carry surfaces (forked from the fleet
   * console) are real; the ship and drive surfaces are grafted in Phases 2–3, so
   * until then their nav item routes to a placeholder that points at the focused
   * shipper/driver app. We show the item (the capability is real) but never pretend
   * the feature is here — and we never HALF-build it.
   */
  placeholder?: boolean
  /** Section break above this item in the rail. */
  startsGroup?: boolean
}

/**
 * The unified rail. Order is capability-first: Home, then the surfaces each
 * capability unlocks, then Settings. The operate + carry block below Home is the
 * forked fleet console, kept in its original order and groupings — a fleet owner
 * (ship · carry · operate, no drive) sees exactly those surfaces working, which is
 * the Phase-1 acceptance bar.
 *
 * `drive` and `ship` items are placeholders in Phase 1 (see NavItem.placeholder).
 * They appear only for a human who actually holds the capability, so a pure fleet
 * owner never sees the drive surface at all, and a pure shipper sees only the ship
 * surfaces plus Home and Settings.
 */
export const NAV: NavItem[] = [
  { href: '/home', label: 'Home', icon: Home, gate: 'always' },

  { href: '/loads', label: 'My Loads',    icon: Package,     gate: 'ship', placeholder: true, startsGroup: true },
  { href: '/post',  label: 'Post a Load', icon: PackagePlus, gate: 'ship', placeholder: true },

  { href: '/my-trips', label: 'My Trips', icon: Navigation, gate: 'drive', placeholder: true, startsGroup: true },

  { href: '/dashboard', label: 'Dashboard',  icon: LayoutDashboard, gate: 'operate', startsGroup: true },
  { href: '/map',       label: 'Live Fleet', icon: Map,             gate: 'operate' },

  { href: '/vehicles',  label: 'Trucks',  icon: Truck, gate: 'operate', startsGroup: true },
  { href: '/drivers',   label: 'Drivers', icon: Users, gate: 'operate' },

  { href: '/auctions',  label: 'Find Work', icon: Gavel, gate: 'carry',   startsGroup: true },
  { href: '/trips',     label: 'Trips',     icon: Route, gate: 'operate' },

  { href: '/analytics', label: 'Utilisation', icon: TrendingUp, gate: 'operate', startsGroup: true },
  { href: '/fuel',      label: 'Fuel',        icon: Fuel,       gate: 'operate' },

  { href: '/settings',  label: 'Settings', icon: Settings, gate: 'always', startsGroup: true },
]

/**
 * The rail for a given capability set. `null` capabilities means "not resolved yet"
 * — show only the always-on items so the shell renders something honest rather than
 * flashing surfaces the human may not have.
 */
export function visibleNav(capabilities: Capability[] | null): NavItem[] {
  return NAV.filter(item =>
    item.gate === 'always' || (capabilities?.includes(item.gate) ?? false),
  )
}

/** Longest-prefix match, so /vehicles/<id> keeps "Trucks" lit. */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}
