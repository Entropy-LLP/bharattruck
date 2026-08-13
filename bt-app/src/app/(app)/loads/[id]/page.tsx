'use client'

/**
 * Load detail (ship surface — Phase 2 of docs/UNIFIED_APP_PLAN.md).
 *
 * Ported from shipper/src/app/bookings/[id]/page.tsx into bt-app's light house
 * style. The booking summary + consignee + receiver-email editor, the live-tracking
 * map, and the bids panel each fetch and render independently, so a failure in one
 * never blanks the others and NO sub-view can render blank:
 *
 *  - Booking (primary): Loading → NotFound(Empty) → Error(retry) → the record.
 *  - Tracking: the map ALWAYS draws pickup + drop from the booking's own coords, so
 *    it is never blank; the caption reflects loading / live / stale / delivered /
 *    error. Before a carrier is booked it shows a "tracking starts in transit" note
 *    instead of the map.
 *  - Bids (auction only): Loading → Empty("no bids yet") → Error → the list, with
 *    accept / counter / reject when the load is still open.
 */

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Phone } from 'lucide-react'

import { PageHeader } from '@/components/app-shell'
import { Card, CardHead, Empty, ErrorNote, Loading } from '@/components/stat'
import {
  ApiError,
  acceptQuote,
  cancelBooking,
  counterQuote,
  getBooking,
  getQuotes,
  getTrack,
  rejectQuote,
} from '@/lib/api'
import { bookingStatusConfig, quoteStatusConfig } from '@/lib/status'
import { dateTime, inr, shortDate } from '@/lib/format'
import type { Booking, Quote, TrackData, TrackEta, TrackLocation } from '@/lib/types'
import LiveTrackMap from '@/components/maps/LiveTrackMap'
import { ReceiverEmailSection } from '@/components/receiver-email-section'
import FreightDocuments from '@/components/freight-documents'
import PaymentSection from '@/components/payment-section'
import { NegotiationHistory } from '@/components/negotiation-history'
import { CounterModal } from '@/components/counter-modal'

const TRACKED_STATUSES = ['accepted', 'in_transit', 'delivery_asserted', 'completed', 'paid']

export default function LoadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [booking, setBooking] = useState<Booking | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [nonce, setNonce] = useState(0)

  const [cancelling, setCancelling] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setNotFound(false)
    getBooking(id)
      .then((b) => { if (!cancelled) setBooking(b) })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof ApiError && err.code === 'NOT_FOUND') setNotFound(true)
        else setError(err instanceof ApiError ? err.message : 'Could not load this load.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id, nonce])

  const backLink = (
    <Link href="/loads" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-3">
      <ArrowLeft className="w-4 h-4" /> My Loads
    </Link>
  )

  if (loading && !booking) {
    return (
      <div className="p-4 lg:p-6 max-w-4xl mx-auto">
        {backLink}
        <Loading label="Loading this load" />
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="p-4 lg:p-6 max-w-4xl mx-auto">
        {backLink}
        <Card>
          <Empty title="Load not found" hint="It may have been removed, or you may not have access to it. Head back to My Loads." />
        </Card>
      </div>
    )
  }

  if (error && !booking) {
    return (
      <div className="p-4 lg:p-6 max-w-4xl mx-auto">
        {backLink}
        <div className="space-y-3">
          <ErrorNote message={error} />
          <button onClick={reload} className="rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium px-4 py-2.5">
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (!booking) {
    return (
      <div className="p-4 lg:p-6 max-w-4xl mx-auto">
        {backLink}
        <Card><Empty title="Nothing to show" hint="The service returned no load." /></Card>
      </div>
    )
  }

  const status = bookingStatusConfig[booking.status] ?? bookingStatusConfig.pending
  // 'delivery_asserted' is a delivered-but-unconfirmed trip: only ops closure remains, so a shipper
  // Cancel here is not a valid action (the server refuses it) — hide it like the other post-pickup
  // states (review F2). Its predecessor in_transit is already excluded; this closes the gap.
  const canCancel = !['cancelled', 'completed', 'in_transit', 'delivery_asserted', 'paid'].includes(booking.status)
  const isTracked = TRACKED_STATUSES.includes(booking.status)

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto">
      {backLink}
      <PageHeader
        title="Load details"
        subtitle={booking.id}
        actions={
          <>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${status.color}`}>{status.label}</span>
            {canCancel && (
              <button
                onClick={() => setShowCancelConfirm(true)}
                className="text-sm text-red-600 border border-red-200 px-3 py-1.5 rounded-xl hover:bg-red-50 transition-colors"
              >
                Cancel
              </button>
            )}
          </>
        }
      />

      <div className="space-y-5">
        {/* Booking summary */}
        <Card>
          <div className="p-5">
            <div className="grid sm:grid-cols-2 gap-6">
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Route</h3>
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500 mt-1.5 shrink-0" />
                    <span className="text-sm text-gray-800">{booking.source_address}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500 mt-1.5 shrink-0" />
                    <span className="text-sm text-gray-800">{booking.destination_address}</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Detail label="Load type" value={booking.load_type} capitalize />
                <Detail label="Weight" value={`${booking.weight_kg.toLocaleString('en-IN')} kg`} />
                <Detail label="Quoted price" value={inr(booking.quoted_price)} />
                <Detail label="Booking type" value={booking.booking_type} capitalize />
                <Detail label="Pickup date" value={shortDate(booking.pickup_date)} />
                {booking.pickup_time_slot && <Detail label="Time slot" value={booking.pickup_time_slot} />}
                {booking.final_price != null && <Detail label="Final price" value={inr(booking.final_price)} />}
              </div>
            </div>

            {booking.consignee && (booking.consignee.name || booking.consignee.phone) && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Consignee</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-800">
                  <span className="font-medium">{booking.consignee.name ?? 'Unnamed consignee'}</span>
                  {booking.consignee.city && <span className="text-gray-500">{booking.consignee.city}</span>}
                  {booking.consignee.phone && (
                    <a href={`tel:${booking.consignee.phone}`} className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                      <Phone className="w-3.5 h-3.5" /> {booking.consignee.phone}
                    </a>
                  )}
                </div>
              </div>
            )}

            {booking.special_instructions && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Special instructions</p>
                <p className="text-sm text-gray-800">{booking.special_instructions}</p>
              </div>
            )}

            <ReceiverEmailSection booking={booking} onSaved={reload} />
          </div>
        </Card>

        {/* Freight documents (Phase 4): the shipper sees the LR the carrier raised and
            issues their own tax invoice, billed to the consignee. */}
        {booking.status !== 'cancelled' && <FreightDocuments booking={booking} onChanged={reload} />}

        {/* Payment: the closing step — record the cash/UPI/direct settlement on a
            completed trip (shipper only). Renders nothing until then, then the receipt. */}
        <PaymentSection booking={booking} onChanged={reload} />

        {/* Tracking */}
        {isTracked ? (
          <TripTrackingSection booking={booking} />
        ) : (
          <Card>
            <CardHead title="Tracking" />
            <div className="p-5">
              <p className="text-sm text-gray-500">
                {booking.status === 'cancelled'
                  ? 'This load was cancelled — there is no trip to track.'
                  : 'Live tracking starts once the trip is in transit.'}
              </p>
            </div>
          </Card>
        )}

        {/* Bids — auction only */}
        {booking.booking_type === 'auction' && (
          <QuotesPanel booking={booking} onBookingChanged={reload} />
        )}
      </div>

      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setShowCancelConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Cancel this load?</h3>
            <p className="text-sm text-gray-500 mb-6">This cannot be undone. Any pending bids are invalidated.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="flex-1 px-4 py-2.5 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50"
              >
                Keep load
              </button>
              <button
                onClick={async () => {
                  setCancelling(true)
                  try {
                    await cancelBooking(booking.id)
                    toast.success('Load cancelled')
                    router.push('/loads')
                  } catch (err: unknown) {
                    toast.error(err instanceof ApiError ? err.message : 'Could not cancel the load')
                    setCancelling(false)
                    setShowCancelConfirm(false)
                  }
                }}
                disabled={cancelling}
                className="flex-1 px-4 py-2.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded-xl disabled:opacity-50"
              >
                {cancelling ? 'Cancelling…' : 'Yes, cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Trip tracking ─────────────────────────────────────────────

/**
 * A fleet wins the auction as a COMPANY; the truck and driver are paired to the trip
 * afterwards in bt-fleet-service. Until then driver_id is NULL, so an `accepted`
 * fleet booking means "carrier locked in", NOT "driver assigned".
 */
function isAwaitingFleetDriver(booking: Booking): boolean {
  return !!booking.fleet_owner_id && !booking.driver_id
}

const STALE_AFTER_MS = 30_000

function ageText(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m ago`
}

function TripTrackingSection({ booking }: { booking: Booking }) {
  const [track, setTrack] = useState<TrackData | null>(null)
  const [pollError, setPollError] = useState(false)

  // One read-through call (LOCKED D-8) gives location + route + ETA + status. Fetch
  // once for any tracked status (so the route/pins show even before the trip starts),
  // then keep the 10s live poll (D-10) only while moving.
  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const t = await getTrack(booking.id)
        if (!cancelled) { setTrack(t); setPollError(false) }
      } catch {
        if (!cancelled) setPollError(true)
      }
    }
    poll()
    if (booking.status !== 'in_transit') return () => { cancelled = true }
    const interval = setInterval(poll, 10_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [booking.id, booking.status])

  const origin = useMemo(() => ({ lat: booking.source_lat, lng: booking.source_lng }), [booking.source_lat, booking.source_lng])
  const dest = useMemo(() => ({ lat: booking.dest_lat, lng: booking.dest_lng }), [booking.dest_lat, booking.dest_lng])

  const location = track?.location ?? null
  const delivered = booking.status === 'completed' || booking.status === 'paid'
  const ageMs = location ? Date.now() - new Date(location.updated_at).getTime() : Infinity
  const fresh = ageMs <= STALE_AFTER_MS
  const driverPt = !delivered && location ? { lat: location.lat, lng: location.lng } : null

  const steps = [
    { key: 'accepted', label: isAwaitingFleetDriver(booking) ? 'Carrier booked' : 'Driver assigned' },
    { key: 'in_transit', label: 'In transit' },
    { key: 'completed', label: 'Delivered' },
    { key: 'paid', label: 'Paid' },
  ]
  const currentIndex = steps.findIndex((s) => s.key === booking.status)

  return (
    <Card>
      <CardHead title="Trip status" />
      <div className="p-5 space-y-4">
        {/* Progress steps */}
        <div className="flex items-center gap-1">
          {steps.map((step, i) => {
            const done = i <= currentIndex
            return (
              <div key={step.key} className="flex-1 flex flex-col items-center gap-1">
                <div className={`h-1.5 w-full rounded-full ${done ? 'bg-green-500' : 'bg-gray-200'}`} />
                <span className={`text-xs ${done ? 'text-emerald-700 font-medium' : 'text-gray-400'}`}>{step.label}</span>
              </div>
            )
          })}
        </div>

        {/* The map always draws pickup + drop from the booking's own coords, so it is
            never blank even when there is no live fix or the track call failed. */}
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
          awaitingFleetDriver={isAwaitingFleetDriver(booking)}
          completedAt={booking.completed_at}
          location={location}
          eta={track?.eta ?? null}
          fresh={fresh}
          ageMs={ageMs}
          pollError={pollError}
        />
      </div>
    </Card>
  )
}

function etaSuffix(eta: TrackEta | null): string {
  if (!eta) return ''
  return ` · ETA ${eta.eta_text}${eta.stale ? ' (est.)' : ''}`
}

function TrackCaption({
  status, delivered, awaitingFleetDriver, completedAt, location, eta, fresh, ageMs, pollError,
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
      <p className="text-xs font-medium text-emerald-700">
        Delivered ✓{completedAt ? ` · ${dateTime(completedAt)}` : ''}
      </p>
    )
  }

  if (!location) {
    return (
      <p className="text-xs text-gray-500">
        {pollError
          ? 'Could not fetch live tracking — retrying…'
          : awaitingFleetDriver
            ? 'Carrier booked — waiting for the fleet to assign a truck and driver.'
            : status === 'accepted'
              ? 'Driver assigned — waiting for the trip to start.'
              : 'Waiting for the driver to start sharing location…'}
      </p>
    )
  }

  if (fresh) {
    return (
      <p className="text-xs text-gray-600 flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" />
        {`Live · updated ${ageText(ageMs)}${location.speed_kmh !== null ? ` · ${Math.round(location.speed_kmh)} km/h` : ''}${etaSuffix(eta)}`}
      </p>
    )
  }

  return (
    <p className="text-xs text-amber-700 flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
      {`Driver offline — last seen ${ageText(ageMs)}${etaSuffix(eta)}`}
    </p>
  )
}

// ── Bids panel ────────────────────────────────────────────────

function QuotesPanel({ booking, onBookingChanged }: { booking: Booking; onBookingChanged: () => void }) {
  const [quotes, setQuotes] = useState<Quote[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [counterQuoteId, setCounterQuoteId] = useState<string | null>(null)
  const [expandedQuote, setExpandedQuote] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) { setError(null); setQuotes(null) }
    try {
      const q = await getQuotes(booking.id)
      setQuotes(q)
      setError(null)
    } catch (err: unknown) {
      if (!opts?.silent) setError(err instanceof ApiError ? err.message : 'Could not load bids.')
    }
  }, [booking.id])

  useEffect(() => { load() }, [load])

  // Auto-refresh while the load is still open, so new bids appear without a reload.
  const pollable = booking.status === 'pending'
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    if (!pollable) return
    const interval = setInterval(() => loadRef.current({ silent: true }), 15_000)
    return () => clearInterval(interval)
  }, [pollable])

  async function act(fn: () => Promise<unknown>, okMsg: string) {
    setActionError(null)
    try {
      await fn()
      toast.success(okMsg)
      onBookingChanged()
      load({ silent: true })
    } catch (err: unknown) {
      setActionError(err instanceof ApiError ? err.message : 'That action could not be completed.')
    }
  }

  const openForBids = booking.status === 'pending' || booking.status === 'negotiating'

  return (
    <Card>
      <CardHead
        title={`Bids${quotes ? ` (${quotes.length})` : ''}`}
        sub={pollable ? 'Auto-refreshing every 15s' : undefined}
      />
      <div className="p-2">
        {actionError && <div className="p-2"><ErrorNote message={actionError} /></div>}

        {error && !quotes ? (
          <div className="p-3 space-y-3">
            <ErrorNote message={error} />
            <button onClick={() => load()} className="rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium px-4 py-2.5">
              Try again
            </button>
          </div>
        ) : !quotes ? (
          <Loading label="Loading bids" />
        ) : quotes.length === 0 ? (
          <Empty
            title="No bids yet"
            hint={openForBids ? 'Carriers will appear here as they bid on your load.' : 'This load received no bids.'}
          />
        ) : (
          <div className="divide-y divide-gray-100">
            {quotes.map((quote) => (
              <QuoteRow
                key={quote.id}
                bookingId={booking.id}
                quote={quote}
                actionable={openForBids && (quote.status === 'submitted' || quote.status === 'countered')}
                expanded={expandedQuote === quote.id}
                onToggle={() => setExpandedQuote((cur) => (cur === quote.id ? null : quote.id))}
                onAccept={() => act(() => acceptQuote(booking.id, quote.id), 'Bid accepted')}
                onReject={() => act(() => rejectQuote(booking.id, quote.id), 'Bid rejected')}
                onCounter={() => setCounterQuoteId(quote.id)}
              />
            ))}
          </div>
        )}
      </div>

      {counterQuoteId && (
        <CounterModal
          onClose={() => setCounterQuoteId(null)}
          onSubmit={async (amount, message) => {
            await counterQuote(booking.id, counterQuoteId, { amount, message })
            toast.success('Counter offer sent')
            onBookingChanged()
            load({ silent: true })
          }}
        />
      )}
    </Card>
  )
}

function QuoteRow({
  bookingId, quote, actionable, expanded, onToggle, onAccept, onReject, onCounter,
}: {
  bookingId: string
  quote: Quote
  actionable: boolean
  expanded: boolean
  onToggle: () => void
  onAccept: () => void
  onReject: () => void
  onCounter: () => void
}) {
  const qs = quoteStatusConfig[quote.status] ?? quoteStatusConfig.submitted
  return (
    <div className="px-3 py-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <div>
            <p className="text-xs text-gray-400">{carrierKindLabel(quote)}</p>
            <CarrierName quote={quote} />
          </div>
          <div>
            <p className="text-xs text-gray-400">Amount</p>
            <p className="font-semibold text-gray-900 tabular-nums">{inr(quote.amount)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Status</p>
            <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${qs.color}`}>
              {quote.status === 'accepted' ? 'Awarded ✓' : qs.label}
            </span>
          </div>
          <div>
            <p className="text-xs text-gray-400">Submitted</p>
            <p className="text-gray-700">{dateTime(quote.submitted_at)}</p>
          </div>
        </div>

        {actionable && (
          <div className="flex gap-2 shrink-0">
            <button onClick={onAccept} className="text-xs px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors">Accept</button>
            <button onClick={onCounter} className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">Counter</button>
            <button onClick={onReject} className="text-xs px-3 py-1.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors">Reject</button>
          </div>
        )}
      </div>

      <button onClick={onToggle} className="text-xs text-blue-600 hover:text-blue-700 mt-2">
        {expanded ? 'Hide' : 'View'} negotiation history
      </button>
      {expanded && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <NegotiationHistory bookingId={bookingId} quoteId={quote.id} />
        </div>
      )}
    </div>
  )
}

// A bid comes from EITHER a solo driver OR a fleet owner, and the quote row names
// only the one it came from. Prefer the server-resolved `carrier`; fall back to the
// id columns when it is absent — guessing "Driver" for a fleet bid is wrong.
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
  const fallback = kind === 'fleet' ? 'Fleet operator' : kind === 'driver' ? 'Independent driver' : 'Unknown carrier'
  const detail =
    carrier?.kind === 'driver'
      ? [
          carrier.truck_number,
          carrier.total_trips ? `${carrier.total_trips} trips` : null,
          carrier.average_rating ? `${carrier.average_rating.toFixed(1)}★` : null,
        ].filter(Boolean).join(' · ')
      : null
  return (
    <>
      <p className={`text-gray-800 ${carrier?.name ? 'font-medium' : 'italic'}`}>{carrier?.name ?? fallback}</p>
      {detail && <p className="text-xs text-gray-400">{detail}</p>}
    </>
  )
}

function Detail({ label, value, capitalize }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`text-gray-800 ${capitalize ? 'capitalize' : ''}`}>{value}</p>
    </div>
  )
}
