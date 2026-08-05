'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { listBookings, getQuotes, ApiError } from '@/lib/api'
import type { Booking, Quote } from '@/lib/types'
import { formatPrice, relativeTime } from '@/lib/utils'
import { quoteStatusConfig } from '@/lib/status'
import { useFleetAffiliation } from '@/lib/fleet-affiliation'
import Spinner from '@/components/spinner'

interface QuoteWithBooking {
  quote: Quote
  booking: Booking
}

export default function MyQuotesPage() {
  const { affiliation } = useFleetAffiliation()
  const isFleetDriver = affiliation.is_employed
  const [items, setItems] = useState<QuoteWithBooking[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  const fetchMyQuotes = useCallback(async () => {
    // A fleet driver owns no quotes — their owner is the bidder (founder Q14) —
    // so every /quotes call below would answer []. Skip the fan-out entirely
    // (one request per booking) and show the explanation instead of an empty
    // list that reads like "you haven't bid yet".
    if (isFleetDriver) {
      setItems([])
      setLoading(false)
      return
    }
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
  }, [isFleetDriver])

  useEffect(() => {
    fetchMyQuotes()
  }, [fetchMyQuotes])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-primary/20 to-amber-400/20 animate-pulse" />
          <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-tr from-primary/10 to-amber-400/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
        </div>
        <p className="text-sm font-medium text-muted-foreground animate-pulse">Loading your quotes…</p>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
        <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-muted to-secondary flex items-center justify-center mb-6 animate-float shadow-lg">
          <svg className="w-12 h-12 text-muted-foreground/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
        <h3 className="text-lg font-bold text-foreground mb-1">
          {isFleetDriver ? 'You don’t bid for loads' : 'No quotes yet'}
        </h3>
        <p className="text-sm text-muted-foreground mb-6 max-w-xs">
          {isFleetDriver
            ? `${affiliation.company_name ?? 'Your fleet owner'} bids for loads and assigns the trips to you.`
            : 'Browse available loads and submit quotes to start earning.'}
        </p>
        <button
          onClick={() => router.push('/available')}
          className="px-7 py-3 bg-gradient-to-r from-primary to-orange-500 text-white rounded-xl text-sm font-bold active:scale-95 transition-all shadow-lg shadow-primary/30 hover:-translate-y-0.5"
        >
          {isFleetDriver ? 'Go to My Trips' : 'Browse Loads'}
        </button>
      </div>
    )
  }

  const pendingCount = items.filter(i => i.quote.status === 'countered').length

  return (
    <div className="px-4 py-5 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-extrabold text-foreground tracking-tight">My Quotes</h2>
            {pendingCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-black animate-pulse">
                {pendingCount}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{items.length} quote{items.length !== 1 ? 's' : ''} submitted</p>
        </div>
        <button
          onClick={() => { setLoading(true); fetchMyQuotes() }}
          className="flex items-center gap-1.5 text-xs font-semibold text-primary bg-primary/10 hover:bg-primary/15 px-3 py-1.5 rounded-full transition-all active:scale-95 border border-primary/20"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* One column on a phone (the primary target); on wider viewports the
          list flows into columns instead of stretching each card. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map(({ quote, booking }, i) => {
        const config = quoteStatusConfig[quote.status]
        const needsAttention = quote.status === 'countered'

        return (
          <button
            key={quote.id}
            onClick={() => router.push(`/bookings/${booking.id}`)}
            className={`w-full text-left bg-card rounded-2xl border p-4.5 p-[18px] active:scale-[0.98] transition-all shadow-sm relative overflow-hidden group hover-lift ${
              needsAttention
                ? 'border-2 border-amber-400 animate-pulse-border shadow-amber-400/20'
                : 'border-border/60'
            }`}
            style={{ animationDelay: `${i * 50}ms` }}
          >
            {/* Attention badge */}
            {needsAttention && (
              <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-amber-500 text-white text-[9px] font-black uppercase tracking-wide animate-bounce">
                Respond!
              </div>
            )}

            {/* Background hover glow */}
            <div className={`absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none ${
              needsAttention ? 'bg-gradient-to-br from-amber-500/5 to-transparent' : 'bg-gradient-to-br from-primary/3 to-transparent'
            }`} />

            {/* Route */}
            <div className="flex items-center gap-2 mb-3 pr-16">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                <p className="text-sm font-semibold text-foreground truncate">
                  {booking.source_address}
                </p>
              </div>
              <svg className="w-3 h-3 text-muted-foreground/50 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                <p className="text-sm font-semibold text-foreground truncate">
                  {booking.destination_address}
                </p>
              </div>
            </div>

            {/* Quote details */}
            <div className="flex items-center justify-between pt-3 border-t border-border/50">
              <div className="flex items-center gap-2.5">
                <span className="text-lg font-extrabold text-foreground">{formatPrice(quote.amount)}</span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${config.color}`}>
                  <span className="w-1 h-1 rounded-full bg-current" />
                  {config.label}
                </span>
              </div>
              <span className="text-xs text-muted-foreground font-medium">{relativeTime(quote.submitted_at)}</span>
            </div>

            {needsAttention && (
              <div className="flex items-center gap-2 mt-3 p-2.5 rounded-xl bg-amber-500/8 border border-amber-500/15">
                <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                  Shipper sent a counter-offer — tap to respond
                </p>
              </div>
            )}
          </button>
        )
      })}
      </div>
    </div>
  )
}
