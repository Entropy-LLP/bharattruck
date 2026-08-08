'use client'

/**
 * Trip detail / Navigate (drive surface — Phase 3 of docs/UNIFIED_APP_PLAN.md).
 *
 * The driver's active-trip surface, ported from driver/src/app/(app)/bookings/[id]/page.tsx
 * into bt-app's light house style. It closes the trip end to end — start, drive, deliver —
 * and NO sub-view can render blank:
 *
 *  - Booking (primary): Loading → NotFound(Empty) → Error(retry) → the record.
 *  - Not-yours guard: a booking that isn't the caller's to drive shows a clear note, not
 *    the drive controls.
 *  - Accepted: Start trip (with a submitting state) + a Navigate deep-link to pickup.
 *  - In transit: live GPS push (~10s, guarded for permission-denied / unsupported), the
 *    route map (degrades to the guard's note, never blank), a Navigate deep-link to the
 *    drop, the receiver-OTP POD flow (handles "no receiver contact"), and trip insights
 *    (pumps / fuel / alerts — each with its own loading/empty/error).
 *  - Delivered / awaiting-confirmation / paid / cancelled: each a plain status card.
 *
 * The wake lock and the GPS watch are scoped to the in_transit branch ONLY — they mount
 * with the active trip and release on unmount. Nothing driver-runtime is registered
 * app-wide (a shipper opening bt-app never gets a wake lock or a GPS watch).
 */

import { use, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Navigation, Phone } from 'lucide-react'

import { PageHeader } from '@/components/app-shell'
import { Card, CardHead, Empty, ErrorNote, Loading } from '@/components/stat'
import { MapBoundary } from '@/components/map-guard'
import LiveTrackMap from '@/components/maps/LiveTrackMap'
import TripInsights from '@/components/trip-insights'
import DeliveryEvidence from '@/components/delivery-evidence'
import FreightDocuments from '@/components/freight-documents'
import {
  ApiError,
  getBooking,
  getPodContext,
  getRoute,
  pushLocation,
  requestPodOtp,
  verifyPodOtp,
  startTrip,
} from '@/lib/api'
import { buildNavDeepLink } from '@/lib/maps'
import { bookingStatusConfig } from '@/lib/status'
import { inr, shortDate } from '@/lib/format'
import { useScreenWakeLock } from '@/lib/use-wake-lock'
import type { Booking, BookingStatus, PodContext, RouteData } from '@/lib/types'

export default function TripDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [booking, setBooking] = useState<Booking | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [nonce, setNonce] = useState(0)

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
        else setError(err instanceof ApiError ? err.message : 'Could not load this trip.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id, nonce])

  const backLink = (
    <Link href="/my-trips" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-3">
      <ArrowLeft className="w-4 h-4" /> My Trips
    </Link>
  )

  if (loading && !booking) {
    return (
      <div className="p-4 lg:p-6 max-w-2xl mx-auto">
        {backLink}
        <Loading label="Loading this trip" />
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="p-4 lg:p-6 max-w-2xl mx-auto">
        {backLink}
        <Card>
          <Empty title="Trip not found" hint="It may have been reassigned, or you may not have access to it. Head back to My Trips." />
        </Card>
      </div>
    )
  }

  if (error && !booking) {
    return (
      <div className="p-4 lg:p-6 max-w-2xl mx-auto">
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
      <div className="p-4 lg:p-6 max-w-2xl mx-auto">
        {backLink}
        <Card><Empty title="Nothing to show" hint="The service returned no trip." /></Card>
      </div>
    )
  }

  const status = bookingStatusConfig[booking.status] ?? bookingStatusConfig.pending

  // Whether this human may DRIVE this trip. The relation block is the intended signal;
  // when it's absent (older backend) we stay permissive and let the server be the real
  // gate — startTrip / POD are all server-authorised, so a stale tab can't act anyway.
  const rel = booking.viewer?.relations
  const canDrive = rel === undefined || rel.includes('driver') || rel.includes('carrier')

  return (
    <div className="p-4 lg:p-6 max-w-2xl mx-auto">
      {backLink}
      <PageHeader
        title="Trip"
        subtitle={booking.id}
        actions={<span className={`text-xs font-medium px-2.5 py-1 rounded-full ${status.color}`}>{status.label}</span>}
      />

      <div className="space-y-5">
        <TripSummaryCard booking={booking} />
        {booking.status !== 'cancelled' && <TripStatusStepper status={booking.status} />}
        <TripActionSection booking={booking} canDrive={canDrive} onRefresh={reload} />
        {/* Freight documents (Phase 4): the trip's paperwork — LR / invoice / e-way bill.
            Page-level (not in the in_transit-only section) so it shows from 'accepted'
            through 'completed'; the carrier can raise the LR while accepted/in_transit. */}
        {booking.status !== 'cancelled' && <FreightDocuments booking={booking} onChanged={reload} />}
      </div>
    </div>
  )
}

// ── Summary ───────────────────────────────────────────────────

function TripSummaryCard({ booking }: { booking: Booking }) {
  return (
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
            <Detail label="Pickup date" value={shortDate(booking.pickup_date)} />
            {booking.pickup_time_slot && <Detail label="Time slot" value={booking.pickup_time_slot} />}
            {/* The API strips the money for an employed driver, so guard the read. */}
            {booking.final_price != null
              ? <Detail label="Payout" value={inr(booking.final_price)} />
              : booking.quoted_price != null && <Detail label="Freight" value={inr(booking.quoted_price)} />}
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
      </div>
    </Card>
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

// ── Status stepper ────────────────────────────────────────────

function stepIndexFor(status: BookingStatus): number {
  switch (status) {
    case 'accepted': return 0
    case 'in_transit': return 1
    case 'delivery_asserted': return 1 // reported, not yet confirmed
    case 'completed': return 2
    case 'paid': return 3
    default: return -1
  }
}

function TripStatusStepper({ status }: { status: BookingStatus }) {
  const steps = ['Assigned', 'In transit', 'Delivered', 'Paid']
  const current = stepIndexFor(status)
  return (
    <Card>
      <CardHead title="Trip status" />
      <div className="p-5">
        <div className="flex items-center gap-1">
          {steps.map((label, i) => {
            const done = i <= current
            return (
              <div key={label} className="flex-1 flex flex-col items-center gap-1">
                <div className={`h-1.5 w-full rounded-full ${done ? 'bg-green-500' : 'bg-gray-200'}`} />
                <span className={`text-xs ${done ? 'text-emerald-700 font-medium' : 'text-gray-400'}`}>{label}</span>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}

// ── Action section — chosen by status ─────────────────────────

function TripActionSection({
  booking, canDrive, onRefresh,
}: { booking: Booking; canDrive: boolean; onRefresh: () => void }) {
  if (booking.status === 'cancelled') {
    return (
      <Card>
        <div className="p-6 text-center">
          <p className="text-sm font-semibold text-gray-700">Trip cancelled</p>
          <p className="text-xs text-gray-500 mt-1">This trip is no longer active.</p>
        </div>
      </Card>
    )
  }

  if (!canDrive) {
    return (
      <Card>
        <div className="p-6 text-center">
          <p className="text-sm font-semibold text-gray-900">This trip isn&apos;t yours to drive</p>
          <p className="text-xs text-gray-500 mt-1">
            Only the assigned driver can start it or capture delivery.
          </p>
        </div>
      </Card>
    )
  }

  if (booking.status === 'accepted') {
    return <AcceptedTripSection booking={booking} onRefresh={onRefresh} />
  }

  if (booking.status === 'in_transit') {
    return <ActiveTripSection booking={booking} onRefresh={onRefresh} />
  }

  if (booking.status === 'delivery_asserted') {
    return <AssertedTripSection booking={booking} onRefresh={onRefresh} />
  }

  if (booking.status === 'completed') {
    return (
      <Card>
        <div className="p-6 text-center">
          <p className="text-sm font-semibold text-emerald-700">Delivered ✓</p>
          <p className="text-xs text-gray-500 mt-1">
            {booking.final_price != null
              ? `Delivered successfully — ${inr(booking.final_price)} awaiting payment.`
              : 'Delivered successfully. Awaiting payment.'}
          </p>
        </div>
      </Card>
    )
  }

  if (booking.status === 'paid') {
    return (
      <Card>
        <div className="p-6 text-center">
          <p className="text-sm font-semibold text-emerald-700">Payment received ✓</p>
          <p className="text-xs text-gray-500 mt-1">
            {booking.final_price != null ? `${inr(booking.final_price)} settled.` : 'This trip is settled.'}
          </p>
        </div>
      </Card>
    )
  }

  // pending / negotiating shouldn't reach My Trips, but never blank if one does.
  return (
    <Card>
      <div className="p-6 text-center">
        <p className="text-sm font-semibold text-gray-700">Not ready to drive yet</p>
        <p className="text-xs text-gray-500 mt-1">This trip isn&apos;t assigned for driving at the moment.</p>
      </div>
    </Card>
  )
}

// ── Navigate deep-link ────────────────────────────────────────
//
// FROZEN Maps contract: navigation is a deep-link handoff to the phone's Google Maps
// app — NO in-app turn-by-turn. Destination-only, so Google Maps uses the device's live
// location as the start. The target follows the leg: PICKUP while 'accepted', DROP once
// 'in_transit'. It is a plain <a href> — a link is never blank.

function NavigateButton({ booking }: { booking: Booking }) {
  const toPickup = booking.status === 'accepted'
  const destination = toPickup
    ? { lat: booking.source_lat, lng: booking.source_lng }
    : { lat: booking.dest_lat, lng: booking.dest_lng }
  const label = toPickup ? 'Navigate to pickup' : 'Navigate to delivery'

  return (
    <a
      href={buildNavDeepLink({ destination })}
      target="_blank"
      rel="noopener noreferrer"
      className="w-full h-12 rounded-xl border-2 border-blue-600 text-blue-700 hover:bg-blue-50 font-semibold text-base transition-colors flex items-center justify-center gap-2"
    >
      <Navigation className="w-5 h-5" />
      {label}
    </a>
  )
}

// ── Accepted: Start Trip ──────────────────────────────────────

function AcceptedTripSection({ booking, onRefresh }: { booking: Booking; onRefresh: () => void }) {
  const [starting, setStarting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  async function handleStart() {
    setStarting(true)
    try {
      await startTrip(booking.id)
      toast.success('Trip started — GPS tracking is now active')
      onRefresh()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not start the trip')
      setStarting(false)
      setShowConfirm(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="p-5">
          <p className="text-sm font-semibold text-emerald-700">You&apos;re assigned this trip</p>
          <p className="text-xs text-gray-500 mt-0.5">Load up at the pickup, then start the trip to begin sharing your location.</p>

          <div className="mt-4 rounded-xl bg-gray-50 border border-gray-100 p-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">From</span>
              <span className="font-medium text-gray-900 text-right truncate max-w-[70%]">{booking.source_address}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">To</span>
              <span className="font-medium text-gray-900 text-right truncate max-w-[70%]">{booking.destination_address}</span>
            </div>
          </div>

          {!showConfirm ? (
            <button
              onClick={() => setShowConfirm(true)}
              className="mt-4 w-full h-12 rounded-xl bg-green-600 hover:bg-green-700 text-white font-semibold text-base transition-colors"
            >
              Start Trip
            </button>
          ) : (
            <div className="mt-4 space-y-2">
              <p className="text-sm text-gray-700 text-center font-medium">
                Confirm you&apos;ve loaded the cargo and are ready to depart?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowConfirm(false)}
                  disabled={starting}
                  className="flex-1 h-11 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium text-sm disabled:opacity-50"
                >
                  Not yet
                </button>
                <button
                  onClick={handleStart}
                  disabled={starting}
                  className="flex-1 h-11 rounded-xl bg-green-600 hover:bg-green-700 text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {starting && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {starting ? 'Starting…' : 'Yes, start trip'}
                </button>
              </div>
            </div>
          )}
        </div>
      </Card>

      <NavigateButton booking={booking} />
    </div>
  )
}

// ── In transit: active trip (GPS, map, POD) ───────────────────

type DeliverPhase = 'idle' | 'confirm' | 'sent'

// Persist the 'awaiting receiver confirmation' state across reloads/remounts. Ephemeral
// useState would reset to idle on a reload and tempt a re-tap that silently issues a NEW
// code, invalidating the one the receiver is already typing. We stamp a per-booking
// localStorage record when the code is sent; a remount restores 'sent' from it, and
// re-issuing a code requires the explicit "Resend delivery code" action.
type AwaitingRecord = { receiver_email: string | null; sent_at: number }

function awaitingKey(bookingId: string): string { return `bt-app-pod-awaiting:${bookingId}` }

function readAwaiting(bookingId: string): AwaitingRecord | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(awaitingKey(bookingId))
    return raw ? (JSON.parse(raw) as AwaitingRecord) : null
  } catch { return null }
}

function writeAwaiting(bookingId: string, rec: AwaitingRecord): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(awaitingKey(bookingId), JSON.stringify(rec)) } catch { /* storage may be unavailable */ }
}

function clearAwaiting(bookingId: string): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.removeItem(awaitingKey(bookingId)) } catch { /* non-fatal */ }
}

function ActiveTripSection({ booking, onRefresh }: { booking: Booking; onRefresh: () => void }) {
  const [deliverPhase, setDeliverPhase] = useState<DeliverPhase>('idle')
  const [podContext, setPodContext] = useState<PodContext | null>(null)
  const [loadingContext, setLoadingContext] = useState(false)
  const [sending, setSending] = useState(false)
  // The code the driver types in — the receiver reads it out at the drop. Verifying it is
  // what actually closes the trip (the old flow only polled and had NOWHERE to enter it).
  const [otpInput, setOtpInput] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [gpsActive, setGpsActive] = useState(false)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState('')

  // The driver's OWN position, held locally for the map — no round trip, and it keeps
  // updating through the network dead zones where a driver most needs the map.
  const [selfPos, setSelfPos] = useState<{ lat: number; lng: number } | null>(null)
  const [route, setRoute] = useState<RouteData | null>(null)

  // Keep the screen awake for the whole in-transit trip so the OS doesn't throttle
  // background GPS (frozen D-008). SCOPED here: this section renders only while
  // in_transit, so the lock releases the moment the trip closes or we navigate away —
  // nothing app-wide. A shipper never reaches this branch.
  useScreenWakeLock(booking.status === 'in_transit')

  // Live GPS push (~10s). Best-effort, never blocks the trip flow; guarded so a denied
  // or unsupported permission shows a clear message instead of a blank or a crash. When
  // the trip flips to completed this section unmounts and the watch is cleared here.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsError('Location sharing is unavailable on this device — it activates on a phone with GPS.')
      return
    }

    let gotFix = false
    const timeoutId = setTimeout(() => {
      if (!gotFix) {
        setGpsError('Location unavailable on this device — tracking will activate on a mobile with GPS.')
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
        pushLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          heading: position.coords.heading ?? undefined,
          speed_kmh: position.coords.speed ? position.coords.speed * 3.6 : undefined,
          accuracy_m: position.coords.accuracy ?? undefined,
          booking_id: booking.id,
        }).catch(() => {
          // silent — a dropped push must never interrupt the drive
        })
      },
      (err) => {
        if (err.code === 1) {
          clearTimeout(timeoutId)
          setGpsError('Location access denied — enable location for this site to share your position.')
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
  }, [booking.id, booking.status])

  // Road geometry for the map — one call per trip, best-effort. A failure leaves `route`
  // null and the map draws pickup, drop and the truck without the road line: a degraded
  // map, not a broken trip, so it's deliberately not surfaced as an error.
  useEffect(() => {
    let cancelled = false
    getRoute(booking.id)
      .then((r) => { if (!cancelled) setRoute(r) })
      .catch(() => { /* silent — the map degrades to markers-only */ })
    return () => { cancelled = true }
  }, [booking.id])

  // Elapsed time since the trip went in transit.
  useEffect(() => {
    const start = new Date(booking.in_transit_at ?? booking.updated_at ?? Date.now()).getTime()
    function update() {
      const diff = Date.now() - start
      const h = Math.floor(diff / 3_600_000)
      const m = Math.floor((diff % 3_600_000) / 60_000)
      setElapsed(h > 0 ? `${h}h ${m}m` : `${m}m`)
    }
    update()
    const id = setInterval(update, 30_000)
    return () => clearInterval(id)
  }, [booking.in_transit_at, booking.updated_at])

  // Restore the awaiting state on mount so a reload doesn't reset to idle. Done in an
  // effect (not useState init) to stay SSR/hydration-safe.
  useEffect(() => {
    const rec = readAwaiting(booking.id)
    if (rec) {
      setPodContext({ booking_id: booking.id, status: 'in_transit', receiver_email: rec.receiver_email })
      setDeliverPhase('sent')
    }
  }, [booking.id])

  // POD completion is out-of-band: once the code is sent, the receiver's verify drives
  // booking-service in_transit → completed. Poll the booking until it flips, clear the
  // persisted awaiting record, then refresh (this section unmounts, the completed card renders).
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

  async function handleFetchContext() {
    setLoadingContext(true)
    try {
      const ctx = await getPodContext(booking.id)
      setPodContext(ctx)
      setDeliverPhase('confirm')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not start delivery capture')
    } finally {
      setLoadingContext(false)
    }
  }

  async function handleSendOtp() {
    setSending(true)
    try {
      await requestPodOtp(booking.id)
      writeAwaiting(booking.id, { receiver_email: podContext?.receiver_email ?? null, sent_at: Date.now() })
      setDeliverPhase('sent')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not send the delivery code')
    } finally {
      setSending(false)
    }
  }

  async function handleResend() {
    setSending(true)
    setVerifyError(null)
    try {
      await requestPodOtp(booking.id)
      writeAwaiting(booking.id, { receiver_email: podContext?.receiver_email ?? null, sent_at: Date.now() })
      toast.success('Delivery code re-sent')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not resend the delivery code')
    } finally {
      setSending(false)
    }
  }

  // The driver enters the code the receiver gives them; verifying it closes the trip.
  // This is the completion path the grafted flow was missing — it only polled, so the
  // code the receiver read out had nowhere to go.
  async function handleVerify(e: FormEvent) {
    e.preventDefault()
    const code = otpInput.trim()
    if (!/^\d{6}$/.test(code)) {
      setVerifyError('Enter the 6-digit code the receiver gives you.')
      return
    }
    setVerifying(true)
    setVerifyError(null)
    try {
      await verifyPodOtp(booking.id, code)
      clearAwaiting(booking.id)
      toast.success('Delivery confirmed')
      onRefresh() // trip is now completed — this section unmounts, the completed card renders
    } catch (err) {
      // Wrong / expired / too-many-attempts all surface here. Keep the box so the driver
      // can re-read the code (or resend); never blank, never a silent failure.
      setVerifyError(err instanceof ApiError ? err.message : 'That code did not work. Ask the receiver to read it again, or resend.')
    } finally {
      setVerifying(false)
    }
  }

  function handleCancelAwaiting() {
    clearAwaiting(booking.id)
    setDeliverPhase('idle')
    setOtpInput('')
    setVerifyError(null)
  }

  const receiverEmail = podContext?.receiver_email ?? null

  const origin = useMemo(
    () => ({ lat: booking.source_lat, lng: booking.source_lng }),
    [booking.source_lat, booking.source_lng],
  )
  const dest = useMemo(
    () => ({ lat: booking.dest_lat, lng: booking.dest_lng }),
    [booking.dest_lat, booking.dest_lng],
  )

  // Runtime coord guard: a null slipping through the type would render a map at (0,0) —
  // the Gulf of Guinea — which looks like a working map showing the wrong thing.
  const hasCoords =
    Number.isFinite(booking.source_lat) && Number.isFinite(booking.source_lng) &&
    Number.isFinite(booking.dest_lat) && Number.isFinite(booking.dest_lng)

  return (
    <div className="space-y-4">
      <Card>
        <div className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900">Trip in progress</h3>
            {elapsed && <span className="text-xs font-medium text-gray-500 tabular-nums">{elapsed}</span>}
          </div>

          {/* GPS status — always says something, never blank. */}
          <div className={`flex items-center gap-2 rounded-xl p-2.5 mb-3 border ${
            gpsActive ? 'bg-emerald-50 border-emerald-200'
              : gpsError ? 'bg-gray-50 border-gray-200'
                : 'bg-amber-50 border-amber-200'
          }`}>
            <span className={`w-2 h-2 rounded-full shrink-0 ${
              gpsActive ? 'bg-green-500 animate-pulse' : gpsError ? 'bg-gray-400' : 'bg-amber-500 animate-pulse'
            }`} />
            <span className={`text-xs font-medium ${
              gpsActive ? 'text-emerald-700' : gpsError ? 'text-gray-600' : 'text-amber-700'
            }`}>
              {gpsActive ? 'Location active — sharing with the shipper' : gpsError ?? 'Acquiring location…'}
            </span>
          </div>

          <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-sm mb-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Delivering to</p>
            <p className="font-medium text-gray-900">{booking.destination_address}</p>
          </div>

          {/* Proof-of-delivery, three steps: (idle) Mark as delivered → send a code to the
              receiver → (sent) the driver enters the code the receiver reads out and CONFIRMS,
              which verifies it and closes the trip. A background poll also closes it if the
              receiver instead enters the code on their own device. The trip is never closed
              without a verified code. */}
          {deliverPhase === 'idle' && (
            <button
              onClick={handleFetchContext}
              disabled={loadingContext}
              className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-base transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loadingContext && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {loadingContext ? 'Preparing…' : 'Mark as delivered'}
            </button>
          )}

          {deliverPhase === 'confirm' && (
            <div className="space-y-3">
              <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-sm">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Delivery code will be sent to</p>
                {receiverEmail ? (
                  <p className="font-medium text-gray-900 break-all">{receiverEmail}</p>
                ) : (
                  <p className="font-medium text-red-600">
                    No receiver contact set — the shipper must add one to confirm delivery.
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setDeliverPhase('idle')}
                  disabled={sending}
                  className="flex-1 h-11 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium text-sm disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendOtp}
                  disabled={sending || !receiverEmail}
                  className="flex-1 h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {sending && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {sending ? 'Sending…' : 'Send delivery code'}
                </button>
              </div>
            </div>
          )}

          {deliverPhase === 'sent' && (
            <form onSubmit={handleVerify} className="rounded-xl bg-blue-50 border border-blue-100 p-4 space-y-3">
              <p className="text-sm font-semibold text-blue-900">Enter the delivery code</p>
              <p className="text-sm text-gray-600">
                A code was sent to{' '}
                <span className="font-medium text-gray-900 break-all">{receiverEmail ?? 'the receiver'}</span>.
                Ask them to read it out and enter it below.
              </p>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otpInput}
                onChange={(e) => { setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6)); setVerifyError(null) }}
                placeholder="6-digit code"
                aria-label="Delivery code"
                className="w-full h-12 rounded-xl border border-gray-300 bg-white px-4 text-center text-lg font-semibold tracking-[0.4em] text-gray-900 placeholder:tracking-normal placeholder:font-normal placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {verifyError && <p className="text-sm text-red-600">{verifyError}</p>}
              <button
                type="submit"
                disabled={verifying || otpInput.length !== 6}
                className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-base disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {verifying && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {verifying ? 'Confirming…' : 'Confirm delivery'}
              </button>
              <p className="text-xs text-gray-400 text-center">
                Or the receiver enters it on their phone to close it.
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCancelAwaiting}
                  disabled={sending || verifying}
                  className="flex-1 h-10 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium text-sm disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={sending || verifying}
                  className="flex-1 h-10 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 font-medium text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {sending && <span className="w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />}
                  {sending ? 'Sending…' : 'Resend code'}
                </button>
              </div>
            </form>
          )}
        </div>
      </Card>

      {/* Delivery evidence + assert/discrepancy (Phase 3b). Complements the OTP flow above:
          the OTP is the confirmed tier; this captures the photo evidence and owns the
          no-confirmation (asserted) branch. Its own card — it never blanks the controls above. */}
      <DeliveryEvidence booking={booking} currentPos={selfPos} onChanged={onRefresh} />

      {/* The map always draws pickup + drop from the booking's own coords, so it is never
          blank even with no live fix or route; it degrades to the guard's note on a key
          problem. A booking without coordinates simply renders no map. */}
      {hasCoords && (
        <LiveTrackMap
          origin={origin}
          dest={dest}
          encodedPolyline={route?.polyline}
          bounds={route?.bounds}
          driver={selfPos}
        />
      )}

      <NavigateButton booking={booking} />

      {/* Pumps / fuel / alerts. Each card owns its loading/empty/error; nothing here can
          blank the trip controls above. Boundaried as belt-and-braces so an unexpected
          server shape throwing during render can't unmount Mark-as-Delivered with it. */}
      <MapBoundary
        fallback={
          <p className="text-xs text-gray-500 px-1">
            Trip insights are unavailable right now. Your delivery controls above are unaffected.
          </p>
        }
      >
        <TripInsights bookingId={booking.id} />
      </MapBoundary>
    </div>
  )
}

// ── Delivery asserted: awaiting ops confirmation ──────────────
//
// The driver reported the delivery without a receiver-confirmed code (migration 0025).
// The evidence card carries the awaiting-confirmation banner, shows the captured photos,
// and still lets the driver add a photo or log a discrepancy if ops asks — the backend
// keeps evidence capturable in this state. No GPS watch runs here, so the evidence card
// takes its own one-shot fix at capture (currentPos is null).

function AssertedTripSection({ booking, onRefresh }: { booking: Booking; onRefresh: () => void }) {
  return <DeliveryEvidence booking={booking} currentPos={null} onChanged={onRefresh} />
}
