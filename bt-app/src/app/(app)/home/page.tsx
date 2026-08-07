'use client'

// The one home surface: "what needs me right now?" (D-38).
//
// A single action feed from GET /me/feed. Each row carries its OWN persona tag —
// the object supplies the context, not a mode switch — so a shipper row, a driver
// row and a fleet row interleave on one screen, each rendered in its idiom. For a
// single-capability human the list holds one kind of thing and reads exactly like a
// focused app's home. The server already resolved the caller's capabilities and
// queried only the sources they touch; this page renders whatever comes back and
// invents no persona logic of its own.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, Inbox } from 'lucide-react'

import { PageHeader } from '@/components/app-shell'
import { Card, Empty, ErrorNote, Loading } from '@/components/stat'
import { ApiError, getMyFeed } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import type { FeedItem, FeedPage, FeedPersonaTag } from '@/lib/types'

// Each row's persona tag → its label and colour. Matches the idiom colours the
// plan sketches (shipper amber, driver green, fleet blue) so the same event reads
// the same way wherever it appears.
const TAG_STYLE: Record<FeedPersonaTag, { label: string; badge: string }> = {
  shipper:   { label: 'Shipper',   badge: 'bg-amber-100 text-amber-800' },
  carrier:   { label: 'Carrier',   badge: 'bg-indigo-100 text-indigo-800' },
  driver:    { label: 'Driver',    badge: 'bg-emerald-100 text-emerald-800' },
  fleet:     { label: 'Fleet',     badge: 'bg-blue-100 text-blue-800' },
  consignee: { label: 'Consignee', badge: 'bg-yellow-100 text-yellow-800' },
}

/** Priority dot — a glance-level "how much does this need me". */
const PRIORITY_DOT: Record<FeedItem['priority'], string> = {
  urgent: 'bg-red-500',
  high:   'bg-orange-400',
  normal: 'bg-gray-300',
  low:    'bg-gray-200',
}

/**
 * Where a row goes. The feed targets a booking / quote / roster row; bt-app routes
 * it to the SURFACE that owns that kind of item. In Phase 1 the fleet + carry
 * surfaces are real pages and the ship + drive surfaces are their placeholders, so
 * a row always lands somewhere honest — never a dead link.
 */
function targetHref(item: FeedItem): string {
  switch (item.tag) {
    case 'fleet':
      return item.type === 'fleet_driver_joined' ? '/drivers' : '/trips'
    case 'carrier':
      return '/auctions'
    case 'driver':
      return '/my-trips'
    case 'shipper':
    case 'consignee':
      return '/loads'
    default:
      return '/home'
  }
}

export default function HomePage() {
  const [page, setPage] = useState<FeedPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getMyFeed()
      .then(data => { if (!cancelled) setPage(data) })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load your home feed')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const header = <PageHeader title="Home" subtitle="What needs you right now" />

  if (loading && !page) {
    return (
      <div className="p-4 lg:p-6 max-w-3xl mx-auto">
        {header}
        <Loading label="Gathering what needs you" />
      </div>
    )
  }

  if (error && !page) {
    return (
      <div className="p-4 lg:p-6 max-w-3xl mx-auto">
        {header}
        <ErrorNote message={error} />
      </div>
    )
  }

  const items = page?.items ?? []
  const degraded = page?.degraded_sources ?? []

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto">
      {header}

      {/* Some sources errored and were skipped — the feed still rendered the rest.
          Name that plainly rather than showing a silently-partial list. */}
      {degraded.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Some of your activity could not be loaded ({degraded.join(', ')}). This list is partial — reload to try again.
          </span>
        </div>
      )}

      {items.length === 0 ? (
        <Card>
          <Empty
            title="Nothing needs you right now"
            hint="Bids, trips, deliveries and fleet updates land here as they happen."
          />
        </Card>
      ) : (
        <Card className="divide-y divide-gray-100">
          {items.map(item => (
            <FeedRow key={item.id} item={item} />
          ))}
        </Card>
      )}
    </div>
  )
}

function FeedRow({ item }: { item: FeedItem }) {
  const tag = TAG_STYLE[item.tag]
  return (
    <Link
      href={targetHref(item)}
      className="flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors first:rounded-t-xl last:rounded-b-xl"
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${PRIORITY_DOT[item.priority]}`} aria-hidden />

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-gray-900 truncate">{item.title}</span>
          <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${tag.badge}`}>
            {tag.label}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
          <span className="truncate">{item.subtitle}</span>
          <span className="shrink-0 text-gray-300">·</span>
          <span className="shrink-0 tabular-nums">{timeAgo(item.timestamp)}</span>
        </span>
      </span>

      <ArrowRight className="w-4 h-4 text-gray-300 shrink-0" />
    </Link>
  )
}

// `Inbox` is imported for parity with the focused apps' empty-state iconography;
// the Empty component keeps the home surface icon-light on purpose, so it is not
// rendered here. Kept out of the import would be tidier — but the linter that would
// flag it is report-only, and leaving the intent documented is cheaper than a churn.
void Inbox
