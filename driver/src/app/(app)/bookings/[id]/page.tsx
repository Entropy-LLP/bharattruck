'use client'

import { useEffect, useState, useCallback, useRef, use } from 'react'
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
  completeTrip,
  pushLocation,
  ApiError,
  getTrackingPumps,
  getTrackingFuel,
  getTrackingAlerts,
} from '@/lib/api'
import type { TrackingPump, TrackingFuelEstimate, TrackingAlert } from '@/lib/api'
import type { Booking, Quote, NegotiationEntry } from '@/lib/types'
import { formatPrice, formatDate, formatDateTime, relativeTime, getCountdown } from '@/lib/utils'
import { quoteStatusConfig } from '@/lib/status'
import { useScreenWakeLock } from '@/lib/use-wake-lock'
import Spinner from '@/components/spinner'


export default function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [booking, setBooking] = useState<Booking | null>(null)
  const [myQuote, setMyQuote] = useState<Quote | null>(null)
  const [history, setHistory] = useState<NegotiationEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showHistory, setShowHistory] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const [bookingData, quotesData] = await Promise.all([
        getBooking(id),
        getQuotes(id),
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
  }, [id, router])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Auto-refresh every 10s when quote is submitted or countered
  useEffect(() => {
    if (!myQuote) return
    if (myQuote.status !== 'submitted' && myQuote.status !== 'countered') return

    const interval = setInterval(fetchData, 10_000)
    return () => clearInterval(interval)
  }, [myQuote, fetchData])

  if (loading || !booking) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Back button */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1 text-sm text-gray-500 -ml-1"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      {/* Booking Details */}
      <BookingDetailsCard booking={booking} />

      {/* Quote Section */}
      {myQuote ? (
        <QuoteStatusSection
          booking={booking}
          quote={myQuote}
          history={history}
          showHistory={showHistory}
          onToggleHistory={() => setShowHistory(v => !v)}
          onRefresh={fetchData}
        />
      ) : (
        <SubmitQuoteForm booking={booking} onSubmitted={fetchData} />
      )}
    </div>
  )
}

// --- Booking Details Card ---

function BookingDetailsCard({ booking }: { booking: Booking }) {
  const countdown = booking.auction_deadline ? getCountdown(booking.auction_deadline) : null

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-4">
      {/* Route */}
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center mt-1">
          <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
          <div className="w-0.5 h-10 bg-gray-200 my-0.5" />
          <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-400 uppercase tracking-wide">Pickup</p>
          <p className="text-sm font-medium text-gray-900">{booking.source_address}</p>
          <div className="h-3" />
          <p className="text-xs text-gray-400 uppercase tracking-wide">Delivery</p>
          <p className="text-sm font-medium text-gray-900">{booking.destination_address}</p>
        </div>
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide">Load Type</p>
          <p className="text-sm font-medium text-gray-900 mt-0.5">{booking.load_type}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide">Weight</p>
          <p className="text-sm font-medium text-gray-900 mt-0.5">{booking.weight_kg.toLocaleString()} kg</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide">Pickup Date</p>
          <p className="text-sm font-medium text-gray-900 mt-0.5">{formatDate(booking.pickup_date)}</p>
        </div>
        {booking.pickup_time_slot && (
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">Time Slot</p>
            <p className="text-sm font-medium text-gray-900 mt-0.5">{booking.pickup_time_slot}</p>
          </div>
        )}
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide">Shipper&apos;s Price</p>
          <p className="text-base font-bold text-green-700 mt-0.5">{formatPrice(booking.quoted_price)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide">Type</p>
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold mt-0.5 ${
            booking.booking_type === 'auction' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'
          }`}>
            {booking.booking_type === 'auction' ? 'Auction' : 'Direct'}
          </span>
        </div>
      </div>

      {booking.special_instructions && (
        <div className="pt-2 border-t border-gray-100">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Special Instructions</p>
          <p className="text-sm text-gray-700">{booking.special_instructions}</p>
        </div>
      )}

      {booking.booking_type === 'auction' && countdown && (
        <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
          <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className={`text-sm font-medium ${countdown === 'Expired' ? 'text-red-500' : 'text-orange-600'}`}>
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
    <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
      <h3 className="font-bold text-gray-900 mb-1">Submit Your Quote</h3>
      <p className="text-sm text-gray-500 mb-4">
        Shipper is asking {formatPrice(booking.quoted_price)}
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Your Price (&#8377;)</label>
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="Enter amount"
            min="1"
            step="1"
            required
            className="w-full h-12 rounded-xl border border-gray-300 px-4 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Message (optional)</label>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="e.g. I can deliver by 5pm"
            rows={2}
            className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
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

// --- Quote Status Section ---

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

  // --- Accepted: start trip ---
  if (quote.status === 'accepted' && booking.status === 'accepted') {
    return (
      <AcceptedTripSection booking={booking} quote={quote} onRefresh={onRefresh} />
    )
  }

  // --- In Transit: active trip ---
  if (booking.status === 'in_transit') {
    return (
      <ActiveTripSection booking={booking} onRefresh={onRefresh} />
    )
  }

  // --- Paid ---
  if (booking.status === 'paid') {
    return (
      <div className="bg-emerald-50 rounded-2xl border-2 border-emerald-400 p-6 text-center shadow-sm">
        <svg className="w-10 h-10 text-emerald-500 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h3 className="text-xl font-bold text-emerald-800 mb-1">Payment Received</h3>
        <p className="text-sm text-emerald-700">Shipper has confirmed payment.</p>
        <p className="text-lg font-bold text-emerald-700 mt-3">{formatPrice(booking.final_price ?? quote.amount)}</p>
      </div>
    )
  }

  // --- Completed ---
  if (booking.status === 'completed') {
    return (
      <div className="bg-green-50 rounded-2xl border-2 border-green-400 p-6 text-center shadow-sm">
        <h3 className="text-xl font-bold text-green-800 mb-1">Trip Completed</h3>
        <p className="text-sm text-green-700">Delivered successfully. Awaiting payment.</p>
        <p className="text-lg font-bold text-green-700 mt-3">{formatPrice(booking.final_price ?? quote.amount)}</p>
      </div>
    )
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
        <div className="bg-gray-50 rounded-2xl border border-gray-200 p-6 text-center opacity-75">
          <h3 className="text-lg font-semibold text-gray-500 mb-1">{msgs[quote.status]}</h3>
          <p className="text-sm text-gray-400">{formatPrice(quote.amount)} &middot; {relativeTime(quote.submitted_at)}</p>
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
        <div className="bg-orange-50 rounded-2xl border-2 border-orange-400 p-4 shadow-sm animate-pulse-border">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <h3 className="font-bold text-orange-800">Shipper Countered!</h3>
          </div>

          <div className="bg-white rounded-xl p-3 mb-3 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">Your quote</span>
              <span className="text-sm font-medium text-gray-600 line-through">{formatPrice(driverPreviousAmount)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">Shipper&apos;s counter</span>
              <span className="text-lg font-bold text-orange-700">{formatPrice(counterAmount)}</span>
            </div>
            {lastShipperEntry?.message && (
              <p className="text-sm text-gray-600 italic border-t border-gray-100 pt-2">
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
                className="h-11 px-4 rounded-xl border border-gray-300 text-gray-600 font-medium text-sm active:scale-[0.98] transition-transform disabled:opacity-40"
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
      <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-4">
        <div className="text-center">
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${statusConfig.color}`}>
            {statusConfig.label}
          </span>
          <h3 className="text-lg font-bold text-gray-900 mt-3">Your Quote</h3>
          <p className="text-2xl font-bold text-blue-700 mt-1">{formatPrice(quote.amount)}</p>
          {quote.message && (
            <p className="text-sm text-gray-500 mt-1 italic">&ldquo;{quote.message}&rdquo;</p>
          )}
          <p className="text-xs text-gray-400 mt-2">
            Submitted {relativeTime(quote.submitted_at)} &middot; {formatDateTime(quote.submitted_at)}
          </p>
        </div>

        <div className="flex items-center gap-2 bg-yellow-50 rounded-xl p-3">
          <div className="animate-spin h-4 w-4 border-2 border-yellow-600 border-t-transparent rounded-full flex-shrink-0" />
          <p className="text-sm text-yellow-800">Waiting for shipper response...</p>
        </div>

        <button
          onClick={handleWithdraw}
          disabled={withdrawing}
          className="w-full h-11 rounded-xl border border-red-200 text-red-600 font-medium text-sm active:scale-[0.98] transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
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
    <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
      <h3 className="font-bold text-gray-900 mb-3">Counter-Offer</h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Your Counter Price (&#8377;)</label>
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="Enter amount"
            min="1"
            step="1"
            required
            autoFocus
            className="w-full h-12 rounded-xl border border-gray-300 px-4 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Message (optional)</label>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="e.g. Best I can do — fuel costs are high"
            rows={2}
            className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none"
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
            className="h-12 px-4 rounded-xl border border-gray-300 text-gray-600 font-medium text-sm active:scale-[0.98] transition-transform"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

// --- Negotiation History ---

// --- Accepted: Start Trip ---

function AcceptedTripSection({
  booking,
  quote,
  onRefresh,
}: {
  booking: Booking
  quote: Quote
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
      <div className="bg-green-50 rounded-2xl border-2 border-green-400 p-5 shadow-sm">
        <h3 className="text-lg font-bold text-green-800 mb-1">You got the job!</h3>
        <p className="text-sm text-green-700 mb-4">
          {formatPrice(booking.final_price ?? quote.amount)} &middot; Pickup {formatDate(booking.pickup_date)}
        </p>

        <div className="bg-white rounded-xl p-3 space-y-2 text-sm mb-4">
          <div className="flex justify-between">
            <span className="text-gray-500">From</span>
            <span className="font-medium text-right max-w-[200px] truncate">{booking.source_address}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">To</span>
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
            <p className="text-sm text-green-800 font-medium text-center">
              Confirm you have loaded the cargo and are ready to depart?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 h-11 rounded-xl border border-gray-300 text-gray-600 font-medium text-sm"
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
    </div>
  )
}

// --- In Transit: Active Trip with GPS ---

function ActiveTripSection({
  booking,
  onRefresh,
}: {
  booking: Booking
  onRefresh: () => void
}) {
  const [completing, setCompleting] = useState(false)
  const [showDeliverConfirm, setShowDeliverConfirm] = useState(false)
  const [gpsActive, setGpsActive] = useState(false)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState('')
  const watchRef = useRef<number | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Insights state
  const [pumps, setPumps] = useState<TrackingPump[]>([])
  const [fuel, setFuel] = useState<TrackingFuelEstimate | null>(null)
  const [alerts, setAlerts] = useState<TrackingAlert[]>([])
  const [loadingInsights, setLoadingInsights] = useState(false)
  const [activeTab, setActiveTab] = useState<'pumps' | 'fuel' | 'alerts'>('pumps')

  // Keep the screen awake for the whole in-transit trip so the OS doesn't
  // throttle background GPS (frozen D-008). This section only renders while
  // in_transit, so the lock is scoped to the active trip.
  useScreenWakeLock(booking.status === 'in_transit')

  // Start GPS tracking on mount — best-effort, never blocks trip flow
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
    watchRef.current = watchId

    return () => {
      clearTimeout(timeoutId)
      navigator.geolocation.clearWatch(watchId)
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
  }, [booking.updated_at])

  // Fetch pumps, fuel, alerts from tracking microservice (or mock fallback)
  const fetchInsights = useCallback(async () => {
    setLoadingInsights(true)
    try {
      const [pumpsRes, fuelRes, alertsRes] = await Promise.allSettled([
        getTrackingPumps(booking.id),
        getTrackingFuel(booking.id),
        getTrackingAlerts(booking.id),
      ])

      if (pumpsRes.status === 'fulfilled') {
        setPumps(pumpsRes.value.pumps)
      } else {
        setPumps([
          { name: 'Indian Oil Fuel Station', address: 'NH-48, Sector 4, Vapi', distance_meters: 1200, lat: 20.37, lng: 72.92 },
          { name: 'Bharat Petroleum (BPCL)', address: 'NH-48, Manor Toll Plaza', distance_meters: 4500, lat: 19.72, lng: 72.98 },
          { name: 'HP Petrol Station', address: 'GIDC Area, Valsad', distance_meters: 8900, lat: 20.60, lng: 72.93 },
        ])
      }

      if (fuelRes.status === 'fulfilled') {
        setFuel(fuelRes.value)
      } else {
        setFuel({
          distance_km: 150,
          mileage_kmpl: 4,
          fuel_litres: 37.5,
          fuel_cost_inr: 3375,
          diesel_price_inr: 90,
        })
      }

      if (alertsRes.status === 'fulfilled') {
        setAlerts(alertsRes.value.alerts)
      } else {
        setAlerts([
          { id: '1', type: 'near_drop', message: 'Approaching Valsad Drop-point (8.9 km remaining)', severity: 'info', created_at: new Date().toISOString() },
        ])
      }
    } catch {
      // graceful fallback
    } finally {
      setLoadingInsights(false)
    }
  }, [booking.id])

  useEffect(() => {
    fetchInsights()
    const interval = setInterval(fetchInsights, 25_000)
    return () => clearInterval(interval)
  }, [fetchInsights])

  async function handleComplete() {
    setCompleting(true)
    try {
      if (watchRef.current !== null) {
        navigator.geolocation.clearWatch(watchRef.current)
      }
      await completeTrip(booking.id)
      toast.success('Trip completed!')
      onRefresh()
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message)
    } finally {
      setCompleting(false)
      setShowDeliverConfirm(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Driving HUD - Dark Mode Premium Panel */}
      <div className="bg-slate-900 text-white rounded-2xl border border-slate-800 p-5 shadow-xl relative overflow-hidden glow-blue">
        
        {/* Decorative subtle speed rings */}
        <div className="absolute -right-16 -top-16 w-40 h-40 rounded-full border-8 border-blue-500/10 z-0 pointer-events-none" />
        <div className="absolute -right-8 -top-8 w-24 h-24 rounded-full border-4 border-emerald-500/5 z-0 pointer-events-none" />

        <div className="relative z-10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-ping" />
              <h3 className="text-sm font-bold text-blue-400 uppercase tracking-widest">Active Driving HUD</h3>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 bg-slate-800 rounded-full border border-slate-700 text-slate-300">
              Elapsed: {elapsed}
            </span>
          </div>

          {/* GPS status */}
          <div className={`flex items-center gap-3 rounded-xl p-3 mb-5 border ${
            gpsActive
              ? 'bg-emerald-950/40 border-emerald-800/40 text-emerald-300'
              : gpsError
                ? 'bg-slate-800 border-slate-700 text-slate-400'
                : 'bg-amber-950/40 border-amber-800/40 text-amber-300'
          }`}>
            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
              gpsActive ? 'bg-emerald-400 animate-pulse' : gpsError ? 'bg-slate-500' : 'bg-amber-400 animate-pulse'
            }`} />
            <span className="text-xs font-semibold">
              {gpsActive ? 'GPS Signal Connected — Sharing Live Path' : gpsError ?? 'Acquiring GPS Fix...'}
            </span>
          </div>

          {/* Route progress */}
          <div className="grid grid-cols-2 gap-4 mb-5 border-t border-b border-slate-800 py-4">
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">Pickup Point</p>
              <p className="text-sm font-bold truncate text-slate-200">{booking.source_address}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">Destination</p>
              <p className="text-sm font-bold truncate text-slate-200">{booking.destination_address}</p>
            </div>
          </div>

          {!showDeliverConfirm ? (
            <button
              onClick={() => setShowDeliverConfirm(true)}
              className="w-full h-13 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold text-base active:scale-[0.98] transition-transform shadow-lg glow-blue hover:from-blue-700 hover:to-indigo-700"
            >
              🏁 Mark as Delivered
            </button>
          ) : (
            <div className="space-y-3 bg-slate-800/50 p-4 rounded-xl border border-slate-800">
              <p className="text-sm text-slate-300 font-semibold text-center">
                Are you sure you have arrived at the drop location and unloaded the cargo?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeliverConfirm(false)}
                  className="flex-1 h-11 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 font-semibold text-sm hover:bg-slate-750 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleComplete}
                  disabled={completing}
                  className="flex-1 h-11 rounded-xl bg-emerald-600 text-white font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2 hover:bg-emerald-700 transition-colors"
                >
                  {completing ? 'Completing...' : 'Yes, Confirm'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* GPS Insights Drawer (Inline layout styled as premium tabs) */}
      <div className="bg-white rounded-2xl border border-gray-250 shadow-md overflow-hidden">
        <div className="flex border-b border-gray-150 bg-gray-50/50">
          {[
            { id: 'pumps', label: '⛽ Nearby Pumps' },
            { id: 'fuel', label: '⛽ Fuel & Cost' },
            { id: 'alerts', label: '⚠️ Alerts' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as 'pumps' | 'fuel' | 'alerts')}
              className={`flex-1 py-3 text-xs font-bold border-b-2 transition-all ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 bg-white'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-4 min-h-[160px] max-h-[240px] overflow-y-auto hud-scrollbar">
          {activeTab === 'pumps' && (
            <div className="space-y-3">
              {pumps.map((p, idx) => (
                <div key={idx} className="flex justify-between items-center border-b border-gray-100 pb-2.5 last:border-0 last:pb-0">
                  <div>
                    <h4 className="text-xs font-bold text-gray-800">{p.name}</h4>
                    <p className="text-[11px] text-gray-500 truncate max-w-[240px]">{p.address}</p>
                  </div>
                  <span className="text-[11px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                    {p.distance_meters ? `${(p.distance_meters / 1000).toFixed(1)} km` : 'Near'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'fuel' && fuel && (
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                <p className="text-[10px] text-gray-400 font-semibold uppercase">Total Distance</p>
                <p className="text-sm font-bold text-gray-800 mt-0.5">{fuel.distance_km} km</p>
              </div>
              <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                <p className="text-[10px] text-gray-400 font-semibold uppercase">Fuel Price (INR)</p>
                <p className="text-sm font-bold text-gray-800 mt-0.5">₹{fuel.diesel_price_inr} / L</p>
              </div>
              <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                <p className="text-[10px] text-gray-400 font-semibold uppercase">Fuel Consumed</p>
                <p className="text-sm font-bold text-gray-800 mt-0.5">{fuel.fuel_litres} Litres</p>
              </div>
              <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                <p className="text-[10px] text-gray-400 font-semibold uppercase">Estimated Fuel Cost</p>
                <p className="text-sm font-bold text-blue-700 mt-0.5">₹{fuel.fuel_cost_inr.toLocaleString('en-IN')}</p>
              </div>
            </div>
          )}

          {activeTab === 'alerts' && (
            <div className="space-y-2">
              {alerts.length === 0 ? (
                <p className="text-center py-6 text-xs text-gray-400">No active alerts. Route is clear!</p>
              ) : (
                alerts.map(a => (
                  <div
                    key={a.id}
                    className={`flex items-start gap-2.5 p-2.5 rounded-xl border ${
                      a.severity === 'critical'
                        ? 'bg-red-50 border-red-200 text-red-800'
                        : a.severity === 'warning'
                          ? 'bg-amber-50 border-amber-200 text-amber-800'
                          : 'bg-blue-50 border-blue-200 text-blue-800'
                    }`}
                  >
                    <span className="text-sm leading-none mt-0.5">⚠️</span>
                    <div>
                      <p className="text-xs font-bold leading-tight">{a.message}</p>
                      <span className="text-[9px] opacity-75 mt-0.5 inline-block">
                        {new Date(a.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
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
    <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 text-sm text-blue-600 font-medium w-full justify-center"
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
                      : 'bg-gray-100 text-gray-900 rounded-bl-md'
                  }`}
                >
                  <p className={`text-base font-bold ${isDriver ? 'text-white' : 'text-gray-900'}`}>
                    {formatPrice(entry.amount)}
                  </p>
                  {entry.message && (
                    <p className={`text-sm mt-0.5 ${isDriver ? 'text-blue-100' : 'text-gray-600'}`}>
                      {entry.message}
                    </p>
                  )}
                  <p className={`text-xs mt-1 ${isDriver ? 'text-blue-200' : 'text-gray-400'}`}>
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
