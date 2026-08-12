'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  createBooking,
  getPriceQuote,
  priceQuoteBasis,
  priceQuoteHeading,
  quoteKindOf,
  ApiError,
  type PriceQuote,
  type PriceQuoteLoadType,
  type PriceQuoteVehicleType,
} from '@/lib/api'
import type { BookingType } from '@/lib/types'
import Navbar from '@/components/Navbar'
import Spinner from '@/components/Spinner'

// Reconciled to bt-pricing-service's load_type enum so the SAME value flows to
// both the quote and the booking (bookings.load_type is free text — safe).
const LOAD_TYPES: { value: PriceQuoteLoadType; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'fragile', label: 'Fragile' },
  { value: 'perishable', label: 'Perishable' },
  { value: 'hazardous', label: 'Hazardous' },
  { value: 'heavy_machinery', label: 'Heavy Machinery' },
]

const VEHICLE_TYPES: { value: PriceQuoteVehicleType; label: string }[] = [
  { value: 'mini_truck', label: 'Mini Truck' },
  { value: 'lcv', label: 'LCV' },
  { value: 'hcv', label: 'HCV' },
  { value: 'trailer', label: 'Trailer' },
]

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

export default function NewBookingPage() {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [quoting, setQuoting] = useState(false)
  const [bookingType, setBookingType] = useState<BookingType>('auction')

  // Quote-affecting fields are controlled so we can (a) build the quote request
  // and (b) invalidate a stale lock the moment any of them changes. The route
  // coords drive the quote AND the booking: distance_km is DERIVED server-side
  // from them (the shipper never types a distance), and the SAME coords are sent
  // on booking-create so the booking binds to exactly what was priced.
  const [sourceLat, setSourceLat] = useState('')
  const [sourceLng, setSourceLng] = useState('')
  const [destLat, setDestLat] = useState('')
  const [destLng, setDestLng] = useState('')
  const [vehicleType, setVehicleType] = useState<PriceQuoteVehicleType>('lcv')
  const [loadType, setLoadType] = useState<PriceQuoteLoadType>('general')
  const [weightKg, setWeightKg] = useState('')

  // The locked quote (null until "Get Quote" succeeds; cleared on any change).
  const [quote, setQuote] = useState<PriceQuote | null>(null)

  // Any change to a quote-affecting field invalidates the stored lock so a
  // stale price can never be submitted.
  function invalidateQuote() {
    if (quote) setQuote(null)
  }

  // booking_type is a quote-affecting field now that the server classifies the
  // quote by it, so switching the toggle has to drop the lock like any other.
  // Without this the shipper could price as an auction (persisted advisory) and
  // submit as direct, leaving the consumed price_quotes row asserting the exact
  // opposite of the booking it paid for — the same defect as the one this change
  // fixes, only pointed the other way.
  function changeBookingType(next: BookingType) {
    if (next === bookingType) return
    setBookingType(next)
    invalidateQuote()
  }

  async function handleGetQuote() {
    const sLat = parseFloat(sourceLat)
    const sLng = parseFloat(sourceLng)
    const dLat = parseFloat(destLat)
    const dLng = parseFloat(destLng)
    const weight = parseFloat(weightKg)
    if (![sLat, sLng, dLat, dLng].every(Number.isFinite)) {
      toast.error('Enter valid pickup & drop coordinates before getting a quote')
      return
    }
    if (!Number.isFinite(weight) || weight <= 0) {
      toast.error('Enter a valid weight (kg) before getting a quote')
      return
    }

    setQuoting(true)
    try {
      const q = await getPriceQuote({
        source_lat: sLat,
        source_lng: sLng,
        dest_lat: dLat,
        dest_lng: dLng,
        vehicle_type: vehicleType,
        load_type: loadType,
        weight_kg: weight,
        // The server cannot infer this, and omitting it is not neutral: the wire
        // default is `binding`, so an auction quoted without it is PERSISTED as
        // a binding one — a stored claim that the platform charges that freight,
        // on the one booking type where it must never claim that
        // (INDIA_FREIGHT_COMPLIANCE.md §1.3 red line 3). The form already knows
        // the answer; it just used to keep it to itself and re-label the panel
        // locally, which fixed the pixels and left the record wrong.
        booking_type: bookingType,
      })
      setQuote(q)
      // The server decides whether the number is locked; bookingType is only the
      // fallback for a pre-D-11 server (see quoteKindOf).
      toast.success(quoteKindOf(q, bookingType) === 'advisory' ? 'Estimate ready' : 'Price locked')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to get a quote')
    } finally {
      setQuoting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!quote) {
      // "a price quote", not "a locked price": on an auction it is not locked, and
      // the copy in this flow should never imply the platform is pricing the trip.
      toast.error('Get a price quote before creating the booking')
      return
    }

    const weight = parseFloat(weightKg)
    if (!Number.isFinite(weight) || weight <= 0) {
      toast.error('Enter a valid weight (kg)')
      return
    }

    const form = new FormData(e.currentTarget)

    const payload = {
      source_address: form.get('source_address') as string,
      // Same controlled coords + cargo that were priced, so the booking binds to
      // the locked quote (server rejects any mismatch).
      source_lat: parseFloat(sourceLat),
      source_lng: parseFloat(sourceLng),
      destination_address: form.get('destination_address') as string,
      dest_lat: parseFloat(destLat),
      dest_lng: parseFloat(destLng),
      load_type: loadType,
      weight_kg: weight,
      // Same vehicle_type that was priced, so the booking binds to the locked quote.
      vehicle_type: vehicleType,
      quote_id: quote.quote_id,
      pickup_date: form.get('pickup_date') as string,
      pickup_time_slot: (form.get('pickup_time_slot') as string) || undefined,
      special_instructions: (form.get('special_instructions') as string) || undefined,
      receiver_email: form.get('receiver_email') as string,
      booking_type: bookingType,
      target_driver_id: bookingType === 'direct'
        ? (form.get('target_driver_id') as string) || undefined
        : undefined,
      auction_deadline: bookingType === 'auction'
        ? ((val) => val ? new Date(val).toISOString() : undefined)(form.get('auction_deadline') as string)
        : undefined,
    }

    setSubmitting(true)
    try {
      const booking = await createBooking(payload)
      toast.success('Booking created!')
      router.push(`/bookings/${booking.id}`)
    } catch (err: unknown) {
      // FB-04: GSTIN missing — send them to Settings instead of a dead-end toast.
      if (err instanceof ApiError && /GSTIN/i.test(err.message)) {
        toast.error(err.message, {
          action: {
            label: 'Open Settings',
            onClick: () => router.push('/settings'),
          },
        })
      } else if (err instanceof ApiError && (err.code === 'VALIDATION_ERROR' || err.code === 'INVALID_TRANSITION')) {
        // Expired (VALIDATION_ERROR) or already-used (INVALID_TRANSITION) lock:
        // drop it and make the shipper re-fetch a fresh quote.
        setQuote(null)
        toast.error('Your locked price is no longer valid — please get a new quote')
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to create booking')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass = 'w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
  const labelClass = 'block text-sm font-medium text-foreground/85 mb-1'

  return (
    <>
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <h1 className="text-xl font-bold text-foreground mb-6">Create New Booking</h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Source */}
          <fieldset className="bg-card rounded-xl border border-border p-5 space-y-4">
            <legend className="text-sm font-semibold text-foreground px-1">Pickup Location</legend>
            <div>
              <label htmlFor="source_address" className={labelClass}>Address</label>
              <input id="source_address" name="source_address" required className={inputClass} placeholder="e.g. 45 MG Road, Mumbai" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="source_lat" className={labelClass}>Latitude</label>
                <input
                  id="source_lat"
                  type="number"
                  step="any"
                  required
                  value={sourceLat}
                  onChange={(e) => { setSourceLat(e.target.value); invalidateQuote() }}
                  className={inputClass}
                  placeholder="19.0760"
                />
              </div>
              <div>
                <label htmlFor="source_lng" className={labelClass}>Longitude</label>
                <input
                  id="source_lng"
                  type="number"
                  step="any"
                  required
                  value={sourceLng}
                  onChange={(e) => { setSourceLng(e.target.value); invalidateQuote() }}
                  className={inputClass}
                  placeholder="72.8777"
                />
              </div>
            </div>
          </fieldset>

          {/* Destination */}
          <fieldset className="bg-card rounded-xl border border-border p-5 space-y-4">
            <legend className="text-sm font-semibold text-foreground px-1">Drop Location</legend>
            <div>
              <label htmlFor="destination_address" className={labelClass}>Address</label>
              <input id="destination_address" name="destination_address" required className={inputClass} placeholder="e.g. 12 Brigade Road, Bangalore" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="dest_lat" className={labelClass}>Latitude</label>
                <input
                  id="dest_lat"
                  type="number"
                  step="any"
                  required
                  value={destLat}
                  onChange={(e) => { setDestLat(e.target.value); invalidateQuote() }}
                  className={inputClass}
                  placeholder="12.9716"
                />
              </div>
              <div>
                <label htmlFor="dest_lng" className={labelClass}>Longitude</label>
                <input
                  id="dest_lng"
                  type="number"
                  step="any"
                  required
                  value={destLng}
                  onChange={(e) => { setDestLng(e.target.value); invalidateQuote() }}
                  className={inputClass}
                  placeholder="77.5946"
                />
              </div>
            </div>
            <div>
              <label htmlFor="receiver_email" className={labelClass}>Receiver&apos;s email (for delivery confirmation)</label>
              <input id="receiver_email" name="receiver_email" type="email" required className={inputClass} placeholder="e.g. consignee@example.com" />
              <p className="mt-1 text-xs text-muted-foreground">The person receiving the goods enters a code emailed here to confirm delivery.</p>
            </div>
          </fieldset>

          {/* Cargo Details — these drive the price quote */}
          <fieldset className="bg-card rounded-xl border border-border p-5 space-y-4">
            <legend className="text-sm font-semibold text-foreground px-1">Cargo &amp; Vehicle</legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="vehicle_type" className={labelClass}>Vehicle Type</label>
                <select
                  id="vehicle_type"
                  value={vehicleType}
                  onChange={(e) => { setVehicleType(e.target.value as PriceQuoteVehicleType); invalidateQuote() }}
                  className={inputClass}
                >
                  {VEHICLE_TYPES.map((v) => (
                    <option key={v.value} value={v.value}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="load_type" className={labelClass}>Load Type</label>
                <select
                  id="load_type"
                  value={loadType}
                  onChange={(e) => { setLoadType(e.target.value as PriceQuoteLoadType); invalidateQuote() }}
                  className={inputClass}
                >
                  {LOAD_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="weight_kg" className={labelClass}>Weight (kg)</label>
                <input
                  id="weight_kg"
                  type="number"
                  min="1"
                  value={weightKg}
                  onChange={(e) => { setWeightKg(e.target.value); invalidateQuote() }}
                  className={inputClass}
                  placeholder="5000"
                />
              </div>
              <div className="flex items-end">
                <p className="text-xs text-muted-foreground pb-2">
                  Distance is calculated from the pickup &amp; drop coordinates above.
                </p>
              </div>
            </div>

            {/* Get Quote + locked-price panel */}
            <div className="pt-1">
              <button
                type="button"
                onClick={handleGetQuote}
                disabled={quoting}
                className="w-full bg-primary text-primary-foreground rounded-lg py-2.5 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {quoting && <Spinner className="h-4 w-4 border-white border-t-transparent" />}
                {quoting ? 'Getting price…' : quote ? 'Refresh Quote' : 'Get Quote'}
              </button>

              {quote && (
                <div className="mt-4 rounded-lg border border-green-200 bg-emerald-500/10 p-4">
                  <div className="flex items-baseline justify-between">
                    {/* The QUOTE decides the wording, not this form's toggle: the
                        toggle is what the shipper is about to book, quote_kind is
                        what the server actually classified and stored, and the panel
                        should show the record. bookingType is passed only as the
                        fallback for a server that predates D-11 and sends no
                        quote_kind — see quoteKindOf(). */}
                    <span className="text-sm font-semibold text-foreground">
                      {priceQuoteHeading(quote, bookingType)}
                    </span>
                    <span className="text-lg font-bold text-emerald-400">{inr(quote.quoted_price)}</span>
                  </div>
                  <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
                    <div className="flex justify-between text-muted-foreground"><dt>Distance (est.)</dt><dd>{quote.breakdown.distance_km} km</dd></div>
                    <div className="flex justify-between"><dt>Fuel</dt><dd>{inr(quote.breakdown.fuel_cost)}</dd></div>
                    <div className="flex justify-between"><dt>Driver wage</dt><dd>{inr(quote.breakdown.driver_wage)}</dd></div>
                    <div className="flex justify-between"><dt>Per-km operating</dt><dd>{inr(quote.breakdown.per_km_operating_cost)}</dd></div>
                    <div className="flex justify-between"><dt>Handling</dt><dd>{inr(quote.breakdown.handling)}</dd></div>
                    <div className="flex justify-between border-t border-green-200 pt-1"><dt>Platform fee</dt><dd>{inr(quote.platform_fee)}</dd></div>
                    <div className="flex justify-between text-muted-foreground"><dt>Vehicle class</dt><dd>{quote.breakdown.vehicle_class}</dd></div>
                  </dl>
                  {/* The server authors this sentence (PriceQuote.basis) and ships it
                      with the number it describes, so the disclosure cannot drift from
                      the arithmetic or be dropped by a client that forgot it mattered.
                      priceQuoteBasis() falls back to matching local copy only against a
                      server that predates D-11. Expiry is appended here because it is a
                      property of this lock, not of the pricing posture. */}
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    {priceQuoteBasis(quote, bookingType)}{' '}
                    {quoteKindOf(quote, bookingType) === 'advisory' ? 'Estimate' : 'Price'} valid until{' '}
                    {new Date(quote.expires_at).toLocaleString('en-IN')}.
                  </p>
                </div>
              )}
            </div>
          </fieldset>

          {/* Schedule */}
          <fieldset className="bg-card rounded-xl border border-border p-5 space-y-4">
            <legend className="text-sm font-semibold text-foreground px-1">Schedule</legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="pickup_date" className={labelClass}>Pickup Date</label>
                <input id="pickup_date" name="pickup_date" type="date" required className={inputClass} />
              </div>
              <div>
                <label htmlFor="pickup_time_slot" className={labelClass}>Time Slot (optional)</label>
                <input id="pickup_time_slot" name="pickup_time_slot" className={inputClass} placeholder="e.g. 9 AM - 12 PM" />
              </div>
            </div>
            <div>
              <label htmlFor="special_instructions" className={labelClass}>Special Instructions (optional)</label>
              <textarea id="special_instructions" name="special_instructions" rows={3} className={inputClass} placeholder="Any special handling requirements..." />
            </div>
          </fieldset>

          {/* Booking Type */}
          <fieldset className="bg-card rounded-xl border border-border p-5 space-y-4">
            <legend className="text-sm font-semibold text-foreground px-1">Booking Type</legend>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="booking_type_radio"
                  checked={bookingType === 'auction'}
                  onChange={() => changeBookingType('auction')}
                  className="text-primary"
                />
                {/* Fleet owners bid on auctions too — "all drivers" understates who
                    the load actually goes out to. Direct stays driver-only: it
                    targets one drivers.id. */}
                <span className="text-sm">Auction (open to all carriers)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="booking_type_radio"
                  checked={bookingType === 'direct'}
                  onChange={() => changeBookingType('direct')}
                  className="text-primary"
                />
                <span className="text-sm">Direct (specific driver)</span>
              </label>
            </div>

            {bookingType === 'direct' && (
              <div>
                <label htmlFor="target_driver_id" className={labelClass}>Target Driver ID</label>
                <input id="target_driver_id" name="target_driver_id" className={inputClass} placeholder="UUID of the target driver" />
              </div>
            )}

            {bookingType === 'auction' && (
              <div>
                <label htmlFor="auction_deadline" className={labelClass}>Auction Deadline (optional)</label>
                <input id="auction_deadline" name="auction_deadline" type="datetime-local" className={inputClass} />
              </div>
            )}
          </fieldset>

          <button
            type="submit"
            disabled={submitting || !quote}
            className="w-full bg-blue-600 text-white rounded-lg py-3 font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting && <Spinner className="h-4 w-4 border-white border-t-transparent" />}
            {submitting ? 'Creating...' : quote ? 'Create Booking' : 'Get a quote to continue'}
          </button>
        </form>
      </main>
    </>
  )
}
