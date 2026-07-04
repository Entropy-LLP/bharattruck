'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { listBookings } from '@/lib/api'
import { bookingStatusConfig } from '@/lib/status'
import type { Booking } from '@/lib/types'
import Navbar from '@/components/Navbar'
import Spinner from '@/components/Spinner'

export default function DashboardPage() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listBookings()
      .then(setBookings)
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <>
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-gray-900">My Bookings</h1>
          <Link
            href="/bookings/new"
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            + New Booking
          </Link>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
        ) : bookings.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <p className="text-lg">No bookings yet</p>
            <p className="text-sm mt-1">Create your first booking to get started.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {bookings.map((booking) => (
              <BookingCard key={booking.id} booking={booking} />
            ))}
          </div>
        )}
      </main>
    </>
  )
}

function BookingCard({ booking }: { booking: Booking }) {
  const status = bookingStatusConfig[booking.status]

  return (
    <Link
      href={`/bookings/${booking.id}`}
      className="block bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between mb-3">
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${status.color}`}>
          {status.label}
        </span>
        <span className="text-xs text-gray-400 uppercase tracking-wide">
          {booking.booking_type}
        </span>
      </div>

      <div className="mb-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
          <span className="text-gray-700 truncate">{booking.source_address}</span>
        </div>
        <div className="ml-1 border-l border-dashed border-gray-300 h-3" />
        <div className="flex items-center gap-2 text-sm">
          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
          <span className="text-gray-700 truncate">{booking.destination_address}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
        <div>
          <span className="text-gray-400">Load: </span>
          <span className="capitalize">{booking.load_type}</span>
        </div>
        <div>
          <span className="text-gray-400">Weight: </span>
          {booking.weight_kg} kg
        </div>
        <div>
          <span className="text-gray-400">Price: </span>
          <span className="font-medium text-gray-900">
            {'\u20B9'}{booking.quoted_price.toLocaleString('en-IN')}
          </span>
        </div>
        <div>
          <span className="text-gray-400">Pickup: </span>
          {new Date(booking.pickup_date).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
          })}
        </div>
      </div>
    </Link>
  )
}
