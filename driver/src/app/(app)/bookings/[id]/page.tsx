'use client'

import { useEffect, useState, useCallback, useMemo, useRef, use } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  getBooking,
  getQuotes,
  submitQuote,
  counterQuote,
  withdrawQuote,
  getQuoteHistory,
  startTrip,
  getPodContext,
  requestPodOtp,
  pushLocation,
  getRoute,
  ApiError,
} from '@/lib/api'
import { buildNavDeepLink } from '@/lib/nav'
import { useFleetAffiliation } from '@/lib/fleet-affiliation'
import type { PodContext, RouteData, PetrolPump } from '@/lib/api'
import type { Booking, Quote, NegotiationEntry } from '@/lib/types'
import { formatPrice, formatDate, formatDateTime, relativeTime, getCountdown } from '@/lib/utils'
import { quoteStatusConfig } from '@/lib/status'
import { useScreenWakeLock } from '@/lib/use-wake-lock'
import Spinner from '@/components/spinner'
import LiveTrackMap from '@/components/maps/LiveTrackMap'
import TripInsights from '@/components/trip-insights'
import { SubtreeBoundary } from '@/components/maps/map-guard'

export default function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { affiliation, isReady: affiliationReady } = useFleetAffiliation()
  const isFleetDriver = affiliation.is_employed
  const [booking, setBooking] = useState<Booking | null>(null)
  const [myQuote, setMyQuote] = useState<Quote | null>(null)
  const [history, setHistory] = useState<NegotiationEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showHistory, setShowHistory] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      // A fleet driver has no quote of their own to fetch — their owner is the
      // bidder, so /quotes would always answer [] for them. Skipping the call
      // keeps the "no quote" answer from being mistaken for "free to bid".
      const [bookingData, quotesData] = await Promise.all([
        getBooking(id),
        isFleetDriver ? Promise.resolve([] as Quote[]) : getQuotes(id),
      ])
      setBooking(bookingData)
      const quote = quotesData.length > 0 ? quotesData[0] : null
      setMyQuote(quote)

      if (quote) {
        try {
          const h = await getQuoteHistory(id, quote.id)
          setHistory(h)
        } catch {
          // history may not be available yet
        }
      }
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message)
        if (err.code === 'NOT_FOUND') {
          router.replace('/available')
        }
      }
    } finally {
      setLoading(false)
    }
  }, [id, router, isFleetDriver])

  // Wait for the affiliation answer before the first fetch: it decides whether
  // /quotes is even called, and re-fetching on a late answer would double-load.
  useEffect(() => {
    if (!affiliationReady) return
    fetchData()
  }, [affiliationReady, fetchData])

  // Auto-refresh every 10s when quote is submitted or countered
  useEffect(() => {
    if (!myQuote) return
    if (myQuote.status !== 'submitted' && myQuote.status !== 'countered') return

    const interval = setInterval(fetchData, 10_000)
    return () => clearInterval(interval)
  }, [myQuote, fetchData])

  if (!affiliationReady || loading || !booking) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    )
  }

  // Resolved once so the header card and the action section cannot disagree
  // about whether this is a trip or a load.
  const assignedToMe = isAssignedToMe(booking, myQuote)

  return (
    // A single booking is reading/form content, so it keeps a narrow measure
    // even though the shell around it is wide.
    <div className="mx-auto max-w-2xl px-4 py-4 space-y-4">
      {/* Back button */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1 text-sm text-muted-foreground -ml-1"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      {/* Booking Details */}
      <BookingDetailsCard
        booking={booking}
        assignedToMe={assignedToMe}
        fleetName={isFleetDriver ? affiliation.company_name : null}
      />

      <BookingActionSection
        booking={booking}
        myQuote={myQuote}
        history={history}
        assignedToMe={assignedToMe}
        isFleetDriver={isFleetDriver}
        fleetName={affiliation.company_name}
        showHistory={showHistory}
        onToggleHistory={() => setShowHistory(v => !v)}
        onRefresh={fetchData}
      />
    </div>
  )
}

// --- What this screen offers: a trip to drive, or a load to bid on ---
//
// THE RULE (founder Q14): a driver employed by a fleet does not self-select
// work. Their owner wins the load and assigns it to them, so this screen must
// never offer them a quote form — not on their own trip, and not on anything
// else.
//
// The decision is made from the TRIP (`assigned_to_me` + status), never from
// quote ownership. Keying it off "do I own a quote?" is what put a "Submit Your
// Quote" form on an in_transit trip that was already assigned: a fleet driver
// never owns a quote, so the screen read that absence as "free to bid". A solo
// driver who took a load with PATCH /accept has no quote row either and hit the
// same wall.

/**
 * Is this trip mine to drive?
 *
 * `assigned_to_me` is the authoritative answer and the only one that works for
 * a fleet driver. It is optional on the type because an older bt-booking-service
 * does not send it — so during a rolling deploy (app updated, API not yet) fall
 * back to the inference this screen used before: "I hold the winning quote".
 * That fallback is exactly the old branching, wrong in exactly the old ways
 * (a fleet driver has no quote, so it answers false for them and they get the
 * read-only notice rather than a bid form) — never worse than today, and it
 * keeps a solo driver's Start Trip / POD screen from vanishing mid-deploy.
 */
function isAssignedToMe(booking: Booking, myQuote: Quote | null): boolean {
  if (booking.assigned_to_me !== undefined) return booking.assigned_to_me
  if (!myQuote) return false
  return (
    (booking.status === 'accepted' && myQuote.status === 'accepted') ||
    booking.status === 'in_transit' ||
    booking.status === 'completed' ||
    booking.status === 'paid'
  )
}

function BookingActionSection({
  booking,
  myQuote,
  history,
  assignedToMe,
  isFleetDriver,
  fleetName,
  showHistory,
  onToggleHistory,
  onRefresh,
}: {
  booking: Booking
  myQuote: Quote | null
  history: NegotiationEntry[]
  assignedToMe: boolean
  isFleetDriver: boolean
  fleetName: string | null
  showHistory: boolean
  onToggleHistory: () => void
  onRefresh: () => void
}) {
  // The trip I am driving — whoever won it and however it was won.
  if (assignedToMe) {
    return <TripLifecycleSection booking={booking} quote={myQuote} onRefresh={onRefresh} />
  }

  // Not my trip and I drive for a fleet: there is nothing to do here. The API
  // scopes an affiliated driver's reads to their own assignments, so this is
  // defence-in-depth for a stale tab rather than a screen reached in normal use.
  if (isFleetDriver) {
    return <FleetNoBiddingNotice fleetName={fleetName} />
  }

  // Solo driver, open marketplace — unchanged.
  return myQuote ? (
    <QuoteStatusSection
      booking={booking}
      quote={myQuote}
      history={history}
      showHistory={showHistory}
      onToggleHistory={onToggleHistory}
      onRefresh={onRefresh}
    />
  ) : (
    <SubmitQuoteForm booking={booking} onSubmitted={onRefresh} />
  )
}

function FleetNoBiddingNotice({ fleetName }: { fleetName: string | null }) {
  return (
    <div className="bg-card rounded-2xl border border-border p-6 text-center shadow-sm">
      <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-3">
        <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      </div>
      <h3 className="font-bold text-foreground mb-1">This load isn&apos;t yours to bid on</h3>
      <p className="text-sm text-muted-foreground">
        {fleetName ? `${fleetName} bids` : 'Your fleet owner bids'} for loads and assigns the trips to
        you. Your assigned trips are on the Trips tab.
      </p>
    </div>
  )
}

// --- Booking Details Card ---

function BookingDetailsCard({
  booking,
  assignedToMe,
  fleetName,
}: {
  booking: Booking
  assignedToMe: boolean
  fleetName: string | null
}) {
  // Auction/direct and the closing countdown describe how the load is WON. For a
  // fleet driver that is their owner's business, not theirs — the same reason the
  // API strips the money (founder Q16) — and on a trip already assigned there is
  // nothing left to win either way. Shown only where it can still be acted on.
  const showBiddingInfo = !fleetName && !assignedToMe
  const showCountdown = showBiddingInfo && booking.booking_type === 'auction'
  const countdown = booking.auction_deadline ? getCountdown(booking.auction_deadline) : null

  return (
    <div className="bg-card rounded-2xl border border-border p-4 shadow-sm space-y-4">
      {fleetName && assignedToMe && (
        <div className="flex items-center gap-2 rounded-xl bg-primary/8 border border-primary/20 px-3 py-2">
          <svg className="w-4 h-4 text-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-xs font-semibold text-primary">Assigned to you by {fleetName}</p>
        </div>
      )}
      {/* Route */}
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center mt-1">
          <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
          <div className="w-0.5 h-10 bg-secondary my-0.5" />
          <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground/70 uppercase tracking-wide">Pickup</p>
          <p className="text-sm font-medium text-foreground">{booking.source_address}</p>
          <div className="h-3" />
          <p className="text-xs text-muted-foreground/70 uppercase tracking-wide">Delivery</p>
          <p className="text-sm font-medium text-foreground">{booking.destination_address}</p>
        </div>
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground/70 uppercase tracking-wide">Load Type</p>
          <p className="text-sm font-medium text-foreground mt-0.5">{booking.load_type}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground/70 uppercase tracking-wide">Weight</p>
          <p className="text-sm font-medium text-foreground mt-0.5">{booking.weight_kg.toLocaleString()} kg</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground/70 uppercase tracking-wide">Pickup Date</p>
          <p className="text-sm font-medium text-foreground mt-0.5">{formatDate(booking.pickup_date)}</p>
        </div>
        {booking.pickup_time_slot && (
          <div>
            <p className="text-xs text-muted-foreground/70 uppercase tracking-wide">Time Slot</p>
            <p className="text-sm font-medium text-foreground mt-0.5">{booking.pickup_time_slot}</p>
          </div>
        )}
        {/* Omitted for a fleet-affiliated driver — the API masks the money
            because their owner is the commercial party on the trip. */}
        {booking.quoted_price !== undefined && (
          <div>
            <p className="text-xs text-muted-foreground/70 uppercase tracking-wide">Shipper&apos;s Price</p>
            <p className="text-base font-bold text-emerald-400 mt-0.5">{formatPrice(booking.quoted_price)}</p>
          </div>
        )}
        {showBiddingInfo && (
        <div>
          <p className="text-xs text-muted-foreground/70 uppercase tracking-wide">Type</p>
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold mt-0.5 ${
            booking.booking_type === 'auction' ? 'bg-amber-500/15 text-amber-400' : 'bg-primary/15 text-primary'
          }`}>
            {booking.booking_type === 'auction' ? 'Auction' : 'Direct'}
          </span>
        </div>
        )}
      </div>

      {booking.special_instructions && (
        <div className="pt-2 border-t border-border/60">
          <p className="text-xs text-muted-foreground/70 uppercase tracking-wide mb-1">Special Instructions</p>
          <p className="text-sm text-foreground/85">{booking.special_instructions}</p>
        </div>
      )}

      {showCountdown && countdown && (
        <div className="flex items-center gap-2 pt-2 border-t border-border/60">
          <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className={`text-sm font-medium ${countdown === 'Expired' ? 'text-red-500' : 'text-amber-400'}`}>
            Auction: {countdown}
          </span>
        </div>
      )}
    </div>
  )
}

// --- Submit Quote Form ---

function SubmitQuoteForm({ booking, onSubmitted }: { booking: Booking; onSubmitted: () => void }) {
  const router = useRouter()
  const [amount, setAmount] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const num = parseFloat(amount)
    if (!num || num <= 0) {
      toast.error('Please enter a valid amount')
      return
    }

    setSubmitting(true)
    try {
      await submitQuote(booking.id, {
        amount: num,
        message: message.trim() || undefined,
      })
      toast.success('Quote submitted!')
      onSubmitted()
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'DRIVER_PROFILE_NOT_FOUND') {
          toast.error('Set up your driver profile first')
          router.push('/profile')
          return
        }
        toast.error(err.message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-card rounded-2xl border border-border p-4 shadow-sm">
      <h3 className="font-bold text-foreground mb-1">Submit Your Quote</h3>
      {booking.quoted_price !== undefined && (
        <p className="text-sm text-muted-foreground mb-4">
          Shipper is asking {formatPrice(booking.quoted_price)}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-foreground/85 mb-1">Your Price (&#8377;)</label>
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="Enter amount"
            min="1"
            step="1"
            required
            className="w-full h-12 rounded-xl border border-border px-4 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground/85 mb-1">Message (optional)</label>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="e.g. I can deliver by 5pm"
            rows={2}
            className="w-full rounded-xl border border-border px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
          />
        </div>
        <button
          type="submit"
          disabled={submitting || !amount}
          className="w-full h-12 rounded-xl bg-blue-600 text-white font-semibold text-base disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
        >
          {submitting ? <Spinner className="h-5 w-5 border-white border-t-transparent" /> : 'Submit Quote'}
        </button>
      </form>
    </div>
  )
}

// --- Trip Lifecycle Section ---
//
// Everything that happens AFTER a trip is assigned: start, drive, deliver, get
// paid. Reached from `assigned_to_me` alone, so it serves a fleet driver whose
// owner won the load, a solo driver who won on price, and a solo driver who took
// the load straight off the board with PATCH /accept.
//
// `quote` is optional and only ever a fallback for displaying the amount: two of
// those three routes have no quote row at all, and a fleet driver's money fields
// are stripped by the API anyway (founder Q16), so the payout simply does not
// render for them.

function TripLifecycleSection({
  booking,
  quote,
  onRefresh,
}: {
  booking: Booking
  quote: Quote | null
  onRefresh: () => void
}) {
  const payout = booking.final_price ?? quote?.amount ?? null

  if (booking.status === 'in_transit') {
    return <ActiveTripSection booking={booking} onRefresh={onRefresh} />
  }

  if (booking.status === 'paid') {
    return (
      <div className="bg-emerald-500/10 rounded-2xl border-2 border-emerald-400 p-6 text-center shadow-sm">
        <svg className="w-10 h-10 text-emerald-500 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h3 className="text-xl font-bold text-emerald-300 mb-1">Payment Received</h3>
        <p className="text-sm text-emerald-400">Shipper has confirmed payment.</p>
        {payout !== null && (
          <p className="text-lg font-bold text-emerald-400 mt-3">{formatPrice(payout)}</p>
        )}
      </div>
    )
  }

  if (booking.status === 'completed') {
    return (
      <div className="bg-emerald-500/10 rounded-2xl border-2 border-green-400 p-6 text-center shadow-sm">
        <h3 className="text-xl font-bold text-emerald-300 mb-1">Trip Completed</h3>
        <p className="text-sm text-emerald-400">Delivered successfully. Awaiting payment.</p>
        {payout !== null && (
          <p className="text-lg font-bold text-emerald-400 mt-3">{formatPrice(payout)}</p>
        )}
      </div>
    )
  }

  if (booking.status === 'cancelled') {
    return (
      <div className="bg-secondary rounded-2xl border border-border p-6 text-center opacity-75">
        <h3 className="text-lg font-semibold text-muted-foreground mb-1">Trip cancelled</h3>
        <p className="text-sm text-muted-foreground/70">This trip is no longer active.</p>
      </div>
    )
  }

  // accepted (and any pre-departure state): load up and start.
  return <AcceptedTripSection booking={booking} payout={payout} onRefresh={onRefresh} />
}

// --- Quote Status Section ---
//
// The negotiation states only. Once a trip is awarded and assigned it belongs to
// TripLifecycleSection above, which is chosen on `assigned_to_me` before this
// component is ever reached.

function QuoteStatusSection({
  booking,
  quote,
  history,
  showHistory,
  onToggleHistory,
  onRefresh,
}: {
  booking: Booking
  quote: Quote
  history: NegotiationEntry[]
  showHistory: boolean
  onToggleHistory: () => void
  onRefresh: () => void
}) {
  const [withdrawing, setWithdrawing] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [showCounterForm, setShowCounterForm] = useState(false)
  const statusConfig = quoteStatusConfig[quote.status]

  async function handleAcceptCounter() {
    const lastShipperEntry = [...history].reverse().find(h => h.actor_role === 'shipper')
    const amt = lastShipperEntry?.amount ?? quote.amount
    setAccepting(true)
    try {
      await counterQuote(booking.id, quote.id, { amount: amt, message: 'Accepted' })
      toast.success('Counter-offer accepted!')
      onRefresh()
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message)
    } finally {
      setAccepting(false)
    }
  }

  async function handleWithdraw() {
    if (!confirm('Are you sure you want to withdraw this quote?')) return
    setWithdrawing(true)
    try {
      await withdrawQuote(booking.id, quote.id)
      toast.success('Quote withdrawn')
      onRefresh()
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message)
    } finally {
      setWithdrawing(false)
    }
  }

  // --- Rejected / Withdrawn / Expired: muted ---
  if (['rejected', 'withdrawn', 'expired'].includes(quote.status)) {
    const msgs: Record<string, string> = {
      rejected: 'Quote was rejected',
      withdrawn: 'You withdrew this quote',
      expired: 'Quote expired',
    }
    return (
      <div className="space-y-4">
        <div className="bg-secondary rounded-2xl border border-border p-6 text-center opacity-75">
          <h3 className="text-lg font-semibold text-muted-foreground mb-1">{msgs[quote.status]}</h3>
          <p className="text-sm text-muted-foreground/70">{formatPrice(quote.amount)} &middot; {relativeTime(quote.submitted_at)}</p>
        </div>
        {history.length > 0 && (
          <NegotiationHistorySection history={history} show={showHistory} onToggle={onToggleHistory} />
        )}
      </div>
    )
  }

  // --- Countered: attention-grabbing ---
  if (quote.status === 'countered') {
    const lastShipperEntry = [...history].reverse().find(h => h.actor_role === 'shipper')
    const counterAmount = lastShipperEntry?.amount ?? quote.amount

    // Find the driver's offer to show as strikethrough:
    // If driver is the latest actor, show their PREVIOUS offer (second-to-last)
    // If shipper is the latest actor, show driver's most recent offer
    const lastEntry = history[history.length - 1]
    const driverEntries = history.filter(h => h.actor_role === 'driver')
    let driverPreviousAmount: number
    if (lastEntry?.actor_role === 'driver' && driverEntries.length > 1) {
      driverPreviousAmount = driverEntries[driverEntries.length - 2].amount
    } else {
      driverPreviousAmount = driverEntries[driverEntries.length - 1]?.amount ?? quote.amount
    }

    return (
      <div className="space-y-4">
        <div className="bg-amber-500/10 rounded-2xl border-2 border-orange-400 p-4 shadow-sm animate-pulse-border">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <h3 className="font-bold text-amber-300">Shipper Countered!</h3>
          </div>

          <div className="bg-card rounded-xl p-3 mb-3 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Your quote</span>
              <span className="text-sm font-medium text-muted-foreground line-through">{formatPrice(driverPreviousAmount)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Shipper&apos;s counter</span>
              <span className="text-lg font-bold text-amber-400">{formatPrice(counterAmount)}</span>
            </div>
            {lastShipperEntry?.message && (
              <p className="text-sm text-muted-foreground italic border-t border-border/60 pt-2">
                &ldquo;{lastShipperEntry.message}&rdquo;
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={handleAcceptCounter}
              disabled={accepting}
              className="w-full h-11 rounded-xl bg-green-600 text-white font-semibold text-sm active:scale-[0.98] transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {accepting ? <Spinner className="h-4 w-4 border-white border-t-transparent" /> : `Accept ${formatPrice(counterAmount)}`}
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => setShowCounterForm(true)}
                className="flex-1 h-11 rounded-xl bg-orange-600 text-white font-semibold text-sm active:scale-[0.98] transition-transform"
              >
                Counter Back
              </button>
              <button
                onClick={handleWithdraw}
                disabled={withdrawing}
                className="h-11 px-4 rounded-xl border border-border text-muted-foreground font-medium text-sm active:scale-[0.98] transition-transform disabled:opacity-40"
              >
                Withdraw
              </button>
            </div>
          </div>
        </div>

        {showCounterForm && (
          <CounterForm
            booking={booking}
            quote={quote}
            onDone={() => { setShowCounterForm(false); onRefresh() }}
            onCancel={() => setShowCounterForm(false)}
          />
        )}

        {history.length > 0 && (
          <NegotiationHistorySection history={history} show={showHistory} onToggle={onToggleHistory} />
        )}
      </div>
    )
  }

  // --- Submitted: waiting ---
  return (
    <div className="space-y-4">
      <div className="bg-card rounded-2xl border border-border p-4 shadow-sm space-y-4">
        <div className="text-center">
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${statusConfig.color}`}>
            {statusConfig.label}
          </span>
          <h3 className="text-lg font-bold text-foreground mt-3">Your Quote</h3>
          <p className="text-2xl font-bold text-primary mt-1">{formatPrice(quote.amount)}</p>
          {quote.message && (
            <p className="text-sm text-muted-foreground mt-1 italic">&ldquo;{quote.message}&rdquo;</p>
          )}
          <p className="text-xs text-muted-foreground/70 mt-2">
            Submitted {relativeTime(quote.submitted_at)} &middot; {formatDateTime(quote.submitted_at)}
          </p>
        </div>

        <div className="flex items-center gap-2 bg-amber-500/10 rounded-xl p-3">
          <div className="animate-spin h-4 w-4 border-2 border-yellow-600 border-t-transparent rounded-full flex-shrink-0" />
          <p className="text-sm text-amber-300">Waiting for shipper response...</p>
        </div>

        <button
          onClick={handleWithdraw}
          disabled={withdrawing}
          className="w-full h-11 rounded-xl border border-red-500/25 text-red-400 font-medium text-sm active:scale-[0.98] transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {withdrawing ? <Spinner className="h-4 w-4 border-red-600 border-t-transparent" /> : 'Withdraw Quote'}
        </button>
      </div>

      {history.length > 0 && (
        <NegotiationHistorySection history={history} show={showHistory} onToggle={onToggleHistory} />
      )}
    </div>
  )
}

// --- Counter Form ---

function CounterForm({
  booking,
  quote,
  onDone,
  onCancel,
}: {
  booking: Booking
  quote: Quote
  onDone: () => void
  onCancel: () => void
}) {
  const [amount, setAmount] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const num = parseFloat(amount)
    if (!num || num <= 0) {
      toast.error('Please enter a valid amount')
      return
    }

    setSubmitting(true)
    try {
      await counterQuote(booking.id, quote.id, {
        amount: num,
        message: message.trim() || undefined,
      })
      toast.success('Counter-offer sent!')
      onDone()
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-card rounded-2xl border border-border p-4 shadow-sm">
      <h3 className="font-bold text-foreground mb-3">Counter-Offer</h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-foreground/85 mb-1">Your Counter Price (&#8377;)</label>
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="Enter amount"
            min="1"
            step="1"
            required
            autoFocus
            className="w-full h-12 rounded-xl border border-border px-4 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground/85 mb-1">Message (optional)</label>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="e.g. Best I can do — fuel costs are high"
            rows={2}
            className="w-full rounded-xl border border-border px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting || !amount}
            className="flex-1 h-12 rounded-xl bg-orange-600 text-white font-semibold text-base disabled:opacity-40 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
          >
            {submitting ? <Spinner className="h-5 w-5 border-white border-t-transparent" /> : 'Send Counter'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="h-12 px-4 rounded-xl border border-border text-muted-foreground font-medium text-sm active:scale-[0.98] transition-transform"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

// --- Navigate (deep-link handoff to Google Maps) ---
// FROZEN contract: navigation is a deep-link handoff to the phone's
// Google Maps app — NO in-app turn-by-turn. Destination-only so Google
// Maps uses the device's live location as the start point.
//
// The target follows the leg the driver is on: PICKUP (source) while the
// cargo isn't loaded yet (status 'accepted'), DROP (dest) once the trip is
// underway (status 'in_transit').

function NavigateButton({ booking }: { booking: Booking }) {
  const toPickup = booking.status === 'accepted'
  const destination = toPickup
    ? { lat: booking.source_lat, lng: booking.source_lng }
    : { lat: booking.dest_lat, lng: booking.dest_lng }
  const label = toPickup ? 'Navigate to pickup' : 'Navigate to delivery'

  function handleNavigate() {
    const url = buildNavDeepLink({ destination })
    window.open(url, '_blank')
  }

  return (
    <button
      onClick={handleNavigate}
      className="w-full h-12 rounded-xl border-2 border-blue-500 text-primary font-semibold text-base active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
      </svg>
      {label}
    </button>
  )
}

// --- Accepted: Start Trip ---

function AcceptedTripSection({
  booking,
  payout,
  onRefresh,
}: {
  booking: Booking
  /** null when the API masked the money (fleet driver) or no quote exists. */
  payout: number | null
  onRefresh: () => void
}) {
  const [starting, setStarting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  async function handleStart() {
    setStarting(true)
    try {
      await startTrip(booking.id)
      toast.success('Trip started — GPS tracking is now active')
      onRefresh()
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message)
    } finally {
      setStarting(false)
      setShowConfirm(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-emerald-500/10 rounded-2xl border-2 border-green-400 p-5 shadow-sm">
        <h3 className="text-lg font-bold text-emerald-300 mb-1">You got the job!</h3>
        <p className="text-sm text-emerald-400 mb-4">
          {payout !== null && <>{formatPrice(payout)} &middot; </>}
          Pickup {formatDate(booking.pickup_date)}
        </p>

        <div className="bg-card rounded-xl p-3 space-y-2 text-sm mb-4">
          <div className="flex justify-between">
            <span className="text-muted-foreground">From</span>
            <span className="font-medium text-right max-w-[200px] truncate">{booking.source_address}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">To</span>
            <span className="font-medium text-right max-w-[200px] truncate">{booking.destination_address}</span>
          </div>
        </div>

        {!showConfirm ? (
          <button
            onClick={() => setShowConfirm(true)}
            className="w-full h-12 rounded-xl bg-green-600 text-white font-semibold text-base active:scale-[0.98] transition-transform"
          >
            Start Trip
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-emerald-300 font-medium text-center">
              Confirm you have loaded the cargo and are ready to depart?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 h-11 rounded-xl border border-border text-muted-foreground font-medium text-sm"
              >
                Not Yet
              </button>
              <button
                onClick={handleStart}
                disabled={starting}
                className="flex-1 h-11 rounded-xl bg-green-600 text-white font-semibold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {starting ? <Spinner className="h-4 w-4 border-white border-t-transparent" /> : 'Yes, Start Trip'}
              </button>
            </div>
          </div>
        )}
      </div>

      <NavigateButton booking={booking} />
    </div>
  )
}

// --- In Transit: Active Trip with GPS ---

type DeliverPhase = 'idle' | 'confirm' | 'sent'

// Persist the 'awaiting receiver confirmation' state across reloads/remounts.
// `deliverPhase` is ephemeral useState — a reload would reset it to idle and
// tempt a re-tap that silently issues a NEW code, invalidating the one the
// receiver is already typing. We stamp a per-booking localStorage record when
// the code is sent; a remount restores 'sent' from it, and re-issuing a code
// requires the explicit "Resend delivery code" action.
type AwaitingRecord = { receiver_email: string | null; sent_at: number }

function awaitingKey(bookingId: string): string {
  return `pod-awaiting:${bookingId}`
}

function readAwaiting(bookingId: string): AwaitingRecord | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(awaitingKey(bookingId))
    return raw ? (JSON.parse(raw) as AwaitingRecord) : null
  } catch {
    return null
  }
}

function writeAwaiting(bookingId: string, rec: AwaitingRecord): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(awaitingKey(bookingId), JSON.stringify(rec))
  } catch {
    // storage may be unavailable (private mode / quota) — non-fatal
  }
}

function clearAwaiting(bookingId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(awaitingKey(bookingId))
  } catch {
    // non-fatal
  }
}

function ActiveTripSection({
  booking,
  onRefresh,
}: {
  booking: Booking
  onRefresh: () => void
}) {
  const [deliverPhase, setDeliverPhase] = useState<DeliverPhase>('idle')
  const [podContext, setPodContext] = useState<PodContext | null>(null)
  const [loadingContext, setLoadingContext] = useState(false)
  const [sending, setSending] = useState(false)
  const [gpsActive, setGpsActive] = useState(false)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // The driver's OWN position, kept locally for the map.
  //
  // The GPS watch below already runs for ingestion; until now it pushed each fix to the
  // server and threw it away. Holding it in state costs nothing and is strictly better than
  // reading our own position back out of /tracking/track: no round trip, no Cloud Run cost,
  // and it keeps updating through the network dead zones where a driver most needs the map.
  const [selfPos, setSelfPos] = useState<{ lat: number; lng: number } | null>(null)
  const [heading, setHeading] = useState<number | null>(null)

  // The lane's road geometry. Fetched ONCE per trip — the polyline is fixed for the booking
  // and bt-tracking-service caches it for 6h (D-006), so polling it would burn the Routes
  // quota to redraw an identical line.
  const [route, setRoute] = useState<RouteData | null>(null)
  const [pumpMarkers, setPumpMarkers] = useState<PetrolPump[]>([])

  // Keep the screen awake for the whole in-transit trip so the OS doesn't
  // throttle background GPS (frozen D-008). This section only renders while
  // in_transit, so the lock is scoped to the active trip.
  useScreenWakeLock(booking.status === 'in_transit')

  // Start GPS tracking on mount — best-effort, never blocks trip flow.
  // When the receiver verifies and the trip flips to `completed`, this
  // section unmounts and the watch is cleared here automatically.
  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsError('Location tracking will be active on mobile devices')
      return
    }

    let gotFix = false
    const timeoutId = setTimeout(() => {
      // After 10s without a fix, assume desktop/no-GPS environment
      if (!gotFix) {
        setGpsError('Location unavailable on this device — tracking will activate on mobile')
        setGpsActive(false)
      }
    }, 10_000)

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        gotFix = true
        clearTimeout(timeoutId)
        setGpsActive(true)
        setGpsError(null)
        // Draw locally first — the map must not wait on the network round trip below.
        setSelfPos({ lat: position.coords.latitude, lng: position.coords.longitude })
        setHeading(position.coords.heading ?? null)
        pushLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          heading: position.coords.heading ?? undefined,
          speed_kmh: position.coords.speed ? position.coords.speed * 3.6 : undefined,
          accuracy_m: position.coords.accuracy ?? undefined,
          booking_id: booking.id,
        }).catch(() => {
          // silent — location push failures shouldn't block the UI
        })
      },
      (err) => {
        if (err.code === 1) {
          clearTimeout(timeoutId)
          setGpsError('Location access denied — enable in browser settings')
          setGpsActive(false)
        }
        // code 2 (POSITION_UNAVAILABLE) and 3 (TIMEOUT): let the 10s timer handle it
      },
      { enableHighAccuracy: false, maximumAge: 30_000, timeout: 15_000 },
    )

    return () => {
      clearTimeout(timeoutId)
      navigator.geolocation.clearWatch(watchId)
    }
  }, [booking.id])

  // Road geometry for the map — one call per trip, best-effort.
  //
  // A failure here leaves `route` null, which the map handles by drawing pickup, drop and
  // the truck without the road line. That is a degraded map, not a broken trip, so it is
  // deliberately not surfaced as an error.
  useEffect(() => {
    let cancelled = false
    getRoute(booking.id)
      .then((r) => {
        if (!cancelled) setRoute(r)
      })
      .catch(() => {
        // silent — the map degrades to markers-only and the trip is unaffected
      })
    return () => {
      cancelled = true
    }
  }, [booking.id])

  // Elapsed time counter
  useEffect(() => {
    const start = new Date(booking.updated_at ?? Date.now()).getTime()
    function update() {
      const diff = Date.now() - start
      const h = Math.floor(diff / 3_600_000)
      const m = Math.floor((diff % 3_600_000) / 60_000)
      setElapsed(h > 0 ? `${h}h ${m}m` : `${m}m`)
    }
    update()
    intervalRef.current = setInterval(update, 30_000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [booking.in_transit_at])

  // Restore the awaiting state on mount so a reload/remount doesn't reset to
  // idle (see AwaitingRecord). Done in an effect (not useState init) to stay
  // SSR/hydration-safe.
  useEffect(() => {
    const rec = readAwaiting(booking.id)
    if (rec) {
      setPodContext({ booking_id: booking.id, status: 'in_transit', receiver_email: rec.receiver_email })
      setDeliverPhase('sent')
    }
  }, [booking.id])

  // POD completion is out-of-band: once the delivery code is sent, the driver
  // never completes the trip directly — the receiver's verify drives
  // booking-service in_transit → completed. Poll the booking until it flips,
  // clear the persisted awaiting record, then refresh (this section unmounts
  // and the completed branch renders).
  useEffect(() => {
    if (deliverPhase !== 'sent') return
    const interval = setInterval(async () => {
      try {
        const b = await getBooking(booking.id)
        if (b.status !== 'in_transit') {
          clearInterval(interval)
          clearAwaiting(booking.id)
          toast.success('Delivery confirmed by receiver')
          onRefresh()
        }
      } catch {
        // silent — keep polling
      }
    }, 10_000)
    return () => clearInterval(interval)
  }, [deliverPhase, booking.id, onRefresh])

  // Step 1: fetch POD context (receiver_email the OTP will go to).
  async function handleFetchContext() {
    setLoadingContext(true)
    try {
      const ctx = await getPodContext(booking.id)
      setPodContext(ctx)
      setDeliverPhase('confirm')
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message)
    } finally {
      setLoadingContext(false)
    }
  }

  // Step 2: send the delivery code, persist the awaiting state, then move to
  // the awaiting-confirmation screen.
  async function handleSendOtp() {
    setSending(true)
    try {
      await requestPodOtp(booking.id)
      writeAwaiting(booking.id, { receiver_email: podContext?.receiver_email ?? null, sent_at: Date.now() })
      setDeliverPhase('sent')
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message)
    } finally {
      setSending(false)
    }
  }

  // Explicit resend — the ONLY way a new code is issued while awaiting. Re-issues
  // a fresh code (invalidating the previous one) and refreshes the sent-at stamp.
  async function handleResend() {
    setSending(true)
    try {
      await requestPodOtp(booking.id)
      writeAwaiting(booking.id, { receiver_email: podContext?.receiver_email ?? null, sent_at: Date.now() })
      toast.success('Delivery code re-sent')
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message)
    } finally {
      setSending(false)
    }
  }

  // Back out of awaiting WITHOUT completing — returns to idle 'Mark as Delivered'.
  function handleCancelAwaiting() {
    clearAwaiting(booking.id)
    setDeliverPhase('idle')
  }

  const receiverEmail = podContext?.receiver_email ?? null

  // Memoised so the map's effects do not see a fresh object on every render. Every GPS fix
  // sets state here, so an inline `origin={{...}}` would hand the map new identities several
  // times a minute and make it rebuild the route polyline each time.
  const origin = useMemo(
    () => ({ lat: booking.source_lat, lng: booking.source_lng }),
    [booking.source_lat, booking.source_lng],
  )
  const dest = useMemo(
    () => ({ lat: booking.dest_lat, lng: booking.dest_lng }),
    [booking.dest_lat, booking.dest_lng],
  )

  // `Booking` types these as required numbers, but the guard is a runtime check on the API,
  // not on the type: this repo has a documented history of types drifting from what the DB
  // actually returns, and a null slipping through here would render a map at (0, 0) — the
  // Gulf of Guinea — which looks like a working map showing the wrong thing. Far worse than
  // no map.
  const hasCoords =
    Number.isFinite(booking.source_lat) &&
    Number.isFinite(booking.source_lng) &&
    Number.isFinite(booking.dest_lat) &&
    Number.isFinite(booking.dest_lng)

  return (
    <div className="space-y-4">
      <div className="bg-purple-500/10 rounded-2xl border-2 border-purple-400 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-purple-300">Trip In Progress</h3>
          <span className="text-sm font-medium text-purple-400">{elapsed}</span>
        </div>

        {/* GPS status */}
        <div className={`flex items-center gap-2 rounded-xl p-2 mb-3 ${
          gpsActive ? 'bg-emerald-500/15' : gpsError ? 'bg-secondary' : 'bg-amber-500/15'
        }`}>
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
            gpsActive ? 'bg-green-500 animate-pulse' : gpsError ? 'bg-muted-foreground' : 'bg-yellow-500 animate-pulse'
          }`} />
          <span className={`text-xs font-medium ${
            gpsActive ? 'text-emerald-400' : gpsError ? 'text-muted-foreground' : 'text-amber-400'
          }`}>
            {gpsActive ? 'Location active — sharing with shipper' : gpsError ?? 'Acquiring location...'}
          </span>
        </div>

        {/* Destination */}
        <div className="bg-card rounded-xl p-3 text-sm mb-4">
          <p className="text-xs text-muted-foreground/70 uppercase tracking-wide mb-1">Delivering to</p>
          <p className="font-medium text-foreground">{booking.destination_address}</p>
        </div>

        {/* Proof-of-delivery: receiver-OTP gate. The trip completes only
            when the receiver verifies the emailed code — never here. */}
        {deliverPhase === 'idle' && (
          <button
            onClick={handleFetchContext}
            disabled={loadingContext}
            className="w-full h-12 rounded-xl bg-purple-600 text-white font-semibold text-base active:scale-[0.98] transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {loadingContext ? <Spinner className="h-4 w-4 border-white border-t-transparent" /> : 'Mark as Delivered'}
          </button>
        )}

        {deliverPhase === 'confirm' && (
          <div className="space-y-3">
            <div className="bg-card rounded-xl p-3 text-sm">
              <p className="text-xs text-muted-foreground/70 uppercase tracking-wide mb-1">
                Delivery code will be sent to
              </p>
              {receiverEmail ? (
                <p className="font-medium text-foreground break-all">{receiverEmail}</p>
              ) : (
                <p className="font-medium text-red-400">
                  No receiver email is set for this booking — the shipper must add one before delivery can be confirmed.
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setDeliverPhase('idle')}
                className="flex-1 h-11 rounded-xl border border-border text-muted-foreground font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSendOtp}
                disabled={sending || !receiverEmail}
                className="flex-1 h-11 rounded-xl bg-purple-600 text-white font-semibold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {sending ? <Spinner className="h-4 w-4 border-white border-t-transparent" /> : 'Send delivery code'}
              </button>
            </div>
          </div>
        )}

        {deliverPhase === 'sent' && (
          <div className="bg-card rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-center gap-2">
              <Spinner className="h-4 w-4 border-purple-600 border-t-transparent" />
              <p className="text-sm font-semibold text-purple-300">Awaiting receiver confirmation</p>
            </div>
            <p className="text-sm text-muted-foreground text-center">
              Delivery code sent to{' '}
              <span className="font-medium text-foreground break-all">{receiverEmail ?? 'the receiver'}</span>.
              The trip is marked delivered once they enter the code.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleCancelAwaiting}
                disabled={sending}
                className="flex-1 h-11 rounded-xl border border-border text-muted-foreground font-medium text-sm disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleResend}
                disabled={sending}
                className="flex-1 h-11 rounded-xl bg-purple-600 text-white font-semibold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {sending ? <Spinner className="h-4 w-4 border-white border-t-transparent" /> : 'Resend delivery code'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* The map goes BELOW the trip card, not above it.
          Above, it measured ~42vh and pushed "Mark as Delivered" a full screen down — on a
          375x812 phone the booking details card already fills most of the fold, so the map
          was displacing the one action that gets the driver paid. Orientation is worth a
          scroll; the money action is not. A booking without coordinates (older rows) simply
          renders no map. */}
      {hasCoords && (
        <LiveTrackMap
          origin={origin}
          dest={dest}
          encodedPolyline={route?.polyline}
          bounds={route?.bounds}
          self={selfPos}
          heading={heading}
          pumps={pumpMarkers}
        />
      )}

      <NavigateButton booking={booking} />

      {/* Pumps / fuel / alerts. Below the trip controls by design — useful, never in the way
          of the action that gets the driver paid.
          Boundaried for the same reason the map is: this panel renders three server payloads
          the client does not validate field-by-field, and an unexpected shape throwing during
          render would otherwise unmount the whole booking page, Mark as Delivered included. */}
      <SubtreeBoundary
        label="Trip insights"
        fallback={
          <p className="text-xs text-muted-foreground px-1">
            Trip insights are unavailable right now. Your delivery controls above are unaffected.
          </p>
        }
      >
        <TripInsights bookingId={booking.id} onPumpsLoaded={setPumpMarkers} />
      </SubtreeBoundary>
    </div>
  )
}

// --- Negotiation History ---

function NegotiationHistorySection({
  history,
  show,
  onToggle,
}: {
  history: NegotiationEntry[]
  show: boolean
  onToggle: () => void
}) {
  return (
    <div className="bg-card rounded-2xl border border-border p-4 shadow-sm">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 text-sm text-primary font-medium w-full justify-center"
      >
        <svg
          className={`w-4 h-4 transition-transform ${show ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        {show ? 'Hide' : 'Show'} Negotiation History ({history.length})
      </button>

      {show && (
        <div className="mt-4 space-y-3 max-h-80 overflow-y-auto">
          {history.map(entry => {
            const isDriver = entry.actor_role === 'driver'
            return (
              <div key={entry.id} className={`flex ${isDriver ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                    isDriver
                      ? 'bg-blue-600 text-white rounded-br-md'
                      : 'bg-secondary text-foreground rounded-bl-md'
                  }`}
                >
                  <p className={`text-base font-bold ${isDriver ? 'text-white' : 'text-foreground'}`}>
                    {formatPrice(entry.amount)}
                  </p>
                  {entry.message && (
                    <p className={`text-sm mt-0.5 ${isDriver ? 'text-blue-100' : 'text-muted-foreground'}`}>
                      {entry.message}
                    </p>
                  )}
                  <p className={`text-xs mt-1 ${isDriver ? 'text-blue-200' : 'text-muted-foreground/70'}`}>
                    {isDriver ? 'You' : 'Shipper'} &middot; {relativeTime(entry.created_at)}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
