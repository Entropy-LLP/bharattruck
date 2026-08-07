'use client'

/**
 * My Loads (ship surface — Phase 2 of docs/UNIFIED_APP_PLAN.md).
 *
 * The loads the caller POSTED. GET /bookings returns the caller's own bookings, and
 * each row carries a `viewer` block naming the caller's relations to it — so for a
 * unified human who is BOTH a shipper and a carrier (whose list also includes the
 * open load board they may bid on), this keeps only the ones they actually posted
 * (viewer.relations includes 'shipper'). Falls back to shipper_id on a backend that
 * predates the viewer block.
 *
 * Three states, all rendered — never a blank screen:
 *  - LOADING  → a spinner with a label.
 *  - ERROR    → an ErrorNote with a retry.
 *  - EMPTY    → "No loads yet" with a Post-a-Load call to action.
 *
 * The list endpoint carries no per-load bid count, so rather than block the whole
 * list on an N+1, the rows render immediately from the list response and the bid
 * count for auction loads fills in afterwards as a best-effort enhancement (its
 * failure is swallowed — the row is already complete without it).
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, MapPin, PackagePlus } from 'lucide-react'

import { PageHeader } from '@/components/app-shell'
import { Card, Empty, ErrorNote, Loading } from '@/components/stat'
import { ApiError, getQuotes, listBookings } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { inr, timeAgo } from '@/lib/format'
import { bookingStatusConfig } from '@/lib/status'
import type { Booking } from '@/lib/types'

function postedByCaller(b: Booking, userId: string | null): boolean {
  if (b.viewer) return b.viewer.relations.includes('shipper')
  return userId != null && b.shipper_id === userId
}

export default function LoadsPage() {
  const { user } = useAuth()
  const [loads, setLoads] = useState<Booking[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [bidCounts, setBidCounts] = useState<Record<string, number>>({})
  const [nonce, setNonce] = useState(0)

  const retry = useCallback(() => {
    setLoading(true)
    setError(null)
    setLoads(null)
    setBidCounts({})
    setNonce((n) => n + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    const userId = user?.id ?? null

    listBookings()
      .then((all) => {
        if (cancelled) return
        const mine = all.filter((b) => postedByCaller(b, userId))
        setLoads(mine)

        // Best-effort bid counts for auction loads — a progressive enhancement that
        // must never blank or block the list. Failures are intentionally ignored.
        const auctions = mine.filter((b) => b.booking_type === 'auction')
        if (auctions.length > 0) {
          Promise.allSettled(auctions.map((b) => getQuotes(b.id))).then((results) => {
            if (cancelled) return
            const next: Record<string, number> = {}
            results.forEach((r, i) => {
              if (r.status === 'fulfilled') next[auctions[i].id] = r.value.length
            })
            setBidCounts(next)
          })
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load your loads.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [user?.id, nonce])

  const header = <PageHeader title="My Loads" subtitle="Loads you've posted, their bids, and delivery status." />

  if (loading && !loads) {
    return (
      <div className="p-4 lg:p-6 max-w-3xl mx-auto">
        {header}
        <Loading label="Loading your loads" />
      </div>
    )
  }

  if (error && !loads) {
    return (
      <div className="p-4 lg:p-6 max-w-3xl mx-auto">
        {header}
        <div className="space-y-3">
          <ErrorNote message={error} />
          <button
            onClick={retry}
            className="rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium px-4 py-2.5"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  const items = loads ?? []

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto">
      <PageHeader
        title="My Loads"
        subtitle="Loads you've posted, their bids, and delivery status."
        actions={
          <Link href="/post" className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 inline-flex items-center gap-1.5">
            <PackagePlus className="w-4 h-4" />
            Post a Load
          </Link>
        }
      />

      {items.length === 0 ? (
        <Card>
          <div className="text-center py-12 px-4">
            <p className="text-sm font-medium text-gray-900">No loads yet</p>
            <p className="text-xs text-gray-500 mt-1">Post your first load and carriers can start bidding on it.</p>
            <Link
              href="/post"
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5"
            >
              <PackagePlus className="w-4 h-4" />
              Post a Load
            </Link>
          </div>
        </Card>
      ) : (
        <Card className="divide-y divide-gray-100">
          {items.map((b) => <LoadRow key={b.id} booking={b} bidCount={bidCounts[b.id]} />)}
        </Card>
      )}
    </div>
  )
}

function LoadRow({ booking, bidCount }: { booking: Booking; bidCount?: number }) {
  const status = bookingStatusConfig[booking.status] ?? bookingStatusConfig.pending

  // What sits in the "activity" slot: bids for an auction (once counted), otherwise
  // the routing kind. The status badge already carries the load's progress.
  const activity =
    booking.booking_type === 'auction'
      ? bidCount === undefined
        ? 'Auction'
        : `${bidCount} ${bidCount === 1 ? 'bid' : 'bids'}`
      : 'Direct'

  return (
    <Link href={`/loads/${booking.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors first:rounded-t-xl last:rounded-b-xl">
      <MapPin className="w-4 h-4 text-gray-300 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-gray-900 truncate">
            {booking.source_address} → {booking.destination_address}
          </span>
          <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${status.color}`}>
            {status.label}
          </span>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
          <span className="tabular-nums text-gray-700">{inr(booking.quoted_price)}</span>
          <span className="text-gray-300">·</span>
          <span>{activity}</span>
          <span className="text-gray-300">·</span>
          <span className="tabular-nums">{timeAgo(booking.created_at)}</span>
        </span>
      </span>
      <ArrowRight className="w-4 h-4 text-gray-300 shrink-0" />
    </Link>
  )
}
