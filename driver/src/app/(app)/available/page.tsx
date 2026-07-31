'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { listBookings, ApiError } from '@/lib/api'
import { useFleetAffiliation } from '@/lib/fleet-affiliation'
import type { Booking } from '@/lib/types'
import { formatPrice, formatDate, getCountdown } from '@/lib/utils'
import { bookingStatusConfig } from '@/lib/status'
import Spinner from '@/components/spinner'

// ONE ROUTE, TWO PRODUCTS. bt-booking-service swaps the meaning of GET /bookings
// by persona: a solo driver gets the open 'pending' load board, while a FLEET
// driver gets the trips their owner assigned to them (founder Q14 — they cannot
// self-select work). The API has always done this; the screen used to describe
// the result as "Available Loads … near you" either way, which told an employed
// driver their assigned job was a load to go and bid on.
export default function AvailablePage() {
  const { affiliation } = useFleetAffiliation()
  const isFleetDriver = affiliation.is_fleet_affiliated
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
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        {/* Animated truck loader */}
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-primary/20 to-amber-400/20 animate-pulse" />
          <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-tr from-primary/10 to-amber-400/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
            </svg>
          </div>
        </div>
        <p className="text-sm font-medium text-muted-foreground animate-pulse">
          {isFleetDriver ? 'Loading your trips…' : 'Finding available loads…'}
        </p>
      </div>
    )
  }

  if (bookings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
        {/* Empty state illustration */}
        <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-muted to-secondary flex items-center justify-center mb-6 animate-float shadow-lg">
          <svg className="w-12 h-12 text-muted-foreground/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
        </div>
        <h3 className="text-lg font-bold text-foreground mb-1">
          {isFleetDriver ? 'No trips assigned yet' : 'No loads available'}
        </h3>
        <p className="text-sm text-muted-foreground mb-6 max-w-xs">
          {isFleetDriver
            ? `${affiliation.company_name ?? 'Your fleet owner'} will assign your next trip here. Nothing to do until then.`
            : 'Check back soon — new shipment requests are posted throughout the day.'}
        </p>
        <button
          onClick={() => { setLoading(true); fetchBookings() }}
          className="px-7 py-3 bg-gradient-to-r from-primary to-orange-500 text-white rounded-xl text-sm font-bold active:scale-95 transition-all shadow-lg shadow-primary/30 hover:shadow-primary/45 hover:-translate-y-0.5"
        >
          {isFleetDriver ? 'Refresh' : 'Refresh Loads'}
        </button>
      </div>
    )
  }

  return (
    <div className="px-4 py-5 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div>
          <h2 className="text-xl font-extrabold text-foreground tracking-tight">
            {isFleetDriver ? 'My Trips' : 'Available Loads'}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isFleetDriver
              ? `${bookings.length} trip${bookings.length !== 1 ? 's' : ''} assigned by ${affiliation.company_name ?? 'your fleet'}`
              : `${bookings.length} load${bookings.length !== 1 ? 's' : ''} near you`}
          </p>
        </div>
        <button
          onClick={() => { setLoading(true); fetchBookings() }}
          className="flex items-center gap-1.5 text-xs font-semibold text-primary bg-primary/10 hover:bg-primary/15 px-3 py-1.5 rounded-full transition-all active:scale-95 border border-primary/20"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Desktop: a dense table. With ~100 loads that share a type, a load type
          and usually a pickup yard, a wall of cards is unscannable — the text
          that repeats dominates and the values that differ get the smallest
          type. Fixed columns put weight/date/payout where the eye can compare
          them down a column. Phones keep the cards below. */}
      <div className="hidden overflow-hidden rounded-2xl border border-border/60 bg-card md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th scope="col" className="px-5 py-3 text-left font-semibold">Drop-off</th>
              <th scope="col" className="px-5 py-3 text-left font-semibold">Load</th>
              <th scope="col" className="px-5 py-3 text-right font-semibold">Weight</th>
              <th scope="col" className="px-5 py-3 text-left font-semibold">Pickup date</th>
              <th scope="col" className="px-5 py-3 text-right font-semibold">
                {isFleetDriver ? 'Status' : 'Payout'}
              </th>
            </tr>
          </thead>
          <tbody>
            {bookings.map(booking => (
              <BookingRow
                key={booking.id}
                booking={booking}
                isFleetDriver={isFleetDriver}
                onClick={() => router.push(`/bookings/${booking.id}`)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:hidden">
        {bookings.map((booking, i) => (
          <BookingCard
            key={booking.id}
            booking={booking}
            index={i}
            isFleetDriver={isFleetDriver}
            onClick={() => router.push(`/bookings/${booking.id}`)}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * One load as a table row. The pickup yard repeats across most rows, so the
 * destination carries the emphasis and the origin is de-emphasised beneath it.
 */
function BookingRow({
  booking,
  isFleetDriver,
  onClick,
}: {
  booking: Booking
  isFleetDriver: boolean
  onClick: () => void
}) {
  // Auction furniture (the badge, the closing countdown) is about winning work.
  // A fleet driver's rows are trips already won for them, so it is noise.
  const isAuction = booking.booking_type === 'auction' && !isFleetDriver
  const countdown = booking.auction_deadline ? getCountdown(booking.auction_deadline) : null
  const status = bookingStatusConfig[booking.status]

  return (
    <tr
      onClick={onClick}
      tabIndex={0}
      role="link"
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      className="cursor-pointer border-b border-border/40 transition-colors last:border-0 hover:bg-secondary/40 focus:bg-secondary/40 focus:outline-none"
    >
      <td className="px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" />
          <span className="text-base font-semibold leading-snug text-foreground">
            {booking.destination_address}
          </span>
        </div>
        <div className="mt-1 pl-[18px] text-sm text-muted-foreground">
          from {booking.source_address}
        </div>
      </td>
      <td className="px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="text-[15px] text-foreground/90">{booking.load_type}</span>
          {isAuction && (
            <span className="rounded-full border border-amber-500/25 bg-amber-500/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-500">
              Auction
            </span>
          )}
        </div>
        {isAuction && countdown && (
          <div className={`mt-1 text-sm font-medium ${countdown === 'Expired' ? 'text-rose-500' : 'text-amber-500'}`}>
            {countdown === 'Expired' ? 'Closed' : `Closes ${countdown}`}
          </div>
        )}
      </td>
      <td className="whitespace-nowrap px-5 py-4 text-right text-base font-semibold tabular-nums text-foreground">
        {booking.weight_kg.toLocaleString()} kg
      </td>
      <td className="whitespace-nowrap px-5 py-4 text-base font-medium text-foreground/90">
        {formatDate(booking.pickup_date)}
      </td>
      <td className="whitespace-nowrap px-5 py-4 text-right">
        {isFleetDriver ? (
          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${status.color}`}>
            {status.label}
          </span>
        ) : booking.quoted_price === undefined ? (
          <span className="text-sm text-muted-foreground">Handled by fleet</span>
        ) : (
          <span className="text-lg font-bold tabular-nums text-foreground">{formatPrice(booking.quoted_price)}</span>
        )}
      </td>
    </tr>
  )
}

function BookingCard({
  booking,
  index,
  isFleetDriver,
  onClick,
}: {
  booking: Booking
  index: number
  isFleetDriver: boolean
  onClick: () => void
}) {
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

  // See BookingRow: auction/direct framing is about winning work, which a fleet
  // driver never does — their badge is the trip's status instead.
  const isAuction = booking.booking_type === 'auction' && !isFleetDriver
  const status = bookingStatusConfig[booking.status]

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-card hover-lift rounded-2xl border border-border/60 p-5 active:scale-[0.98] transition-all shadow-sm flex flex-col justify-between relative overflow-hidden group"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {/* Background gradient & glow decoration */}
      <div className="absolute top-0 right-0 w-32 h-32 card-glow-top-right rounded-bl-full pointer-events-none transition-all duration-300 group-hover:scale-125 group-hover:opacity-150" />
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-br from-primary/3 to-transparent pointer-events-none rounded-2xl" />

      {/* Top pill badges */}
      <div className="flex items-center gap-2 mb-4">
        {isFleetDriver ? (
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${status.color}`}>
            {status.label}
          </span>
        ) : isAuction ? (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/12 text-[10px] font-black text-amber-500 border border-amber-500/25 uppercase tracking-wider">
            <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" />
            Auction
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/12 text-[10px] font-black text-primary border border-primary/25 uppercase tracking-wider">
            <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
            Direct
          </span>
        )}
        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-secondary text-[10px] font-bold text-muted-foreground uppercase tracking-wide border border-border/50">
          {booking.load_type}
        </span>
      </div>

      {/* Route Timeline */}
      <div className="flex items-start gap-4 mb-4">
        <div className="flex flex-col items-center mt-0.5 shrink-0 gap-0.5">
          <div className="w-3 h-3 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20 shadow-sm shadow-emerald-500/30" />
          <div className="w-0.5 h-8 bg-gradient-to-b from-emerald-500 to-rose-500 opacity-40 my-0.5" />
          <div className="w-3 h-3 rounded-full bg-rose-500 ring-4 ring-rose-500/20 shadow-sm shadow-rose-500/30" />
        </div>
        <div className="flex-1 min-w-0 space-y-3.5">
          <div>
            <span className="text-[9px] uppercase font-black text-muted-foreground/70 tracking-widest block mb-0.5">From</span>
            <p className="text-sm font-bold text-foreground truncate leading-tight">{booking.source_address}</p>
          </div>
          <div>
            <span className="text-[9px] uppercase font-black text-muted-foreground/70 tracking-widest block mb-0.5">To</span>
            <p className="text-sm font-bold text-foreground truncate leading-tight">{booking.destination_address}</p>
          </div>
        </div>
      </div>

      {/* Divider + Details */}
      <div className="border-t border-border/50 pt-3.5 flex items-center justify-between">
        {/* Left — metadata chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
            </svg>
            {booking.weight_kg.toLocaleString()} kg
          </div>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-[11px] font-semibold text-muted-foreground">
            {formatDate(booking.pickup_date)}
          </span>
        </div>

        {/* Right — payout. Absent for a fleet-affiliated driver: the API masks
            the money because their owner is the commercial party on the trip. */}
        <div className="text-right">
          {isFleetDriver ? null : booking.quoted_price === undefined ? (
            <>
              <span className="text-[9px] uppercase font-black text-muted-foreground/60 tracking-wider block">Payout</span>
              <span className="text-sm font-bold text-muted-foreground tracking-tight leading-none">
                Handled by fleet
              </span>
            </>
          ) : (
            <>
              <span className="text-[9px] uppercase font-black text-muted-foreground/60 tracking-wider block">Est. Payout</span>
              <span className="text-xl font-extrabold text-foreground tracking-tight leading-none">
                {formatPrice(booking.quoted_price)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Auction countdown */}
      {isAuction && countdown && (
        <div className="mt-3 flex items-center gap-2 text-xs bg-amber-500/8 border border-amber-500/15 px-3 py-2 rounded-xl">
          <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className={`font-bold ${countdown === 'Expired' ? 'text-rose-500' : 'text-amber-500'}`}>
            {countdown === 'Expired' ? 'Auction closed' : `Closes ${countdown}`}
          </span>
        </div>
      )}

      {/* Hover arrow indicator */}
      <div className="absolute right-5 bottom-5 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 translate-x-2 group-hover:translate-x-0">
        <svg className="w-3.5 h-3.5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  )
}
