'use client'

import { useEffect, useState, useCallback, useMemo, use } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  getBooking,
  getQuotes,
  acceptQuote,
  rejectQuote,
  counterQuote,
  cancelBooking,
  getTrack,
  settlePayment,
  getPaymentStatus,
} from '@/lib/api'
import type { TrackData, TrackEta, TrackLocation, PaymentStatus, PaymentMode } from '@/lib/api'
import { bookingStatusConfig, quoteStatusConfig } from '@/lib/status'
import type { Booking, Quote } from '@/lib/types'
import Navbar from '@/components/Navbar'
import Spinner from '@/components/Spinner'
import CounterModal from '@/components/CounterModal'
import NegotiationHistory from '@/components/NegotiationHistory'
import LiveTrackMap from '@/components/maps/LiveTrackMap'
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export default function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const [booking, setBooking] = useState<Booking | null>(null)
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [counterQuoteId, setCounterQuoteId] = useState<string | null>(null)
  const [expandedQuote, setExpandedQuote] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const [b, q] = await Promise.all([getBooking(id), getQuotes(id)])
      setBooking(b)
      setQuotes(q)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to load booking')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Auto-refresh quotes every 15s when booking is pending
  useEffect(() => {
    if (!booking || booking.status !== 'pending') return
    const interval = setInterval(async () => {
      try {
        const q = await getQuotes(id)
        setQuotes(q)
      } catch {
        // silent fail on poll
      }
    }, 15000)
    return () => clearInterval(interval)
  }, [booking, id])

  async function handleAccept(quoteId: string) {
    try {
      await acceptQuote(id, quoteId)
      toast.success('Quote accepted!')
      fetchData()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to accept quote')
    }
  }

  async function handleReject(quoteId: string) {
    try {
      await rejectQuote(id, quoteId)
      toast.success('Quote rejected')
      fetchData()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to reject quote')
    }
  }

  async function handleCounter(quoteId: string, amount: number, message?: string) {
    try {
      await counterQuote(id, quoteId, { amount, message })
      toast.success('Counter offer sent')
      fetchData()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to send counter')
    }
  }

  async function handleCancel() {
    setCancelling(true)
    try {
      await cancelBooking(id)
      toast.success('Booking cancelled')
      router.push('/dashboard')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel')
    } finally {
      setCancelling(false)
      setShowCancelConfirm(false)
    }
  }

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      </>
    )
  }

  if (!booking) {
    return (
      <>
        <Navbar />
        <div className="text-center py-20 text-gray-500">Booking not found</div>
      </>
    )
  }

  const status = bookingStatusConfig[booking.status]
  const canCancel = !['cancelled', 'completed', 'in_transit', 'paid'].includes(booking.status)

  return (
    <>
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900">Booking Details</h1>
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${status.color}`}>
                {status.label}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-1 font-mono">{booking.id}</p>
          </div>
          {canCancel && (
            <button
              onClick={() => setShowCancelConfirm(true)}
              className="text-sm text-red-600 hover:text-red-700 border border-red-200 px-4 py-2 rounded-lg hover:bg-red-50 transition-colors"
            >
              Cancel Booking
            </button>
          )}
        </div>

        {/* Booking Info */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Route</h3>
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500 mt-1.5 shrink-0" />
                  <span className="text-sm text-gray-700">{booking.source_address}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 mt-1.5 shrink-0" />
                  <span className="text-sm text-gray-700">{booking.destination_address}</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Detail label="Load Type" value={booking.load_type} capitalize />
              <Detail label="Weight" value={`${booking.weight_kg} kg`} />
              <Detail
                label="Quoted Price"
                value={`\u20B9${booking.quoted_price.toLocaleString('en-IN')}`}
              />
              <Detail label="Booking Type" value={booking.booking_type} capitalize />
              <Detail
                label="Pickup Date"
                value={new Date(booking.pickup_date).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              />
              {booking.pickup_time_slot && (
                <Detail label="Time Slot" value={booking.pickup_time_slot} />
              )}
              {booking.final_price && (
                <Detail
                  label="Final Price"
                  value={`\u20B9${booking.final_price.toLocaleString('en-IN')}`}
                />
              )}
            </div>
          </div>
          {booking.special_instructions && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                Special Instructions
              </p>
              <p className="text-sm text-gray-700">{booking.special_instructions}</p>
            </div>
          )}
        </div>

        {/* Trip Tracking */}
        {(['accepted', 'in_transit', 'completed', 'paid'] as const).includes(booking.status as 'accepted' | 'in_transit' | 'completed' | 'paid') && (
          <TripTrackingSection booking={booking} />
        )}

        {/* Payment Section — settle (completed) or the real recorded settlement (paid) */}
        {(booking.status === 'completed' || booking.status === 'paid') && (
          <PaymentSection booking={booking} onPaid={fetchData} />
        )}

        {/* Quotes Panel */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">
              Quotes ({quotes.length})
            </h2>
            {booking.status === 'pending' && (
              <span className="text-xs text-gray-400">Auto-refreshing every 15s</span>
            )}
          </div>

          {quotes.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">
              No quotes yet. Waiting for drivers to respond...
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {quotes.map((quote) => {
                const qs = quoteStatusConfig[quote.status]
                const canAct = quote.status === 'submitted' || quote.status === 'countered'
                const isExpanded = expandedQuote === quote.id

                return (
                  <div key={quote.id} className="px-5 py-4">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                        <div>
                          <p className="text-xs text-gray-400">Driver</p>
                          <p className="font-mono text-gray-700" title={quote.driver_id}>
                            {quote.driver_id.slice(0, 8)}...
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">Amount</p>
                          <p className="font-semibold text-gray-900">
                            {'\u20B9'}{quote.amount.toLocaleString('en-IN')}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">Status</p>
                          <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${qs.color}`}>
                            {quote.status === 'accepted' ? 'Awarded \u2713' : qs.label}
                          </span>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">Submitted</p>
                          <p className="text-gray-700">
                            {new Date(quote.submitted_at).toLocaleDateString('en-IN', {
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        </div>
                      </div>

                      {canAct && (
                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={() => handleAccept(quote.id)}
                            className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => setCounterQuoteId(quote.id)}
                            className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                          >
                            Counter
                          </button>
                          <button
                            onClick={() => handleReject(quote.id)}
                            className="text-xs px-3 py-1.5 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Negotiation toggle */}
                    <button
                      onClick={() => setExpandedQuote(isExpanded ? null : quote.id)}
                      className="text-xs text-blue-600 hover:text-blue-700 mt-2"
                    >
                      {isExpanded ? 'Hide' : 'View'} negotiation history
                    </button>

                    {isExpanded && (
                      <div className="mt-3 border-t border-gray-100 pt-3">
                        <NegotiationHistory bookingId={id} quoteId={quote.id} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>

      {/* Counter Modal */}
      {counterQuoteId && (
        <CounterModal
          onSubmit={(amount, message) => handleCounter(counterQuoteId, amount, message)}
          onClose={() => setCounterQuoteId(null)}
        />
      )}

      {/* Cancel Confirmation */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={() => setShowCancelConfirm(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Cancel Booking?</h3>
            <p className="text-sm text-gray-500 mb-6">
              This action cannot be undone. All pending quotes will be invalidated.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Keep Booking
              </button>
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="flex-1 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {cancelling && <Spinner className="h-4 w-4 border-white border-t-transparent" />}
                Yes, Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// --- Trip Tracking Section ---

function TripTrackingSection({ booking }: { booking: Booking }) {
  const [track, setTrack] = useState<TrackData | null>(null)
  const [pollError, setPollError] = useState(false)

  // One read-through call (LOCKED D-#8) gives location + route + ETA + status.
  // Fetch once for any tracked status (so the route/pins show even before the
  // trip starts); keep the 10s live poll (D-010) running only while moving.
  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const t = await getTrack(booking.id)
        if (!cancelled) {
          setTrack(t)
          setPollError(false)
        }
      } catch {
        if (!cancelled) setPollError(true)
      }
    }

    poll()

    if (booking.status !== 'in_transit') {
      return () => {
        cancelled = true
      }
    }

    const interval = setInterval(poll, 10_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [booking.id, booking.status])

  const steps = [
    { key: 'accepted', label: 'Driver Assigned' },
    { key: 'in_transit', label: 'In Transit' },
    { key: 'completed', label: 'Delivered' },
    { key: 'paid', label: 'Paid' },
  ]
  const currentIndex = steps.findIndex(s => s.key === booking.status)
  const badge = TRIP_STATUS_BADGE[booking.status] ?? TRIP_STATUS_BADGE.accepted

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trip Status</CardTitle>
        <CardAction>
          <Badge variant="secondary" className={badge.className}>{badge.label}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress steps */}
        <div className="flex items-center gap-1">
          {steps.map((step, i) => {
            const done = i <= currentIndex
            return (
              <div key={step.key} className="flex-1 flex flex-col items-center gap-1">
                <div className={`h-1.5 w-full rounded-full ${done ? 'bg-green-500' : 'bg-gray-200'}`} />
                <span className={`text-xs ${done ? 'text-green-700 font-medium' : 'text-gray-400'}`}>
                  {step.label}
                </span>
              </div>
            )
          })}
        </div>

        {/* Live tracking map — driven by the /track read-through aggregate */}
        <ShipperTrackPanel booking={booking} track={track} pollError={pollError} />
      </CardContent>
    </Card>
  )
}

// Status → shadcn Badge label + tint. Label text is the only user-facing copy
// here and stays localizable (mapped, not baked into JSX).
const TRIP_STATUS_BADGE: Record<string, { label: string; className: string }> = {
  accepted:   { label: 'Driver Assigned', className: 'bg-blue-100 text-blue-700' },
  in_transit: { label: 'In Transit',      className: 'bg-amber-100 text-amber-700' },
  completed:  { label: 'Delivered',       className: 'bg-green-100 text-green-700' },
  paid:       { label: 'Paid',            className: 'bg-emerald-100 text-emerald-700' },
}

// --- Shipper live tracking panel (Phase 1: map + freshness caption) ---

const STALE_AFTER_MS = 30_000

function ageText(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m ago`
}

function ShipperTrackPanel({
  booking,
  track,
  pollError,
}: {
  booking: Booking
  track: TrackData | null
  pollError: boolean
}) {
  const origin = useMemo(
    () => ({ lat: booking.source_lat, lng: booking.source_lng }),
    [booking.source_lat, booking.source_lng],
  )
  const dest = useMemo(
    () => ({ lat: booking.dest_lat, lng: booking.dest_lng }),
    [booking.dest_lat, booking.dest_lng],
  )

  const location = track?.location ?? null
  const delivered = booking.status === 'completed' || booking.status === 'paid'
  const ageMs = location ? Date.now() - new Date(location.updated_at).getTime() : Infinity
  const fresh = ageMs <= STALE_AFTER_MS
  // Truck shown only while a delivery is underway and we have a fix.
  const driverPt = !delivered && location ? { lat: location.lat, lng: location.lng } : null

  return (
    <div className="space-y-2">
      <LiveTrackMap
        origin={origin}
        dest={dest}
        encodedPolyline={track?.route.polyline}
        bounds={track?.route.bounds}
        driver={driverPt}
      />
      <TrackCaption
        status={booking.status}
        delivered={delivered}
        completedAt={booking.completed_at}
        location={location}
        eta={track?.eta ?? null}
        fresh={fresh}
        ageMs={ageMs}
        pollError={pollError}
      />
    </div>
  )
}

function etaSuffix(eta: TrackEta | null): string {
  if (!eta) return ''
  return ` · ETA ${eta.eta_text}${eta.stale ? ' (est.)' : ''}`
}

function TrackCaption({
  status,
  delivered,
  completedAt,
  location,
  eta,
  fresh,
  ageMs,
  pollError,
}: {
  status: Booking['status']
  delivered: boolean
  completedAt: string | null
  location: TrackLocation | null
  eta: TrackEta | null
  fresh: boolean
  ageMs: number
  pollError: boolean
}) {
  if (delivered) {
    return (
      <p className="text-xs font-medium text-green-700">
        {`Delivered ✓${
          completedAt
            ? ` · ${new Date(completedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
            : ''
        }`}
      </p>
    )
  }

  // accepted, or in_transit before the first fix -> waiting for the driver.
  if (!location) {
    return (
      <p className="text-xs text-gray-400">
        {pollError
          ? 'Could not fetch live tracking — retrying…'
          : status === 'accepted'
            ? 'Driver assigned — waiting for the trip to start.'
            : 'Waiting for driver to start sharing location…'}
      </p>
    )
  }

  if (fresh) {
    return (
      <p className="text-xs text-gray-500 flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" />
        {`Live · updated ${ageText(ageMs)}${location.speed_kmh !== null ? ` · ${Math.round(location.speed_kmh)} km/h` : ''}${etaSuffix(eta)}`}
      </p>
    )
  }

  return (
    <p className="text-xs text-amber-600 flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
      {`Driver offline — last seen ${ageText(ageMs)}${etaSuffix(eta)}`}
    </p>
  )
}

// --- Payment Section (settlement for completed / recorded state for paid) ---
// Cash-recorded settlement (NO escrow/Razorpay). `completed` shows the
// record-settlement control; on submit it settles then reads back the real
// payment status and flips the booking to `paid` via onPaid(). `paid` reads
// the recorded settlement and renders mode + reference + payout state.

const PAYMENT_MODES: { value: PaymentMode; label: string; hint: string }[] = [
  { value: 'cash', label: 'Cash', hint: 'Paid in cash' },
  { value: 'upi', label: 'UPI', hint: 'UPI transfer' },
  { value: 'direct', label: 'Direct', hint: 'Bank / other' },
]

function PaymentSection({ booking, onPaid }: { booking: Booking; onPaid: () => void }) {
  if (booking.status === 'paid') {
    return <SettledPaymentPanel booking={booking} />
  }
  return <RecordSettlementPanel booking={booking} onPaid={onPaid} />
}

function RecordSettlementPanel({ booking, onPaid }: { booking: Booking; onPaid: () => void }) {
  const prefill = booking.final_price ?? booking.quoted_price
  const [mode, setMode] = useState<PaymentMode>('cash')
  const [amount, setAmount] = useState(String(prefill))
  const [reference, setReference] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSettle() {
    const num = parseFloat(amount)
    if (!num || num <= 0) {
      toast.error('Enter a valid settlement amount')
      return
    }
    setSubmitting(true)
    try {
      await settlePayment(booking.id, {
        amount: num,
        mode,
        reference: reference.trim() || undefined,
      })
      // Read back the real recorded state (satisfies "settle then getPaymentStatus").
      await getPaymentStatus(booking.id)
      toast.success('Settlement recorded')
      onPaid()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to record settlement')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <h2 className="font-semibold text-gray-900">Record settlement</h2>
      <p className="text-sm text-gray-500">
        Cargo has been delivered. Record how payment of{' '}
        <span className="font-semibold text-gray-900">
          {'\u20B9'}{prefill.toLocaleString('en-IN')}
        </span>{' '}
        was settled.
      </p>

      {/* Mode selector */}
      <div>
        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
          Payment method
        </label>
        <div className="grid grid-cols-3 gap-2">
          {PAYMENT_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              className={`rounded-lg border p-3 text-left transition-colors ${
                mode === m.value
                  ? 'border-emerald-400 bg-emerald-50 ring-1 ring-emerald-300'
                  : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <p className="text-sm font-medium text-gray-900">{m.label}</p>
              <p className="text-xs text-gray-400">{m.hint}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Amount */}
      <div>
        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
          Amount (&#8377;)
        </label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          min="1"
          step="1"
          className="w-full h-11 rounded-lg border border-gray-300 px-3 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
        />
      </div>

      {/* Reference (optional) */}
      <div>
        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
          Reference <span className="normal-case font-normal text-gray-400">(optional)</span>
        </label>
        <input
          type="text"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="UPI txn ID / receipt no."
          maxLength={200}
          className="w-full h-11 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
        />
      </div>

      <button
        onClick={handleSettle}
        disabled={submitting}
        className="w-full h-12 rounded-xl bg-emerald-600 text-white font-semibold text-base hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {submitting && <Spinner className="h-4 w-4 border-white border-t-transparent" />}
        Record settlement
      </button>
    </div>
  )
}

function SettledPaymentPanel({ booking }: { booking: Booking }) {
  const [status, setStatus] = useState<PaymentStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    getPaymentStatus(booking.id)
      .then((s) => {
        if (!cancelled) setStatus(s)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [booking.id])

  const payment = status?.payment ?? null
  const payout = status?.payout ?? null
  const modeLabel = payment
    ? (PAYMENT_MODES.find((m) => m.value === payment.mode)?.label ?? payment.mode)
    : null

  return (
    <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-5 space-y-4">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <p className="font-semibold text-emerald-800">Payment settled</p>
          <p className="text-sm text-emerald-600">
            {'\u20B9'}{(payment?.amount ?? booking.final_price ?? booking.quoted_price).toLocaleString('en-IN')} recorded
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-emerald-700">
          <Spinner className="h-4 w-4 border-emerald-600 border-t-transparent" />
          Loading settlement details\u2026
        </div>
      ) : error ? (
        <p className="text-sm text-emerald-700">
          Payment is recorded. Settlement details are momentarily unavailable.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 text-sm bg-white rounded-lg border border-emerald-100 p-4">
          <div>
            <p className="text-xs text-gray-400">Method</p>
            <p className="text-gray-800 font-medium">{modeLabel ?? '\u2014'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Reference</p>
            <p className="text-gray-800 font-medium break-all">{payment?.reference || '\u2014'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Driver payout</p>
            <p className="text-gray-800 font-medium capitalize">
              {payout ? payout.status : 'pending'}
              {payout && payout.status === 'recorded'
                ? ` \u00B7 \u20B9${payout.amount.toLocaleString('en-IN')}`
                : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function Detail({
  label,
  value,
  capitalize,
}: {
  label: string
  value: string
  capitalize?: boolean
}) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`text-gray-700 ${capitalize ? 'capitalize' : ''}`}>{value}</p>
    </div>
  )
}
