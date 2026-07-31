'use client'

// Auctions — the fleet's side of the bidding flow, now read AND write.
//
// WHAT CHANGED, and why the old page could not do this:
//
// The console previously had exactly one booking call, listFleetBookings() ->
// GET /fleet/bookings, scoped to `bookings.fleet_owner_id`. bt-booking-service writes
// that column in exactly one place — awardBooking(), at the moment a shipper ACCEPTS a
// quote. So the only rows reachable were auctions the fleet had ALREADY WON. Open loads,
// live bids and lost bids were all invisible, and the page carried a banner saying so.
//
// Bidding is anchored on `quotes.fleet_owner_id` instead, which is written at BID time.
// bt-fleet-service now serves two tenant-scoped reads off it — GET /fleet/auctions (the
// open board) and GET /fleet/bids (every bid this fleet has) — and the writes reuse
// bt-booking-service's existing /bookings/:id/quotes* routes, which already accept a
// fleet owner and already own the deadline and duplicate-bid rules.
//
// THE SHAPE OF THIS SCREEN is driven by the one thing a dispatcher actually does: run
// many auctions at once. Hence a board sorted by time pressure, a bid state visible
// inline on every row without a click, and counter-offers pulled to the top of My bids
// because they are the only rows that expire while you are not looking.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowRight, Clock, Gavel, Info, RefreshCw, TrendingUp, Truck, Wallet,
} from 'lucide-react'
import { PageHeader } from '@/components/app-shell'
import { Card, CardHead, Empty, ErrorNote, Loading, Stat } from '@/components/stat'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  ApiError, listOpenAuctions, listMyBids, listFleetBookings,
  placeBid, counterBid, withdrawBid, getBidHistory,
} from '@/lib/api'
import { quoteStatusConfig, bookingStatusConfig } from '@/lib/status'
import { inr, inrCompact, inrSigned, shortDate, tons, timeAgo, dateTime } from '@/lib/format'
import type {
  AuctionBooking, FleetBid, FleetBooking, NegotiationEntry, OpenAuction,
} from '@/lib/types'

type Tab = 'open' | 'bids' | 'won'

const TABS: { key: Tab; label: string }[] = [
  { key: 'open', label: 'Open loads' },
  { key: 'bids', label: 'My bids' },
  { key: 'won',  label: 'Won' },
]

/** A bid the shipper has countered — the fleet owes a reply, and the clock is running. */
function needsReply(b: FleetBid): boolean {
  return b.status === 'countered'
}

/** Live = still in play. Anything else is history. */
function isLive(status: string): boolean {
  return status === 'submitted' || status === 'countered'
}

/**
 * Time left on an auction, in the coarsest unit that is still honest.
 *
 * Returns null when there is no deadline (a load that never expires), and an
 * `expired` flag rather than a negative string — the caller styles those differently
 * because bidding on one is a 409, not a slow bid.
 */
function deadlineIn(iso: string | null): { text: string; expired: boolean; urgent: boolean } | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  if (Number.isNaN(ms)) return null
  if (ms <= 0) return { text: 'closed', expired: true, urgent: false }

  const mins = Math.floor(ms / 60_000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)

  const text = days > 0 ? `${days}d ${hours % 24}h` : hours > 0 ? `${hours}h ${mins % 60}m` : `${mins}m`
  // Under two hours is the band where a dispatcher has to act now rather than think.
  return { text, expired: false, urgent: ms < 2 * 3600_000 }
}

export default function AuctionsPage() {
  const [tab, setTab] = useState<Tab>('open')

  const [auctions, setAuctions] = useState<OpenAuction[] | null>(null)
  const [bids, setBids] = useState<FleetBid[] | null>(null)
  const [won, setWon] = useState<FleetBooking[] | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [bidTarget, setBidTarget] = useState<OpenAuction | null>(null)
  const [counterTarget, setCounterTarget] = useState<FleetBid | null>(null)
  const [historyTarget, setHistoryTarget] = useState<FleetBid | null>(null)

  // All three lists load together on every refresh. They are cheap (one query plus a
  // bounded hydrate each), and the tab counts have to be correct before the dispatcher
  // picks a tab — a count that only fills in after you click it is worse than no count.
  useEffect(() => {
    let cancelled = false

    Promise.all([listOpenAuctions(), listMyBids(), listFleetBookings()])
      .then(([a, b, w]) => {
        if (cancelled) return
        setAuctions(a?.auctions ?? [])
        setBids(b?.bids ?? [])
        setWon(w ?? [])
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : 'Could not load auctions')
      })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [reloadKey])

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    setReloadKey(k => k + 1)
  }, [])

  const openRows = useMemo(() => {
    // Soonest deadline first — the board's whole job is surfacing time pressure.
    // Loads with no deadline sort last; they are not urgent by definition.
    return [...(auctions ?? [])].sort((a, b) => {
      const da = a.auction_deadline ? new Date(a.auction_deadline).getTime() : Infinity
      const db = b.auction_deadline ? new Date(b.auction_deadline).getTime() : Infinity
      return da - db
    })
  }, [auctions])

  const bidRows = useMemo(() => {
    // Countered first (they need a reply), then live, then history.
    return [...(bids ?? [])].sort((a, b) => {
      const rank = (x: FleetBid) => (needsReply(x) ? 0 : isLive(x.status) ? 1 : 2)
      const r = rank(a) - rank(b)
      if (r !== 0) return r
      return new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()
    })
  }, [bids])

  const liveBids = bidRows.filter(b => isLive(b.status))
  const countered = bidRows.filter(needsReply)
  const wonList = won ?? []
  const priced = wonList.filter(b => b.final_price !== null)
  const wonValue = priced.reduce((sum, b) => sum + (b.final_price ?? 0), 0)
  const awaitingCrew = wonList.filter(b => b.status === 'accepted' && (!b.vehicle_id || !b.driver_id))

  const counts: Record<Tab, number> = {
    open: openRows.length,
    bids: bidRows.length,
    won: wonList.length,
  }

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Auctions"
        subtitle="Open loads from shippers, this fleet's live bids, and everything it has won"
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

      {loading && <Loading label="Loading auctions" />}
      {!loading && error && <ErrorNote message={error} />}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <Stat
              label="Open loads"
              value={openRows.length}
              sub={openRows.length > 0 ? 'available to bid on' : 'nothing open right now'}
              icon={<Gavel className="w-4 h-4" />}
            />
            <Stat
              label="Live bids"
              value={liveBids.length}
              tone={countered.length > 0 ? 'warn' : 'neutral'}
              sub={countered.length > 0 ? `${countered.length} awaiting your reply` : 'none need a reply'}
              icon={<TrendingUp className="w-4 h-4" />}
            />
            <Stat
              label="Won"
              value={wonList.length}
              sub={`${inrCompact(wonValue)} awarded`}
              icon={<Wallet className="w-4 h-4" />}
            />
            <Stat
              label="Awaiting crew"
              value={awaitingCrew.length}
              tone={awaitingCrew.length > 0 ? 'warn' : 'good'}
              sub={awaitingCrew.length > 0 ? 'cannot depart until assigned' : 'every won load is crewed'}
              icon={<Truck className="w-4 h-4" />}
            />
          </div>

          {/* Counter-offers are the only thing on this screen that expires while the
              dispatcher is looking elsewhere, so they get a banner, not just a tab count. */}
          {countered.length > 0 && tab !== 'bids' && (
            <button
              onClick={() => setTab('bids')}
              className="w-full text-left rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 mb-5 flex gap-3 hover:bg-orange-100 transition-colors"
            >
              <AlertTriangle className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
              <div className="text-sm text-orange-900">
                <p className="font-semibold">
                  {countered.length} shipper counter-offer{countered.length === 1 ? '' : 's'} awaiting your reply
                </p>
                <p className="mt-0.5 text-orange-800">
                  A countered bid is not live until you answer it. Open My bids to reply with a new price.
                </p>
              </div>
            </button>
          )}

          <div className="flex flex-wrap items-center gap-2 mb-3">
            {TABS.map(t => {
              const active = tab === t.key
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {t.label}
                  <span className={`ml-1.5 tabular-nums ${active ? 'text-blue-100' : 'text-gray-400'}`}>
                    {counts[t.key]}
                  </span>
                </button>
              )
            })}
          </div>

          {tab === 'open' && <OpenBoard rows={openRows} onBid={setBidTarget} />}
          {tab === 'bids' && (
            <MyBids rows={bidRows} onCounter={setCounterTarget} onHistory={setHistoryTarget} onChanged={refresh} />
          )}
          {tab === 'won' && <WonTable rows={wonList} />}

          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 mt-5 flex gap-3">
            <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <div className="text-sm text-blue-900">
              <p className="font-semibold">How fleet bidding works</p>
              <ul className="mt-1 space-y-1 text-blue-800 list-disc list-inside">
                <li>The fleet may bid on any number of auctions at the same time.</li>
                <li>A bid does not need a free truck — you can bid with the whole fleet on the road.</li>
                <li>The truck and the driver are chosen later, at the assign step, not at bid time.</li>
                <li>That assignment is what gates departure: a won load stays parked until a driver and a truck are bound to it.</li>
                <li>Rival bid amounts are never shown — only how many bids a load has.</li>
              </ul>
            </div>
          </div>
        </>
      )}

      <BidDialog
        auction={bidTarget}
        onClose={() => setBidTarget(null)}
        onDone={() => { setBidTarget(null); refresh() }}
      />
      <CounterDialog
        bid={counterTarget}
        onClose={() => setCounterTarget(null)}
        onDone={() => { setCounterTarget(null); refresh() }}
      />
      <HistoryDialog bid={historyTarget} onClose={() => setHistoryTarget(null)} />
    </div>
  )
}

// ── Open load board ───────────────────────────────────────────

function OpenBoard({ rows, onBid }: { rows: OpenAuction[]; onBid: (a: OpenAuction) => void }) {
  return (
    <Card>
      <CardHead
        title="Open loads"
        sub={`${rows.length} load${rows.length === 1 ? '' : 's'} accepting bids · soonest deadline first`}
      />
      {rows.length === 0 ? (
        <Empty
          title="No open loads right now"
          hint="Loads appear here as soon as a shipper posts one that is open to bidding."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px]">
            <thead>
              <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <th className="py-3 px-4 text-left font-medium">Route</th>
                <th className="py-3 px-4 text-left font-medium">Load</th>
                <th className="py-3 px-4 text-left font-medium">Shipper</th>
                <th className="py-3 px-4 text-left font-medium">Pickup</th>
                <th className="py-3 px-4 text-left font-medium whitespace-nowrap">Closes</th>
                <th className="py-3 px-4 text-right font-medium">Shipper ask</th>
                <th className="py-3 px-4 text-center font-medium">Bids</th>
                <th className="py-3 px-4 text-left font-medium">Your bid</th>
                <th className="py-3 px-4 text-right font-medium sticky right-0 bg-white">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(a => {
                const dl = deadlineIn(a.auction_deadline)
                const mine = a.my_bid
                const delta = mine ? mine.amount - a.quoted_price : null

                return (
                  <tr key={a.id} className="group border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 text-sm">
                      <div className="flex items-center gap-1.5 max-w-[260px]">
                        <span className="truncate text-gray-900" title={a.source_address}>{a.source_address}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                        <span className="truncate text-gray-900" title={a.destination_address}>{a.destination_address}</span>
                      </div>
                      {a.booking_type !== 'auction' && (
                        <span className="text-xs text-gray-400">Direct booking, open to bids</span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-sm">
                      <div className="text-gray-900 truncate max-w-[140px]" title={a.load_type}>{a.load_type}</div>
                      <div className="text-xs text-gray-500 tabular-nums">{tons(a.weight_kg)}</div>
                    </td>

                    <td className="py-3 px-4 text-sm">
                      <span className="text-gray-900 truncate block max-w-[150px]">{a.shipper_name || '—'}</span>
                    </td>

                    <td className="py-3 px-4 text-sm whitespace-nowrap">
                      <div className="text-gray-900">{shortDate(a.pickup_date)}</div>
                      {a.pickup_time_slot && <div className="text-xs text-gray-500">{a.pickup_time_slot}</div>}
                    </td>

                    <td className="py-3 px-4 text-sm">
                      {dl ? (
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${
                          dl.expired ? 'bg-gray-100 text-gray-500'
                          : dl.urgent ? 'bg-red-100 text-red-700'
                          : 'bg-gray-100 text-gray-600'
                        }`}>
                          <Clock className="w-3 h-3" />
                          {dl.text}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400 whitespace-nowrap">no deadline</span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-sm text-right text-gray-900 tabular-nums">{inr(a.quoted_price)}</td>

                    <td className="py-3 px-4 text-sm text-center tabular-nums text-gray-600">{a.bid_count}</td>

                    <td className="py-3 px-4 text-sm">
                      {mine ? (
                        <>
                          <div className="font-semibold text-gray-900 tabular-nums">{inr(mine.amount)}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${quoteStatusConfig[mine.status].color}`}>
                              {quoteStatusConfig[mine.status].label}
                            </span>
                            {delta !== null && delta !== 0 && (
                              <span className={`text-xs tabular-nums ${delta > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                {inrSigned(delta)}
                              </span>
                            )}
                          </div>
                        </>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>

                    {/* Sticky so the primary action is reachable without horizontal
                        scrolling — at 1440px this table is wider than its container and the
                        button was landing just off-screen. Needs its own opaque background
                        (a transparent sticky cell shows the row sliding underneath it) and
                        must track the row's hover via `group`. */}
                    <td className="py-3 px-4 text-sm text-right whitespace-nowrap sticky right-0 bg-white group-hover:bg-gray-50 transition-colors border-l border-gray-100">
                      <button
                        onClick={() => onBid(a)}
                        disabled={dl?.expired}
                        className="rounded-xl border border-blue-600 bg-blue-600 text-white text-xs font-medium px-3 py-1.5 whitespace-nowrap hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {mine ? 'Re-bid' : 'Place bid'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

// ── My bids ───────────────────────────────────────────────────

function MyBids({
  rows, onCounter, onHistory, onChanged,
}: {
  rows: FleetBid[]
  onCounter: (b: FleetBid) => void
  onHistory: (b: FleetBid) => void
  onChanged: () => void
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  async function handleWithdraw(b: FleetBid) {
    setBusyId(b.id)
    setRowError(null)
    try {
      await withdrawBid(b.booking_id, b.id)
      onChanged()
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : 'Could not withdraw that bid')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card>
      <CardHead title="My bids" sub={`${rows.length} bid${rows.length === 1 ? '' : 's'} · counter-offers first`} />
      {rowError && <div className="px-4 pt-3"><ErrorNote message={rowError} /></div>}

      {rows.length === 0 ? (
        <Empty
          title="No bids yet"
          hint="Place a bid from the Open loads tab and it will appear here with its full price history."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <th className="py-3 px-4 text-left font-medium">Route</th>
                <th className="py-3 px-4 text-left font-medium">Shipper</th>
                <th className="py-3 px-4 text-right font-medium">Shipper ask</th>
                <th className="py-3 px-4 text-right font-medium">Your bid</th>
                <th className="py-3 px-4 text-left font-medium">Status</th>
                <th className="py-3 px-4 text-left font-medium">Placed</th>
                <th className="py-3 px-4 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(b => {
                const bk = b.booking
                const delta = bk ? b.amount - bk.quoted_price : null
                const cfg = quoteStatusConfig[b.status]
                const busy = busyId === b.id

                return (
                  <tr
                    key={b.id}
                    className={`border-b border-gray-50 transition-colors ${
                      needsReply(b) ? 'bg-orange-50/60 hover:bg-orange-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <td className="py-3 px-4 text-sm">
                      {bk ? (
                        <>
                          <div className="flex items-center gap-1.5 max-w-[260px]">
                            <span className="truncate text-gray-900" title={bk.source_address}>{bk.source_address}</span>
                            <ArrowRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                            <span className="truncate text-gray-900" title={bk.destination_address}>{bk.destination_address}</span>
                          </div>
                          <div className="text-xs text-gray-500 truncate max-w-[260px]">
                            {bk.load_type} · {tons(bk.weight_kg)}
                          </div>
                        </>
                      ) : (
                        // The bid is ours and real even when its load is no longer readable —
                        // dropping the row would silently shrink the fleet's own history.
                        <span className="text-gray-400 italic">Load no longer available</span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-sm">
                      <span className="text-gray-900 truncate block max-w-[150px]">{bk?.shipper_name || '—'}</span>
                    </td>

                    <td className="py-3 px-4 text-sm text-right text-gray-600 tabular-nums">
                      {bk ? inr(bk.quoted_price) : '—'}
                    </td>

                    <td className="py-3 px-4 text-sm text-right">
                      <div className="font-semibold text-gray-900 tabular-nums">{inr(b.amount)}</div>
                      {delta !== null && delta !== 0 && (
                        <div className={`text-xs tabular-nums ${delta > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {inrSigned(delta)} vs ask
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-4 text-sm">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${cfg.color}`}>{cfg.label}</span>
                      {needsReply(b) && <div className="text-xs text-orange-700 mt-0.5">shipper countered</div>}
                    </td>

                    <td className="py-3 px-4 text-sm text-gray-600">
                      <div>{timeAgo(b.submitted_at)}</div>
                      <div className="text-xs text-gray-400">{shortDate(b.submitted_at)}</div>
                    </td>

                    <td className="py-3 px-4 text-sm text-right whitespace-nowrap">
                      <button
                        onClick={() => onHistory(b)}
                        className="rounded-xl border border-gray-200 bg-white text-gray-700 text-xs font-medium px-3 py-1.5 hover:bg-gray-50"
                      >
                        History
                      </button>
                      {needsReply(b) && (
                        <button
                          onClick={() => onCounter(b)}
                          className="ml-2 rounded-xl border border-blue-600 bg-blue-600 text-white text-xs font-medium px-3 py-1.5 hover:bg-blue-700"
                        >
                          Reply
                        </button>
                      )}
                      {isLive(b.status) && (
                        <button
                          onClick={() => handleWithdraw(b)}
                          disabled={busy}
                          className="ml-2 rounded-xl border border-gray-200 bg-white text-red-600 text-xs font-medium px-3 py-1.5 hover:bg-red-50 disabled:opacity-40"
                        >
                          {busy ? 'Withdrawing…' : 'Withdraw'}
                        </button>
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
  )
}

// ── Won ───────────────────────────────────────────────────────

function WonTable({ rows }: { rows: FleetBooking[] }) {
  return (
    <Card>
      <CardHead title="Won" sub={`${rows.length} load${rows.length === 1 ? '' : 's'} awarded to this fleet`} />
      {rows.length === 0 ? (
        <Empty
          title="Nothing won yet"
          hint="Loads land here the moment a shipper accepts one of this fleet's bids."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <th className="py-3 px-4 text-left font-medium">Route</th>
                <th className="py-3 px-4 text-left font-medium">Load</th>
                <th className="py-3 px-4 text-left font-medium">Shipper</th>
                <th className="py-3 px-4 text-left font-medium">Pickup</th>
                <th className="py-3 px-4 text-right font-medium">Awarded</th>
                <th className="py-3 px-4 text-left font-medium">Booking</th>
                <th className="py-3 px-4 text-left font-medium">Crew</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(b => {
                const status = bookingStatusConfig[b.status]
                const crewed = Boolean(b.vehicle_id && b.driver_id)
                const delta = b.final_price === null ? null : b.final_price - b.quoted_price

                return (
                  <tr key={b.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 text-sm">
                      <div className="flex items-center gap-1.5 max-w-[260px]">
                        <span className="truncate text-gray-900" title={b.source_address}>{b.source_address}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                        <span className="truncate text-gray-900" title={b.destination_address}>{b.destination_address}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-sm">
                      <div className="text-gray-900 truncate max-w-[140px]" title={b.load_type}>{b.load_type}</div>
                      <div className="text-xs text-gray-500 tabular-nums">{tons(b.weight_kg)}</div>
                    </td>
                    <td className="py-3 px-4 text-sm">
                      <span className="text-gray-900 truncate block max-w-[150px]">{b.shipper_name || '—'}</span>
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-900">{shortDate(b.pickup_date)}</td>
                    <td className="py-3 px-4 text-sm text-right">
                      <div className="font-semibold text-gray-900 tabular-nums">{inr(b.final_price)}</div>
                      {delta !== null && delta !== 0 && (
                        <div className={`text-xs tabular-nums ${delta > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {inrSigned(delta)} vs ask
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-sm">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${status.color}`}>{status.label}</span>
                    </td>
                    <td className="py-3 px-4 text-sm">
                      {crewed ? (
                        <>
                          <div className="text-gray-900">{b.vehicle?.rc_number ?? 'Truck assigned'}</div>
                          {b.driver?.full_name && (
                            <div className="text-xs text-gray-500 truncate max-w-[140px]">{b.driver.full_name}</div>
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
  )
}

// ── Dialogs ───────────────────────────────────────────────────

/** Shared amount+message body, so the bid and counter forms cannot drift apart. */
function AmountForm({
  ask, amount, setAmount, message, setMessage, error,
}: {
  ask: number | null
  amount: string
  setAmount: (v: string) => void
  message: string
  setMessage: (v: string) => void
  error: string | null
}) {
  const n = Number(amount)
  const valid = Number.isFinite(n) && n > 0
  const delta = valid && ask !== null ? n - ask : null

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="bid-amount" className="block text-sm font-medium text-gray-700 mb-1">
          Your price (₹)
        </label>
        <input
          id="bid-amount"
          type="number"
          inputMode="numeric"
          min={1}
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder={ask !== null ? String(ask) : 'Amount in rupees'}
          className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {ask !== null && (
          <p className="mt-1 text-xs text-gray-500">
            Shipper asked <span className="tabular-nums font-medium text-gray-700">{inr(ask)}</span>
            {delta !== null && delta !== 0 && (
              <span className={`ml-1.5 tabular-nums ${delta > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                ({inrSigned(delta)})
              </span>
            )}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="bid-message" className="block text-sm font-medium text-gray-700 mb-1">
          Message <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <textarea
          id="bid-message"
          rows={3}
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Anything the shipper should know — truck type, availability, terms."
          className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {error && <ErrorNote message={error} />}
    </div>
  )
}

function LoadSummary({ booking }: { booking: AuctionBooking }) {
  const dl = deadlineIn(booking.auction_deadline)
  return (
    <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5 text-sm">
      <div className="flex items-center gap-1.5">
        <span className="truncate text-gray-900">{booking.source_address}</span>
        <ArrowRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
        <span className="truncate text-gray-900">{booking.destination_address}</span>
      </div>
      <div className="mt-1 text-xs text-gray-500">
        {booking.load_type} · {tons(booking.weight_kg)} · pickup {shortDate(booking.pickup_date)}
        {dl && !dl.expired && <> · closes in {dl.text}</>}
      </div>
      {booking.special_instructions && (
        <p className="mt-1.5 text-xs text-gray-600">{booking.special_instructions}</p>
      )}
    </div>
  )
}

function BidDialog({
  auction, onClose, onDone,
}: {
  auction: OpenAuction | null
  onClose: () => void
  onDone: () => void
}) {
  const [amount, setAmount] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Reset per target, so one load's numbers never leak into the next dialog.
  useEffect(() => {
    setAmount(auction?.my_bid ? String(auction.my_bid.amount) : '')
    setMessage('')
    setError(null)
  }, [auction])

  async function submit() {
    if (!auction) return
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0) {
      setError('Enter a price greater than zero.')
      return
    }
    setSaving(true)
    setError(null)

    // Re-bidding replaces a live quote, and the DB allows only one live quote per bidder,
    // so the old one has to come out first. There is no atomic swap available: the only
    // update path (`/counter`) is legal solely while a quote is `countered`.
    //
    // That makes the window between the two calls real — if the withdraw lands and the
    // place then fails (network drop, deadline passed in between, booking just awarded),
    // the fleet is left with NO bid where it previously had one. This tracks that so the
    // failure can say what actually happened, because silently reporting "could not place
    // that bid" while having already destroyed the old one is the worst of both.
    let withdrew = false
    try {
      if (auction.my_bid && isLive(auction.my_bid.status)) {
        await withdrawBid(auction.id, auction.my_bid.id)
        withdrew = true
      }
      await placeBid(auction.id, n, message.trim() || undefined)
      onDone()
    } catch (err) {
      const base = err instanceof ApiError ? err.message : 'Could not place that bid'
      setError(
        withdrew
          ? `${base} — and your previous bid of ${inr(auction.my_bid?.amount ?? null)} has already been withdrawn, so this load currently has no bid from you. Try again.`
          : base,
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={auction !== null} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-lg bg-white border border-gray-200">
        <DialogHeader>
          <DialogTitle>{auction?.my_bid ? 'Replace your bid' : 'Place a bid'}</DialogTitle>
          <DialogDescription>
            {auction?.my_bid
              ? 'Your current bid is withdrawn and replaced with this one.'
              : 'The shipper sees your price and message. You can change or withdraw it until they accept.'}
          </DialogDescription>
        </DialogHeader>

        {auction && (
          <div className="space-y-4">
            <LoadSummary booking={auction} />
            <AmountForm
              ask={auction.quoted_price}
              amount={amount}
              setAmount={setAmount}
              message={message}
              setMessage={setMessage}
              error={error}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Placing…' : auction?.my_bid ? 'Replace bid' : 'Place bid'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CounterDialog({
  bid, onClose, onDone,
}: {
  bid: FleetBid | null
  onClose: () => void
  onDone: () => void
}) {
  const [amount, setAmount] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setAmount(bid ? String(bid.amount) : '')
    setMessage('')
    setError(null)
  }, [bid])

  async function submit() {
    if (!bid) return
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0) {
      setError('Enter a price greater than zero.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await counterBid(bid.booking_id, bid.id, n, message.trim() || undefined)
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send that counter-offer')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={bid !== null} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-lg bg-white border border-gray-200">
        <DialogHeader>
          <DialogTitle>Reply to the counter-offer</DialogTitle>
          <DialogDescription>
            The shipper countered your bid. Send a new price to keep the negotiation alive.
          </DialogDescription>
        </DialogHeader>

        {bid && (
          <div className="space-y-4">
            {bid.booking && <LoadSummary booking={bid.booking} />}
            <AmountForm
              ask={bid.booking?.quoted_price ?? null}
              amount={amount}
              setAmount={setAmount}
              message={message}
              setMessage={setMessage}
              error={error}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Sending…' : 'Send counter'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The append-only price thread for one bid — who offered what, in order. */
function HistoryDialog({ bid, onClose }: { bid: FleetBid | null; onClose: () => void }) {
  const [entries, setEntries] = useState<NegotiationEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!bid) { setEntries(null); setError(null); return }
    let cancelled = false
    setEntries(null)
    setError(null)
    getBidHistory(bid.booking_id, bid.id)
      .then(rows => { if (!cancelled) setEntries(rows ?? []) })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the price history')
      })
    return () => { cancelled = true }
  }, [bid])

  const roleLabel: Record<NegotiationEntry['actor_role'], string> = {
    shipper: 'Shipper',
    fleet_owner: 'Your fleet',
    driver: 'Driver',
  }

  return (
    <Dialog open={bid !== null} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-lg bg-white border border-gray-200 max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Price history</DialogTitle>
          <DialogDescription>Every offer and counter on this bid, oldest first.</DialogDescription>
        </DialogHeader>

        {bid?.booking && <LoadSummary booking={bid.booking} />}

        {error && <ErrorNote message={error} />}
        {!error && entries === null && <Loading label="Loading history" />}
        {!error && entries?.length === 0 && (
          <Empty title="No history yet" hint="The thread fills in as prices are exchanged." />
        )}

        {entries && entries.length > 0 && (
          <ol className="mt-2 space-y-3">
            {entries.map(e => {
              const mine = e.actor_role === 'fleet_owner'
              return (
                <li
                  key={e.id}
                  className={`rounded-xl border px-3 py-2.5 ${
                    mine ? 'border-blue-100 bg-blue-50' : 'border-gray-100 bg-gray-50'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`text-xs font-semibold ${mine ? 'text-blue-800' : 'text-gray-700'}`}>
                      {roleLabel[e.actor_role] ?? e.actor_role}
                    </span>
                    <span className="text-sm font-bold text-gray-900 tabular-nums">{inr(e.amount)}</span>
                  </div>
                  {e.message && <p className="mt-1 text-sm text-gray-700">{e.message}</p>}
                  <p className="mt-1 text-xs text-gray-400">{dateTime(e.created_at)}</p>
                </li>
              )
            })}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  )
}
