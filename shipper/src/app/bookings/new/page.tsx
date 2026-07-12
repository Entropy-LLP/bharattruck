'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  createBooking,
  getPriceQuote,
  ApiError,
  type PriceQuote,
  type PriceQuoteLoadType,
  type PriceQuoteVehicleType,
} from '@/lib/api'
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
  const [bookingType, setBookingType] = useState<'direct' | 'auction'>('auction')

  // Quote-affecting fields are controlled so we can (a) build the quote request
  // and (b) invalidate a stale lock the moment any of them changes.
  const [distanceKm, setDistanceKm] = useState('')
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

  async function handleGetQuote() {
    const distance = parseFloat(distanceKm)
    const weight = parseFloat(weightKg)
    if (!Number.isFinite(distance) || distance <= 0) {
      toast.error('Enter a valid distance (km) before getting a quote')
      return
    }
    if (!Number.isFinite(weight) || weight <= 0) {
      toast.error('Enter a valid weight (kg) before getting a quote')
      return
    }

    setQuoting(true)
    try {
      const q = await getPriceQuote({
        distance_km: distance,
        vehicle_type: vehicleType,
        load_type: loadType,
        weight_kg: weight,
      })
      setQuote(q)
      toast.success('Price locked')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to get a quote')
    } finally {
      setQuoting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!quote) {
      toast.error('Get a locked price quote before creating the booking')
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
      source_lat: parseFloat(form.get('source_lat') as string),
      source_lng: parseFloat(form.get('source_lng') as string),
      destination_address: form.get('destination_address') as string,
      dest_lat: parseFloat(form.get('dest_lat') as string),
      dest_lng: parseFloat(form.get('dest_lng') as string),
      load_type: loadType,
      weight_kg: weight,
      quote_id: quote.quote_id,
      pickup_date: form.get('pickup_date') as string,
      pickup_time_slot: (form.get('pickup_time_slot') as string) || undefined,
      special_instructions: (form.get('special_instructions') as string) || undefined,
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
      // Expired (VALIDATION_ERROR) or already-used (INVALID_TRANSITION) lock:
      // drop it and make the shipper re-fetch a fresh quote.
      if (err instanceof ApiError && (err.code === 'VALIDATION_ERROR' || err.code === 'INVALID_TRANSITION')) {
        setQuote(null)
        toast.error('Your locked price is no longer valid — please get a new quote')
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to create booking')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
  const labelClass = 'block text-sm font-medium text-gray-700 mb-1'

  return (
    <>
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <h1 className="text-xl font-bold text-gray-900 mb-6">Create New Booking</h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Source */}
          <fieldset className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <legend className="text-sm font-semibold text-gray-900 px-1">Pickup Location</legend>
            <div>
              <label htmlFor="source_address" className={labelClass}>Address</label>
              <input id="source_address" name="source_address" required className={inputClass} placeholder="e.g. 45 MG Road, Mumbai" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="source_lat" className={labelClass}>Latitude</label>
                <input id="source_lat" name="source_lat" type="number" step="any" required className={inputClass} placeholder="19.0760" />
              </div>
              <div>
                <label htmlFor="source_lng" className={labelClass}>Longitude</label>
                <input id="source_lng" name="source_lng" type="number" step="any" required className={inputClass} placeholder="72.8777" />
              </div>
            </div>
          </fieldset>

          {/* Destination */}
          <fieldset className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <legend className="text-sm font-semibold text-gray-900 px-1">Drop Location</legend>
            <div>
              <label htmlFor="destination_address" className={labelClass}>Address</label>
              <input id="destination_address" name="destination_address" required className={inputClass} placeholder="e.g. 12 Brigade Road, Bangalore" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="dest_lat" className={labelClass}>Latitude</label>
                <input id="dest_lat" name="dest_lat" type="number" step="any" required className={inputClass} placeholder="12.9716" />
              </div>
              <div>
                <label htmlFor="dest_lng" className={labelClass}>Longitude</label>
                <input id="dest_lng" name="dest_lng" type="number" step="any" required className={inputClass} placeholder="77.5946" />
              </div>
            </div>
          </fieldset>

          {/* Cargo Details — these drive the price quote */}
          <fieldset className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <legend className="text-sm font-semibold text-gray-900 px-1">Cargo &amp; Vehicle</legend>
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
                <label htmlFor="distance_km" className={labelClass}>Distance (km)</label>
                <input
                  id="distance_km"
                  type="number"
                  min="1"
                  step="any"
                  value={distanceKm}
                  onChange={(e) => { setDistanceKm(e.target.value); invalidateQuote() }}
                  className={inputClass}
                  placeholder="1400"
                />
              </div>
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
            </div>

            {/* Get Quote + locked-price panel */}
            <div className="pt-1">
              <button
                type="button"
                onClick={handleGetQuote}
                disabled={quoting}
                className="w-full bg-gray-900 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-gray-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {quoting && <Spinner className="h-4 w-4 border-white border-t-transparent" />}
                {quoting ? 'Getting price…' : quote ? 'Refresh Quote' : 'Get Quote'}
              </button>

              {quote && (
                <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-semibold text-gray-900">Locked Price</span>
                    <span className="text-lg font-bold text-green-700">{inr(quote.quoted_price)}</span>
                  </div>
                  <dl className="mt-3 space-y-1 text-xs text-gray-600">
                    <div className="flex justify-between"><dt>Fuel</dt><dd>{inr(quote.breakdown.fuel_cost)}</dd></div>
                    <div className="flex justify-between"><dt>Driver wage</dt><dd>{inr(quote.breakdown.driver_wage)}</dd></div>
                    <div className="flex justify-between"><dt>Per-km operating</dt><dd>{inr(quote.breakdown.per_km_operating_cost)}</dd></div>
                    <div className="flex justify-between"><dt>Handling</dt><dd>{inr(quote.breakdown.handling)}</dd></div>
                    <div className="flex justify-between border-t border-green-200 pt-1"><dt>Platform fee</dt><dd>{inr(quote.platform_fee)}</dd></div>
                    <div className="flex justify-between text-gray-500"><dt>Vehicle class</dt><dd>{quote.breakdown.vehicle_class}</dd></div>
                  </dl>
                  <p className="mt-3 text-[11px] text-gray-500">
                    This price is locked and will be charged on booking. Valid until{' '}
                    {new Date(quote.expires_at).toLocaleString('en-IN')}.
                  </p>
                </div>
              )}
            </div>
          </fieldset>

          {/* Schedule */}
          <fieldset className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <legend className="text-sm font-semibold text-gray-900 px-1">Schedule</legend>
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
          <fieldset className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <legend className="text-sm font-semibold text-gray-900 px-1">Booking Type</legend>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="booking_type_radio"
                  checked={bookingType === 'auction'}
                  onChange={() => setBookingType('auction')}
                  className="text-blue-600"
                />
                <span className="text-sm">Auction (open to all drivers)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="booking_type_radio"
                  checked={bookingType === 'direct'}
                  onChange={() => setBookingType('direct')}
                  className="text-blue-600"
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
