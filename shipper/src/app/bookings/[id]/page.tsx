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
import ReceiverEmailSection from '@/components/ReceiverEmailSection'
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
        <div className="text-center py-20 text-muted-foreground">Booking not found</div>
      </>
    )
  }

  // Guarded the way the dashboard already guards its own lookup: a status this
  // build predates would otherwise take the page down on `status.color`, which
  // is the same failure the carrier fix above is about.
  const status = bookingStatusConfig[booking.status] ?? bookingStatusConfig.pending
  const canCancel = !['cancelled', 'completed', 'in_transit', 'paid'].includes(booking.status)

  return (
    <>
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-foreground">Booking Details</h1>
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${status.color}`}>
                {status.label}
              </span>
            </div>
            <p className="text-xs text-muted-foreground/70 mt-1 font-mono">{booking.id}</p>
          </div>
          {canCancel && (
            <button
              onClick={() => setShowCancelConfirm(true)}
              className="text-sm text-red-400 hover:text-red-400 border border-red-500/25 px-4 py-2 rounded-lg hover:bg-red-500/10 transition-colors"
            >
              Cancel Booking
            </button>
          )}
        </div>

        {/* Booking Info */}
        <div className="bg-card rounded-xl border border-border p-5">
          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wide mb-3">Route</h3>
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500 mt-1.5 shrink-0" />
                  <span className="text-sm text-foreground/85">{booking.source_address}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 mt-1.5 shrink-0" />
                  <span className="text-sm text-foreground/85">{booking.destination_address}</span>
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
            <div className="mt-4 pt-4 border-t border-border/60">
              <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wide mb-1">
                Special Instructions
              </p>
              <p className="text-sm text-foreground/85">{booking.special_instructions}</p>
            </div>
          )}
          <ReceiverEmailSection booking={booking} onSaved={fetchData} />
        </div>

        {/* Trip Tracking */}
        {(['accepted', 'in_transit', 'completed', 'paid'] as const).includes(booking.status as 'accepted' | 'in_transit' | 'completed' | 'paid') && (
          <TripTrackingSection booking={booking} />
        )}

        {/* Payment Section — settle (completed) or the real recorded settlement (paid) */}
        {(booking.status === 'completed' || booking.status === 'paid') && (
          <PaymentSection booking={booking} onPaid={fetchData} />
        )}

        {/* Quotes Panel — auction bookings only; a direct booking is a 1:1 contract, there is no bidding to show */}
        {booking.booking_type === 'auction' && (
        <div className="bg-card rounded-xl border border-border">
          <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
            <h2 className="font-semibold text-foreground">
              Quotes ({quotes.length})
            </h2>
            {booking.status === 'pending' && (
              <span className="text-xs text-muted-foreground/70">Auto-refreshing every 15s</span>
            )}
          </div>

          {quotes.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground/70 text-sm">
              No quotes yet. Waiting for drivers to respond...
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {quotes.map((quote) => {
                const qs = quoteStatusConfig[quote.status] ?? quoteStatusConfig.submitted
                const canAct = quote.status === 'submitted' || quote.status === 'countered'
                const isExpanded = expandedQuote === quote.id

                return (
                  <div key={quote.id} className="px-5 py-4">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground/70">{carrierKindLabel(quote)}</p>
                          <CarrierName quote={quote} />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground/70">Amount</p>
                          <p className="font-semibold text-foreground">
                            {'\u20B9'}{quote.amount.toLocaleString('en-IN')}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground/70">Status</p>
                          <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${qs.color}`}>
                            {quote.status === 'accepted' ? 'Awarded \u2713' : qs.label}
                          </span>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground/70">Submitted</p>
                          <p className="text-foreground/85">
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
                            className="text-xs px-3 py-1.5 border border-red-500/25 text-red-400 rounded-lg hover:bg-red-500/10 transition-colors"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Negotiation toggle */}
                    <button
                      onClick={() => setExpandedQuote(isExpanded ? null : quote.id)}
                      className="text-xs text-primary hover:text-primary mt-2"
                    >
                      {isExpanded ? 'Hide' : 'View'} negotiation history
                    </button>

                    {isExpanded && (
                      <div className="mt-3 border-t border-border/60 pt-3">
                        <NegotiationHistory bookingId={id} quoteId={quote.id} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        )}
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
          <div className="bg-card rounded-xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-foreground mb-2">Cancel Booking?</h3>
            <p className="text-sm text-muted-foreground mb-6">
              This action cannot be undone. All pending quotes will be invalidated.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="flex-1 px-4 py-2 text-sm border border-border rounded-lg hover:bg-secondary transition-colors"
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

// --- Carrier identity on a bid ---
// A bid comes from EITHER a solo driver OR a fleet owner, and the quote row
// names only the one it came from. The server resolves that party into
// `carrier`; this renders it.
//
// `carrier` can be absent two ways, and they are not the same thing: the party
// row was deleted, or the service predates carrier resolution (the deploy
// window where this app ships ahead of bt-booking-service). In the second case
// the row still says WHICH KIND bid via the id columns, so read those before
// falling back to "unknown" — guessing "Driver" for a fleet bid is how this
// page got into trouble in the first place.

function carrierKind(quote: Quote): 'driver' | 'fleet' | null {
  if (quote.carrier) return quote.carrier.kind
  if (quote.fleet_owner_id) return 'fleet'
  if (quote.driver_id) return 'driver'
  return null
}

function carrierKindLabel(quote: Quote): string {
  const kind = carrierKind(quote)
  return kind === 'fleet' ? 'Fleet' : kind === 'driver' ? 'Driver' : 'Carrier'
}

function CarrierName({ quote }: { quote: Quote }) {
  const carrier = quote.carrier
  const kind = carrierKind(quote)

  // An unnamed bidder still has to be a selectable row, not a blank cell.
  const fallback =
    kind === 'fleet' ? 'Fleet operator' : kind === 'driver' ? 'Independent driver' : 'Unknown carrier'

  // Fleet bids carry no truck or rating — those belong to the driver assigned later.
  const detail =
    carrier?.kind === 'driver'
      ? [
          carrier.truck_number,
          carrier.total_trips ? `${carrier.total_trips} trips` : null,
          carrier.average_rating ? `${carrier.average_rating.toFixed(1)}★` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : null

  return (
    <>
      <p className={`text-foreground/85 ${carrier?.name ? 'font-medium' : 'italic'}`}>
        {carrier?.name ?? fallback}
      </p>
      {detail && <p className="text-xs text-muted-foreground/70">{detail}</p>}
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

  // A fleet wins the auction as a COMPANY; the truck and driver are paired to
  // the trip afterwards, in bt-fleet-service. Until that happens driver_id is
  // NULL, so calling this step "Driver Assigned" tells the shipper a driver is
  // on the job when nobody has been named yet.
  const awaitingFleetDriver = !!booking.fleet_owner_id && !booking.driver_id

  const steps = [
    { key: 'accepted', label: awaitingFleetDriver ? 'Carrier Booked' : 'Driver Assigned' },
    { key: 'in_transit', label: 'In Transit' },
    { key: 'completed', label: 'Delivered' },
    { key: 'paid', label: 'Paid' },
  ]
  const currentIndex = steps.findIndex(s => s.key === booking.status)
  const badge =
    booking.status === 'accepted' && awaitingFleetDriver
      ? TRIP_STATUS_BADGE.awaiting_fleet_driver
      : TRIP_STATUS_BADGE[booking.status] ?? TRIP_STATUS_BADGE.accepted

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
                <div className={`h-1.5 w-full rounded-full ${done ? 'bg-green-500' : 'bg-secondary'}`} />
                <span className={`text-xs ${done ? 'text-emerald-400 font-medium' : 'text-muted-foreground/70'}`}>
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
  accepted:   { label: 'Driver Assigned', className: 'bg-primary/15 text-primary' },
  // Fleet won the load but has not named a truck/driver yet — see awaitingFleetDriver.
  awaiting_fleet_driver: { label: 'Awaiting Truck', className: 'bg-amber-500/15 text-amber-400' },
  in_transit: { label: 'In Transit',      className: 'bg-amber-500/15 text-amber-400' },
  completed:  { label: 'Delivered',       className: 'bg-emerald-500/15 text-emerald-400' },
  paid:       { label: 'Paid',            className: 'bg-emerald-500/15 text-emerald-400' },
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
        awaitingFleetDriver={!!booking.fleet_owner_id && !booking.driver_id}
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
  awaitingFleetDriver,
  completedAt,
  location,
  eta,
  fresh,
  ageMs,
  pollError,
}: {
  status: Booking['status']
  delivered: boolean
  awaitingFleetDriver: boolean
  completedAt: string | null
  location: TrackLocation | null
  eta: TrackEta | null
  fresh: boolean
  ageMs: number
  pollError: boolean
}) {
  if (delivered) {
    return (
      <p className="text-xs font-medium text-emerald-400">
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
      <p className="text-xs text-muted-foreground/70">
        {pollError
          ? 'Could not fetch live tracking — retrying…'
          : awaitingFleetDriver
            ? 'Carrier booked — waiting for the fleet to assign a truck and driver.'
            : status === 'accepted'
              ? 'Driver assigned — waiting for the trip to start.'
              : 'Waiting for driver to start sharing location…'}
      </p>
    )
  }

  if (fresh) {
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" />
        {`Live · updated ${ageText(ageMs)}${location.speed_kmh !== null ? ` · ${Math.round(location.speed_kmh)} km/h` : ''}${etaSuffix(eta)}`}
      </p>
    )
  }

  return (
    <p className="text-xs text-amber-400 flex items-center gap-1.5">
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
      // onPaid() flips the booking to `paid`, which re-renders SettledPaymentPanel;
      // that panel fetches the recorded status itself, so no read-back here.
      toast.success('Settlement recorded')
      onPaid()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to record settlement')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-card rounded-xl border border-border p-5 space-y-4">
      <h2 className="font-semibold text-foreground">Record settlement</h2>
      <p className="text-sm text-muted-foreground">
        Cargo has been delivered. Record how payment of{' '}
        <span className="font-semibold text-foreground">
          {'\u20B9'}{prefill.toLocaleString('en-IN')}
        </span>{' '}
        was settled.
      </p>

      {/* Mode selector */}
      <div>
        <label className="block text-xs font-semibold text-muted-foreground/70 uppercase tracking-wide mb-2">
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
                  ? 'border-emerald-400 bg-emerald-500/10 ring-1 ring-emerald-300'
                  : 'border-border hover:bg-secondary'
              }`}
            >
              <p className="text-sm font-medium text-foreground">{m.label}</p>
              <p className="text-xs text-muted-foreground/70">{m.hint}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Amount */}
      <div>
        <label className="block text-xs font-semibold text-muted-foreground/70 uppercase tracking-wide mb-1">
          Amount (&#8377;)
        </label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          min="1"
          step="1"
          className="w-full h-11 rounded-lg border border-border px-3 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
        />
      </div>

      {/* Reference (optional) */}
      <div>
        <label className="block text-xs font-semibold text-muted-foreground/70 uppercase tracking-wide mb-1">
          Reference <span className="normal-case font-normal text-muted-foreground/70">(optional)</span>
        </label>
        <input
          type="text"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="UPI txn ID / receipt no."
          maxLength={200}
          className="w-full h-11 rounded-lg border border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
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
  const modeLabel = payment
    ? (PAYMENT_MODES.find((m) => m.value === payment.mode)?.label ?? payment.mode)
    : null

  return (
    <div className="bg-emerald-500/10 rounded-xl border border-emerald-200 p-5 space-y-4">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <p className="font-semibold text-emerald-300">Payment settled</p>
          <p className="text-sm text-emerald-400">
            {'\u20B9'}{(payment?.amount ?? booking.final_price ?? booking.quoted_price).toLocaleString('en-IN')} recorded
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-emerald-400">
          <Spinner className="h-4 w-4 border-emerald-600 border-t-transparent" />
          Loading settlement details…
        </div>
      ) : error ? (
        <p className="text-sm text-emerald-400">
          Payment is recorded. Settlement details are momentarily unavailable.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 text-sm bg-card rounded-lg border border-emerald-100 p-4">
          <div>
            <p className="text-xs text-muted-foreground/70">Method</p>
            <p className="text-foreground font-medium">{modeLabel ?? '\u2014'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground/70">Reference</p>
            <p className="text-foreground font-medium break-all">{payment?.reference || '\u2014'}</p>
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
      <p className="text-xs text-muted-foreground/70">{label}</p>
      <p className={`text-foreground/85 ${capitalize ? 'capitalize' : ''}`}>{value}</p>
    </div>
  )
}
