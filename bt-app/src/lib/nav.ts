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
   * surface. As of Phase 3 every navigable surface is real — the operate+carry
   * surfaces (forked from the fleet console), the ship surfaces (Post a Load, My
   * Loads, load detail — Phase 2) and the drive surfaces (My Trips, Navigate, POD —
   * Phase 3) — so nothing sets this today. Kept on the type so a future
   * not-yet-grafted surface can still be shown honestly (capability real, feature
   * not here) without half-building it.
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
 * The `ship` items (Phase 2) and the `drive` item (/my-trips — Phase 3) are all live.
 * They appear only for a human who actually holds the capability, so a pure fleet owner
 * never sees the drive surface at all, and a pure shipper sees the working ship surfaces
 * plus Home and Settings.
 */
export const NAV: NavItem[] = [
  { href: '/home', label: 'Home', icon: Home, gate: 'always' },

  { href: '/loads', label: 'My Loads',    icon: Package,     gate: 'ship', startsGroup: true },
  { href: '/post',  label: 'Post a Load', icon: PackagePlus, gate: 'ship' },

  { href: '/my-trips', label: 'My Trips', icon: Navigation, gate: 'drive', startsGroup: true },

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
 *
 * `hasFleetProfile` is the ONE bootstrap exception (D-32 front door): a fleet owner who
 * has created their fleet profile sees the fleet console — Trucks, Drivers, the boards —
 * even before they own a single truck, because that console is the ONLY place they can
 * add their first truck. Without this a declared fleet owner is stranded: `carry`/`operate`
 * need assets, but the surface that adds those assets was itself asset-gated. The
 * fleet-service reads are profile-authorized (de-roled, #109/#117), so these pages return
 * an empty console, never a 403. Once the first truck lands, the real capabilities take
 * over and this exception is a no-op.
 */
export function visibleNav(
  capabilities: Capability[] | null,
  opts?: { hasFleetProfile?: boolean },
): NavItem[] {
  const bootstrapFleet = opts?.hasFleetProfile ?? false
  return NAV.filter(item => {
    if (item.gate === 'always') return true
    if (bootstrapFleet && (item.gate === 'carry' || item.gate === 'operate')) return true
    return capabilities?.includes(item.gate) ?? false
  })
}

/** Longest-prefix match, so /vehicles/<id> keeps "Trucks" lit. */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}
