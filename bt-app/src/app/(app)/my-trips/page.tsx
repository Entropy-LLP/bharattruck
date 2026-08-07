'use client'

/**
 * My Trips (drive surface — Phase 3 of docs/UNIFIED_APP_PLAN.md).
 *
 * The trips assigned to this human to DRIVE. GET /bookings returns the caller's own
 * bookings, and each row carries a `viewer` block naming the caller's relations to it —
 * so this keeps only the ones where they are the driver or the carrier (the party who
 * moves the load), and only while the trip is live enough to act on
 * (accepted → in_transit → completed → delivery_asserted). Loads they merely POSTED
 * (relation 'shipper') stay on My Loads; the open board they could bid on never matches.
 *
 * Three states, all rendered — never a blank screen:
 *  - LOADING → a spinner with a label.
 *  - ERROR   → an ErrorNote with a retry.
 *  - EMPTY   → "No trips assigned yet" with a short explanation of where trips come from.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, KeyRound, Navigation, Truck } from 'lucide-react'

import { PageHeader } from '@/components/app-shell'
import { Card, Empty, ErrorNote, Loading } from '@/components/stat'
import { ApiError, listBookings } from '@/lib/api'
import { shortDate, timeAgo } from '@/lib/format'
import { bookingStatusConfig } from '@/lib/status'
import type { Booking, BookingStatus } from '@/lib/types'

// A trip is "mine to drive" while it is live enough to act on. `paid` and `cancelled`
// are terminal for the driver, so they drop off the working list.
const DRIVABLE_STATUSES: BookingStatus[] = ['accepted', 'in_transit', 'completed', 'delivery_asserted']

// I'm the party moving this load if the server says my relation is 'driver' (I'm the
// assigned driver) or 'carrier' (I won it as the carrier). Either is enough; the
// relation block is the intended signal and correctly excludes loads I only posted.
function isMineToDrive(b: Booking): boolean {
  const rel = b.viewer?.relations ?? []
  return (rel.includes('driver') || rel.includes('carrier')) && DRIVABLE_STATUSES.includes(b.status)
}

export default function MyTripsPage() {
  const [trips, setTrips] = useState<Booking[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const retry = useCallback(() => {
    setLoading(true)
    setError(null)
    setTrips(null)
    setNonce((n) => n + 1)
  }, [])

  useEffect(() => {
    let cancelled = false

    listBookings()
      .then((all) => {
        if (cancelled) return
        setTrips(all.filter(isMineToDrive))
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load your trips.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [nonce])

  const header = <PageHeader title="My Trips" subtitle="Trips assigned to you to drive." />

  if (loading && !trips) {
    return (
      <div className="p-4 lg:p-6 max-w-3xl mx-auto">
        {header}
        <Loading label="Loading your trips" />
      </div>
    )
  }

  if (error && !trips) {
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

  const items = trips ?? []

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto">
      {header}

      {items.length === 0 ? (
        <Card>
          <Empty
            title="No trips assigned yet"
            hint="Trips you win on the board, or that your fleet assigns to you, show up here when they're ready to drive. Check Find Work to bid on a load."
          />
        </Card>
      ) : (
        <Card className="divide-y divide-gray-100">
          {items.map((b) => <TripRow key={b.id} booking={b} />)}
        </Card>
      )}
    </div>
  )
}

function TripRow({ booking }: { booking: Booking }) {
  const status = bookingStatusConfig[booking.status] ?? bookingStatusConfig.pending
  const needsOtp = booking.status === 'in_transit'

  return (
    <Link
      href={`/my-trips/${booking.id}`}
      className="flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors first:rounded-t-xl last:rounded-b-xl"
    >
      <Truck className="w-4 h-4 text-gray-300 shrink-0" />
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
          <span>Pickup {shortDate(booking.pickup_date)}</span>
          <span className="text-gray-300">·</span>
          <span className="tabular-nums">{timeAgo(booking.created_at)}</span>
          {needsOtp && (
            <>
              <span className="text-gray-300">·</span>
              <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                <KeyRound className="w-3 h-3" /> Needs delivery code to close
              </span>
            </>
          )}
          {booking.status === 'accepted' && (
            <>
              <span className="text-gray-300">·</span>
              <span className="inline-flex items-center gap-1 text-blue-700 font-medium">
                <Navigation className="w-3 h-3" /> Ready to start
              </span>
            </>
          )}
        </span>
      </span>
      <ArrowRight className="w-4 h-4 text-gray-300 shrink-0" />
    </Link>
  )
}
