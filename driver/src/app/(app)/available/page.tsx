'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { listBookings, ApiError } from '@/lib/api'
import type { Booking } from '@/lib/types'
import { formatPrice, formatDate, getCountdown } from '@/lib/utils'
import Spinner from '@/components/spinner'

export default function AvailablePage() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  const fetchBookings = useCallback(async () => {
    try {
      const data = await listBookings()
      setBookings(data)
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBookings()
  }, [fetchBookings])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    )
  }

  if (bookings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <svg className="w-16 h-16 text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
        <p className="text-gray-500 text-lg font-medium">No bookings available</p>
        <p className="text-gray-400 text-sm mt-1">Check back later for new shipment requests</p>
        <button
          onClick={() => { setLoading(true); fetchBookings() }}
          className="mt-4 px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium active:scale-95 transition-transform"
        >
          Refresh
        </button>
      </div>
    )
  }

  return (
    <div className="px-4 py-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-bold text-gray-900">Available Bookings</h2>
        <button
          onClick={() => { setLoading(true); fetchBookings() }}
          className="text-sm text-blue-600 font-medium active:scale-95 transition-transform"
        >
          Refresh
        </button>
      </div>

      {bookings.map(booking => (
        <BookingCard
          key={booking.id}
          booking={booking}
          onClick={() => router.push(`/bookings/${booking.id}`)}
        />
      ))}
    </div>
  )
}

function BookingCard({ booking, onClick }: { booking: Booking; onClick: () => void }) {
  const [countdown, setCountdown] = useState(() =>
    booking.auction_deadline ? getCountdown(booking.auction_deadline) : null
  )

  useEffect(() => {
    if (!booking.auction_deadline) return
    const interval = setInterval(() => {
      setCountdown(getCountdown(booking.auction_deadline!))
    }, 30_000)
    return () => clearInterval(interval)
  }, [booking.auction_deadline])

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white rounded-2xl border border-gray-200 p-4 active:scale-[0.98] transition-transform shadow-sm"
    >
      {/* Route */}
      <div className="flex items-start gap-3 mb-3">
        <div className="flex flex-col items-center mt-1">
          <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
          <div className="w-0.5 h-8 bg-gray-200 my-0.5" />
          <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{booking.source_address}</p>
          <div className="h-4" />
          <p className="text-sm font-medium text-gray-900 truncate">{booking.destination_address}</p>
        </div>
      </div>

      {/* Details row */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-gray-100 text-xs font-medium text-gray-700">
          {booking.load_type}
        </span>
        <span className="text-xs text-gray-500">{booking.weight_kg.toLocaleString()} kg</span>
        <span className="text-xs text-gray-500">Pickup: {formatDate(booking.pickup_date)}</span>
      </div>

      {/* Price + badges */}
      <div className="flex items-center justify-between">
        <span className="text-lg font-bold text-gray-900">{formatPrice(booking.quoted_price)}</span>
        <div className="flex items-center gap-2">
          {booking.booking_type === 'auction' ? (
            <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-orange-100 text-xs font-semibold text-orange-700">
              Auction
            </span>
          ) : (
            <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-blue-100 text-xs font-semibold text-blue-700">
              Direct
            </span>
          )}
        </div>
      </div>

      {/* Auction countdown */}
      {booking.booking_type === 'auction' && countdown && (
        <div className="mt-2 flex items-center gap-1.5 text-xs">
          <svg className="w-3.5 h-3.5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className={`font-medium ${countdown === 'Expired' ? 'text-red-500' : 'text-orange-600'}`}>
            {countdown}
          </span>
        </div>
      )}
    </button>
  )
}
