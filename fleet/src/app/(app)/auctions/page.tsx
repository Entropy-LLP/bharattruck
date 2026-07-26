'use client'

// Auctions — the fleet's side of the bidding flow.
//
// WHAT THIS PAGE CAN ACTUALLY SHOW, and why:
//
// The only booking call this console has is listFleetBookings() ->
// GET /fleet/bookings, and bt-fleet-service scopes that query to
// `bookings.fleet_owner_id`. bt-booking-service writes that column in exactly
// one place — awardBooking() in lib/quote-repository.ts, at the moment the
// shipper accepts a quote. So every row this endpoint can return is an auction
// the fleet has ALREADY WON; open loads and still-pending bids are not reachable
// from here.
//
// Rather than fake a load board, this page owns the won side of the auction: what
// was bid, what it beat, and which of those wins still has no truck under it —
// which is the thing that actually blocks departure.

import { useEffect, useState } from 'react'
import { ArrowRight, Gavel, Info, RefreshCw, TrendingUp, Truck, Wallet, Wrench } from 'lucide-react'
import { PageHeader } from '@/components/app-shell'
import { Card, CardHead, Empty, ErrorNote, Loading, Stat } from '@/components/stat'
import { ApiError, listFleetBookings } from '@/lib/api'
import { quoteStatusConfig } from '@/lib/status'
import { inr, inrCompact, inrSigned, shortDate, tons } from '@/lib/format'
import type { BookingStatus, FleetBooking } from '@/lib/types'

// Booking-status pills. src/lib/status.ts ships the quote map only, so the
// booking map lives here rather than being added to a shared file this page
// does not own. Colours follow the app's semantics: purple = in_transit,
// emerald = money landed, red = dead.
const bookingPill: Record<BookingStatus, { label: string; color: string }> = {
  pending:     { label: 'Open',        color: 'bg-gray-100 text-gray-600' },
  negotiating: { label: 'Negotiating', color: 'bg-yellow-100 text-yellow-800' },
  accepted:    { label: 'Won',         color: 'bg-blue-100 text-blue-700' },
  in_transit:  { label: 'In transit',  color: 'bg-purple-100 text-purple-700' },
  completed:   { label: 'Delivered',   color: 'bg-emerald-100 text-emerald-800' },
  paid:        { label: 'Paid',        color: 'bg-emerald-100 text-emerald-800' },
  cancelled:   { label: 'Cancelled',   color: 'bg-red-100 text-red-700' },
}

type Filter = 'auction' | 'crew' | 'direct' | 'all'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'auction', label: 'Won auctions' },
  { key: 'crew',    label: 'Awaiting crew' },
  { key: 'direct',  label: 'Direct awards' },
  { key: 'all',     label: 'All' },
]

/** Won, accepted, but no truck or driver bound yet — the departure blocker. */
function needsCrew(b: FleetBooking): boolean {
  return b.status === 'accepted' && (!b.vehicle_id || !b.driver_id)
}

function isAuction(b: FleetBooking): boolean {
  return b.booking_type === 'auction'
}

/**
 * Relative pickup, in whole days. NOT an auction countdown: `auction_deadline`
 * is not among the columns bt-fleet-service selects for /fleet/bookings, so the
 * deadline clock cannot be drawn here (see the note in the UI).
 */
function pickupIn(iso: string | null | undefined): string | null {
  if (!iso) return null
  const target = new Date(iso)
  if (Number.isNaN(target.getTime())) return null
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(target) - startOfDay(new Date())) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days > 1) return `in ${days} days`
  if (days === -1) return 'yesterday'
  return `${Math.abs(days)} days ago`
}

export default function AuctionsPage() {
  const [bookings, setBookings] = useState<FleetBooking[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('auction')
  const [reloadKey, setReloadKey] = useState(0)

  // No status filter: the fleet wants every load it has won on one screen, and
  // the categories below are cheap client-side splits of the same 50-row page.
  useEffect(() => {
    let cancelled = false

    listFleetBookings()
      .then(data => {
        if (cancelled) return
        setBookings(data ?? [])
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setBookings(null)
        setError(err instanceof ApiError ? err.message : 'Could not load auctions')
      })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [reloadKey])

  // The spinner is flipped from the click, not from inside the effect — a
  // synchronous setState in an effect body is a cascading render.
  function refresh() {
    setLoading(true)
    setError(null)
    setReloadKey(k => k + 1)
  }

  const all = bookings ?? []
  const auctions = all.filter(isAuction)
  const awaitingCrew = all.filter(needsCrew)

  // Money is only comparable on rows the shipper actually awarded a price to.
  const priced = all.filter(b => b.final_price !== null)
  const wonValue = priced.reduce((sum, b) => sum + (b.final_price ?? 0), 0)
  const vsAsk = priced.reduce((sum, b) => sum + (b.final_price ?? 0) - b.quoted_price, 0)

  const rows = all
    .filter(b => {
      if (filter === 'auction') return isAuction(b)
      if (filter === 'crew') return needsCrew(b)
      if (filter === 'direct') return !isAuction(b)
      return true
    })
    // Stable sort: anything still missing a truck floats to the top, everything
    // else keeps the service's newest-first order.
    .sort((a, b) => Number(needsCrew(b)) - Number(needsCrew(a)))

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Auctions"
        subtitle="Loads this fleet won at auction — what was bid, and what still needs a truck"
        actions={
          <button
            onClick={refresh}
            disabled={loading}
            className="rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium px-4 py-2.5 inline-flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      {/* Honest about the seam. This is a read-only view by necessity, not choice. */}
      <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 mb-5 flex gap-3">
        <Wrench className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
        <div className="text-sm text-orange-900">
          <p className="font-semibold">Placing a bid is not wired into this console yet.</p>
          <p className="mt-1 text-orange-800">
            The service side exists — bt-booking-service accepts a fleet owner as a bidder on
            <span className="font-mono text-xs bg-orange-100 rounded px-1 py-0.5 mx-1">POST /bookings/:id/quotes</span>
            — but <span className="font-mono text-xs bg-orange-100 rounded px-1 py-0.5">src/lib/api.ts</span> exposes no
            bid call, and no fleet-scoped list of open auctions. A &ldquo;Place bid&rdquo; action and an open-load table
            hook in here once those two client functions land. Until then this page shows only auctions already won,
            which is all <span className="font-mono text-xs bg-orange-100 rounded px-1 py-0.5">GET /fleet/bookings</span> can return.
          </p>
        </div>
      </div>

      {loading && <Loading label="Loading auctions" />}
      {!loading && error && <ErrorNote message={error} />}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <Stat
              label="Auctions won"
              value={auctions.length}
              sub={`${all.length} booking${all.length === 1 ? '' : 's'} in total`}
              icon={<Gavel className="w-4 h-4" />}
            />
            <Stat
              label="Awarded value"
              value={inrCompact(wonValue)}
              sub={priced.length === all.length
                ? `across ${priced.length} awarded load${priced.length === 1 ? '' : 's'}`
                : `${priced.length} of ${all.length} carry a final price`}
              icon={<Wallet className="w-4 h-4" />}
            />
            <Stat
              label="Bid vs shipper ask"
              value={priced.length > 0 ? inrSigned(vsAsk) : '—'}
              tone={priced.length === 0 ? 'neutral' : vsAsk >= 0 ? 'good' : 'bad'}
              sub="final price minus the posted quote"
              icon={<TrendingUp className="w-4 h-4" />}
            />
            <Stat
              label="Awaiting crew"
              value={awaitingCrew.length}
              tone={awaitingCrew.length > 0 ? 'warn' : 'good'}
              sub={awaitingCrew.length > 0 ? 'cannot depart until assigned' : 'every won load is crewed'}
              icon={<Truck className="w-4 h-4" />}
            />
          </div>

          {/* The locked product rules — these explain why "Awaiting crew" is a
              normal state and not an error. */}
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 mb-5 flex gap-3">
            <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <div className="text-sm text-blue-900">
              <p className="font-semibold">How fleet bidding works</p>
              <ul className="mt-1 space-y-1 text-blue-800 list-disc list-inside">
                <li>The fleet may bid on any number of auctions at the same time.</li>
                <li>A bid does not need a free truck — you can bid with the whole fleet on the road.</li>
                <li>
                  The truck and the driver are chosen later, at the assign step, not at bid time.
                </li>
                <li>
                  That assignment is what gates departure: a won load stays parked until a driver and a
                  truck are bound to it.
                </li>
              </ul>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-3">
            {FILTERS.map(f => {
              const count =
                f.key === 'auction' ? auctions.length
                : f.key === 'crew' ? awaitingCrew.length
                : f.key === 'direct' ? all.length - auctions.length
                : all.length
              const active = filter === f.key
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {f.label}
                  <span className={`ml-1.5 tabular-nums ${active ? 'text-blue-100' : 'text-gray-400'}`}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>

          <Card>
            <CardHead
              title={FILTERS.find(f => f.key === filter)?.label ?? 'Auctions'}
              sub={`${rows.length} load${rows.length === 1 ? '' : 's'}`}
            />

            {all.length === 0 ? (
              <Empty
                title="No auctions won yet"
                hint="Loads land here the moment a shipper awards one of this fleet's bids."
              />
            ) : rows.length === 0 ? (
              <Empty title="Nothing under this filter" hint="Try another filter above." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px]">
                  <thead>
                    <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                      <th className="py-3 px-4 text-left font-medium">Route</th>
                      <th className="py-3 px-4 text-left font-medium">Load</th>
                      <th className="py-3 px-4 text-left font-medium">Shipper</th>
                      <th className="py-3 px-4 text-left font-medium">Pickup</th>
                      <th className="py-3 px-4 text-right font-medium">Shipper ask</th>
                      <th className="py-3 px-4 text-right font-medium">Our bid</th>
                      <th className="py-3 px-4 text-left font-medium">Bid</th>
                      <th className="py-3 px-4 text-left font-medium">Booking</th>
                      <th className="py-3 px-4 text-left font-medium">Crew</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(b => {
                      const status = bookingPill[b.status]
                      // Every row here arrived via an accepted quote — that is the
                      // only write path to bookings.fleet_owner_id.
                      const bid = quoteStatusConfig.accepted
                      const delta = b.final_price === null ? null : b.final_price - b.quoted_price
                      const rel = pickupIn(b.pickup_date)
                      const crewed = Boolean(b.vehicle_id && b.driver_id)

                      return (
                        <tr key={b.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="py-3 px-4 text-sm">
                            <div className="flex items-center gap-1.5 max-w-[260px]">
                              <span className="truncate text-gray-900" title={b.source_address}>
                                {b.source_address}
                              </span>
                              <ArrowRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                              <span className="truncate text-gray-900" title={b.destination_address}>
                                {b.destination_address}
                              </span>
                            </div>
                            {!isAuction(b) && (
                              <span className="text-xs text-gray-400">Direct booking</span>
                            )}
                          </td>

                          <td className="py-3 px-4 text-sm">
                            <div className="text-gray-900 truncate max-w-[140px]" title={b.load_type}>
                              {b.load_type}
                            </div>
                            <div className="text-xs text-gray-500 tabular-nums">{tons(b.weight_kg)}</div>
                          </td>

                          <td className="py-3 px-4 text-sm">
                            <span className="text-gray-900 truncate block max-w-[160px]">
                              {b.shipper_name || '—'}
                            </span>
                          </td>

                          <td className="py-3 px-4 text-sm">
                            <div className="text-gray-900">{shortDate(b.pickup_date)}</div>
                            {rel && <div className="text-xs text-gray-500">{rel}</div>}
                          </td>

                          <td className="py-3 px-4 text-sm text-right text-gray-600 tabular-nums">
                            {inr(b.quoted_price)}
                          </td>

                          <td className="py-3 px-4 text-sm text-right">
                            <div className="font-semibold text-gray-900 tabular-nums">
                              {inr(b.final_price)}
                            </div>
                            {delta !== null && delta !== 0 && (
                              <div className={`text-xs tabular-nums ${delta > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                {inrSigned(delta)} vs ask
                              </div>
                            )}
                          </td>

                          <td className="py-3 px-4 text-sm">
                            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${bid.color}`}>
                              {bid.label}
                            </span>
                          </td>

                          <td className="py-3 px-4 text-sm">
                            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${status.color}`}>
                              {status.label}
                            </span>
                          </td>

                          <td className="py-3 px-4 text-sm">
                            {crewed ? (
                              <>
                                <div className="text-gray-900">{b.vehicle?.rc_number ?? 'Truck assigned'}</div>
                                {b.driver?.full_name && (
                                  <div className="text-xs text-gray-500 truncate max-w-[140px]">
                                    {b.driver.full_name}
                                  </div>
                                )}
                              </>
                            ) : b.status === 'accepted' ? (
                              <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-orange-100 text-orange-800">
                                Needs truck + driver
                              </span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <p className="mt-3 text-xs text-gray-400">
            Bid status is derived, not fetched: a booking only carries this fleet&rsquo;s id once the shipper accepts
            its quote, so every row above is a won bid. Live submitted and countered bids, and the time left on an
            auction deadline, both need quote data this console cannot request yet.
          </p>
        </>
      )}
    </div>
  )
}
