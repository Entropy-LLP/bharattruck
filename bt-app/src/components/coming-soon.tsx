'use client'

// A placeholder for a capability the human HAS but whose surface bt-app has not
// grafted yet (UNIFIED_APP_PLAN Phase 1 ships the operate+carry half; the ship and
// drive surfaces arrive in Phases 2–3). The rule the whole app lives by: show the
// item because the capability is real, but never pretend the feature is here and
// never half-build it. Until the surface lands, point the human at the focused app
// that already does this job. When the real surface ships, this route is replaced.

import Link from 'next/link'
import { ArrowUpRight, Hammer } from 'lucide-react'

import { PageHeader } from '@/components/app-shell'
import { Card } from '@/components/stat'

export function ComingSoon({
  title,
  subtitle,
  focusedApp,
}: {
  title: string
  subtitle: string
  /** The focused app that already does this job today, e.g. { label: 'shipper app', href: '…' }. */
  focusedApp?: { label: string; href: string }
}) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <Card className="max-w-xl">
        <div className="flex items-start gap-4 p-2">
          <div className="mt-0.5 rounded-lg bg-gray-100 p-2 text-gray-500">
            <Hammer size={20} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900">Coming soon in this app</p>
            <p className="mt-1 text-sm text-gray-500">
              You can do this — your account has the capability — but this surface is being
              built here. Until it lands, use the focused app for it.
            </p>
            {focusedApp && (
              <Link
                href={focusedApp.href}
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
              >
                Open the {focusedApp.label}
                <ArrowUpRight size={15} />
              </Link>
            )}
          </div>
        </div>
      </Card>
    </>
  )
}
