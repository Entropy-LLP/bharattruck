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
  getBookingLocation,
  getRoute,
  markAsPaid,
} from '@/lib/api'
import type { DriverLocation, RouteData } from '@/lib/api'
import { bookingStatusConfig, quoteStatusConfig } from '@/lib/status'
import type { Booking, Quote } from '@/lib/types'
import Navbar from '@/components/Navbar'
import Spinner from '@/components/Spinner'
import CounterModal from '@/components/CounterModal'
import NegotiationHistory from '@/components/NegotiationHistory'
import LiveTrackMap from '@/components/maps/LiveTrackMap'

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

        {/* Payment Section */}
        {booking.status === 'completed' && (
          <PaymentSection booking={booking} onPaid={fetchData} />
        )}

        {/* Payment Complete */}
        {booking.status === 'paid' && (
          <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-emerald-800">Payment Complete</p>
              <p className="text-sm text-emerald-600">
                Marked as paid on {new Date(booking.updated_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
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
  const [location, setLocation] = useState<DriverLocation | null>(null)
  const [pollError, setPollError] = useState(false)

  useEffect(() => {
    if (booking.status !== 'in_transit') return

    let cancelled = false

    async function poll() {
      try {
        const loc = await getBookingLocation(booking.id)
        if (!cancelled) {
          setLocation(loc)
          setPollError(false)
        }
      } catch {
        if (!cancelled) setPollError(true)
      }
    }

    poll()
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

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <h2 className="font-semibold text-gray-900">Trip Status</h2>

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

      {/* Live tracking map (Phase 1 — replaces the text-only location panel) */}
      <ShipperTrackPanel booking={booking} location={location} pollError={pollError} />
    </div>
  )
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
  location,
  pollError,
}: {
  booking: Booking
  location: DriverLocation | null
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

  // Route is static for a booking → fetch once (server caches 6h). Degrades
  // gracefully to pins-only if the tracking service isn't reachable.
  const [route, setRoute] = useState<RouteData | null>(null)
  useEffect(() => {
    let cancelled = false
    getRoute(booking.id)
      .then((r) => { if (!cancelled) setRoute(r) })
      .catch(() => { if (!cancelled) setRoute(null) })
    return () => { cancelled = true }
  }, [booking.id])

  const delivered = booking.status === 'completed' || booking.status === 'paid'
  const ageMs = location ? Date.now() - new Date(location.updated_at).getTime() : Infinity
  const fresh = ageMs <= STALE_AFTER_MS
  // Truck shown only while a delivery is underway and we have a fix.
  const driverPt = !delivered && location ? { lat: location.lat, lng: location.lng } : null

  return (
    <div className="space-y-2">
      <LiveTrackMap origin={origin} dest={dest} encodedPolyline={route?.polyline} driver={driverPt} />
      <TrackCaption
        status={booking.status}
        delivered={delivered}
        completedAt={booking.completed_at}
        location={location}
        fresh={fresh}
        ageMs={ageMs}
        pollError={pollError}
      />
    </div>
  )
}

function TrackCaption({
  status,
  delivered,
  completedAt,
  location,
  fresh,
  ageMs,
  pollError,
}: {
  status: Booking['status']
  delivered: boolean
  completedAt: string | null
  location: DriverLocation | null
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
          ? 'Could not fetch driver location — retrying…'
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
        {`Live · updated ${ageText(ageMs)}${location.speed_kmh !== null ? ` · ${Math.round(location.speed_kmh)} km/h` : ''}`}
      </p>
    )
  }

  return (
    <p className="text-xs text-amber-600 flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
      {`Driver offline — last seen ${ageText(ageMs)}`}
    </p>
  )
}

// --- Payment Section (for completed bookings) ---

function PaymentSection({ booking, onPaid }: { booking: Booking; onPaid: () => void }) {
  const [marking, setMarking] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  async function handleMarkPaid() {
    setMarking(true)
    try {
      await markAsPaid(booking.id)
      toast.success('Payment marked as complete')
      onPaid()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to mark as paid')
    } finally {
      setMarking(false)
      setShowConfirm(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <h2 className="font-semibold text-gray-900">Payment</h2>
      <p className="text-sm text-gray-500">
        Cargo has been delivered. Choose how to settle payment of{' '}
        <span className="font-semibold text-gray-900">
          {'\u20B9'}{(booking.final_price ?? booking.quoted_price).toLocaleString('en-IN')}
        </span>
      </p>

      <div className="grid sm:grid-cols-2 gap-3">
        {/* RazorPay placeholder */}
        <div className="relative border border-gray-200 rounded-lg p-4 opacity-60 cursor-not-allowed">
          <span className="absolute top-2 right-2 text-[10px] font-semibold uppercase tracking-wide bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
            Coming Soon
          </span>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded bg-blue-50 flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">Pay on Platform</p>
              <p className="text-xs text-gray-400">UPI, Card, Net Banking via RazorPay</p>
            </div>
          </div>
        </div>

        {/* Mark as Paid */}
        {!showConfirm ? (
          <button
            onClick={() => setShowConfirm(true)}
            className="border-2 border-emerald-200 rounded-lg p-4 text-left hover:bg-emerald-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded bg-emerald-50 flex items-center justify-center">
                <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">Mark as Paid</p>
                <p className="text-xs text-gray-400">Payment settled offline or via other method</p>
              </div>
            </div>
          </button>
        ) : (
          <div className="border-2 border-emerald-300 bg-emerald-50 rounded-lg p-4 space-y-3">
            <p className="text-sm text-emerald-800 font-medium">
              Confirm payment of {'\u20B9'}{(booking.final_price ?? booking.quoted_price).toLocaleString('en-IN')} has been made?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleMarkPaid}
                disabled={marking}
                className="flex-1 px-3 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {marking && <Spinner className="h-4 w-4 border-white border-t-transparent" />}
                Confirm Paid
              </button>
            </div>
          </div>
        )}
      </div>
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
