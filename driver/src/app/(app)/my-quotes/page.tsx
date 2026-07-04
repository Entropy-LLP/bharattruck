'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { listBookings, getQuotes, ApiError } from '@/lib/api'
import type { Booking, Quote } from '@/lib/types'
import { formatPrice, relativeTime } from '@/lib/utils'
import { quoteStatusConfig } from '@/lib/status'
import Spinner from '@/components/spinner'

interface QuoteWithBooking {
  quote: Quote
  booking: Booking
}

export default function MyQuotesPage() {
  const [items, setItems] = useState<QuoteWithBooking[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  const fetchMyQuotes = useCallback(async () => {
    try {
      const bookings = await listBookings()

      const results = await Promise.all(
        bookings.map(async (booking) => {
          try {
            const quotes = await getQuotes(booking.id)
            if (quotes.length > 0) {
              return { quote: quotes[0], booking } as QuoteWithBooking
            }
          } catch {
            // skip bookings where quote fetch fails
          }
          return null
        })
      )

      const validItems = results.filter((r): r is QuoteWithBooking => r !== null)
      validItems.sort((a, b) =>
        new Date(b.quote.submitted_at).getTime() - new Date(a.quote.submitted_at).getTime()
      )
      setItems(validItems)
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMyQuotes()
  }, [fetchMyQuotes])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <svg className="w-16 h-16 text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        <p className="text-gray-500 text-lg font-medium">No quotes yet</p>
        <p className="text-gray-400 text-sm mt-1">Browse available bookings to submit your first quote</p>
        <button
          onClick={() => router.push('/available')}
          className="mt-4 px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium active:scale-95 transition-transform"
        >
          Browse Bookings
        </button>
      </div>
    )
  }

  return (
    <div className="px-4 py-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-bold text-gray-900">My Quotes</h2>
        <button
          onClick={() => { setLoading(true); fetchMyQuotes() }}
          className="text-sm text-blue-600 font-medium active:scale-95 transition-transform"
        >
          Refresh
        </button>
      </div>

      {items.map(({ quote, booking }) => {
        const config = quoteStatusConfig[quote.status]
        const needsAttention = quote.status === 'countered'

        return (
          <button
            key={quote.id}
            onClick={() => router.push(`/bookings/${booking.id}`)}
            className={`w-full text-left bg-white rounded-2xl border p-4 active:scale-[0.98] transition-transform shadow-sm ${
              needsAttention ? 'border-2 border-orange-400 animate-pulse-border' : 'border-gray-200'
            }`}
          >
            {/* Route */}
            <div className="flex items-center gap-2 mb-2">
              <p className="text-sm font-medium text-gray-900 truncate flex-1">
                {booking.source_address}
              </p>
              <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
              <p className="text-sm font-medium text-gray-900 truncate flex-1 text-right">
                {booking.destination_address}
              </p>
            </div>

            {/* Quote details */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-gray-900">{formatPrice(quote.amount)}</span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${config.color}`}>
                  {config.label}
                </span>
              </div>
              <span className="text-xs text-gray-400">{relativeTime(quote.submitted_at)}</span>
            </div>

            {needsAttention && (
              <p className="text-xs text-orange-600 font-medium mt-2">
                Shipper sent a counter-offer — tap to respond
              </p>
            )}
          </button>
        )
      })}
    </div>
  )
}
