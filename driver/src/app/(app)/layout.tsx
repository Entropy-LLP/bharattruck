'use client'

import { AppShell } from '@/components/app-shell'
import { FleetAffiliationProvider } from '@/lib/fleet-affiliation'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // Affiliation wraps the shell because the nav labels branch on it too — a
  // fleet driver's tabs read "My Trips", not "Browse"/"My Quotes".
  return (
    <FleetAffiliationProvider>
      <AppShell>{children}</AppShell>
    </FleetAffiliationProvider>
  )
}
