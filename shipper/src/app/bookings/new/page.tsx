'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createBooking } from '@/lib/api'
import Navbar from '@/components/Navbar'
import Spinner from '@/components/Spinner'

const LOAD_TYPES = ['container', 'pallets', 'bulk', 'fragile', 'liquid'] as const

export default function NewBookingPage() {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [bookingType, setBookingType] = useState<'direct' | 'auction'>('auction')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)

    const payload = {
      source_address: form.get('source_address') as string,
      source_lat: parseFloat(form.get('source_lat') as string),
      source_lng: parseFloat(form.get('source_lng') as string),
      destination_address: form.get('destination_address') as string,
      dest_lat: parseFloat(form.get('dest_lat') as string),
      dest_lng: parseFloat(form.get('dest_lng') as string),
      load_type: form.get('load_type') as string,
      weight_kg: parseFloat(form.get('weight_kg') as string),
      quoted_price: parseFloat(form.get('quoted_price') as string),
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
      toast.error(err instanceof Error ? err.message : 'Failed to create booking')
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

          {/* Cargo Details */}
          <fieldset className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <legend className="text-sm font-semibold text-gray-900 px-1">Cargo Details</legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="load_type" className={labelClass}>Load Type</label>
                <select id="load_type" name="load_type" required className={inputClass}>
                  {LOAD_TYPES.map((t) => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="weight_kg" className={labelClass}>Weight (kg)</label>
                <input id="weight_kg" name="weight_kg" type="number" min="1" required className={inputClass} placeholder="5000" />
              </div>
            </div>
            <div>
              <label htmlFor="quoted_price" className={labelClass}>Quoted Price ({'\u20B9'})</label>
              <input id="quoted_price" name="quoted_price" type="number" min="1" required className={inputClass} placeholder="25000" />
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
            disabled={submitting}
            className="w-full bg-blue-600 text-white rounded-lg py-3 font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting && <Spinner className="h-4 w-4 border-white border-t-transparent" />}
            {submitting ? 'Creating...' : 'Create Booking'}
          </button>
        </form>
      </main>
    </>
  )
}
