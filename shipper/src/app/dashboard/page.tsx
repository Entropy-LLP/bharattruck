'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { listBookings } from '@/lib/api'
import type { Booking } from '@/lib/types'
import Navbar from '@/components/Navbar'
import Spinner from '@/components/Spinner'

const STATUS_CONFIG: Record<string, { label: string; dot: string; badge: string; glow: string }> = {
  pending:     { label: 'Pending',     dot: 'bg-amber-400',   badge: 'bg-amber-400/12 text-amber-400 border-amber-400/30',   glow: 'shadow-amber-400/15' },
  negotiating: { label: 'Negotiating', dot: 'bg-blue-400',    badge: 'bg-blue-400/12 text-blue-400 border-blue-400/30',      glow: 'shadow-blue-400/15' },
  accepted:    { label: 'Assigned',    dot: 'bg-violet-400',  badge: 'bg-violet-400/12 text-violet-400 border-violet-400/30', glow: 'shadow-violet-400/15' },
  in_transit:  { label: 'In Transit',  dot: 'bg-emerald-400', badge: 'bg-emerald-400/12 text-emerald-400 border-emerald-400/30', glow: 'shadow-emerald-400/20' },
  completed:   { label: 'Delivered',   dot: 'bg-green-500',   badge: 'bg-green-500/12 text-green-400 border-green-500/30',   glow: 'shadow-green-500/15' },
  paid:        { label: 'Paid',        dot: 'bg-green-500',   badge: 'bg-green-500/12 text-green-400 border-green-500/30',   glow: 'shadow-green-500/15' },
  cancelled:   { label: 'Cancelled',   dot: 'bg-red-500',     badge: 'bg-red-500/12 text-red-400 border-red-500/30',         glow: 'shadow-red-500/10' },
}

const ALL_FILTERS = ['all', 'pending', 'negotiating', 'accepted', 'in_transit', 'completed', 'paid'] as const

/** Indian short-scale money, e.g. 749000 → ₹7.49L. */
function formatInrCompact(n: number): string {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`
  return `₹${n}`
}

/**
 * Stat tiles, derived from the live booking list. `final_price` is the settled
 * number once a quote is awarded; before that the shipper's own `quoted_price`
 * is the best estimate of what the load will cost.
 */
function buildStats(bookings: Booking[]) {
  const inTransit = bookings.filter(b => b.status === 'in_transit').length
  const total = bookings.reduce((sum, b) => sum + (b.final_price ?? b.quoted_price), 0)
  const avg = bookings.length > 0 ? Math.round(total / bookings.length) : 0

  return [
    {
      label: 'Total Bookings', value: String(bookings.length), sub: 'All time',
      icon: '📦',
      gradient: 'from-blue-600/20 via-blue-500/10 to-transparent',
      border: 'border-blue-500/20',
      accent: 'text-blue-400',
    },
    {
      label: 'In Transit', value: String(inTransit), sub: 'Active now',
      icon: '🚛',
      gradient: 'from-emerald-600/20 via-emerald-500/10 to-transparent',
      border: 'border-emerald-500/20',
      accent: 'text-emerald-400',
    },
    {
      label: 'Total Spent', value: formatInrCompact(total), sub: 'Freight cost',
      icon: '💰',
      gradient: 'from-amber-600/20 via-amber-500/10 to-transparent',
      border: 'border-amber-500/20',
      accent: 'text-amber-400',
    },
    {
      label: 'Avg. Quote', value: formatInrCompact(avg), sub: 'Per booking',
      icon: '📊',
      gradient: 'from-violet-600/20 via-violet-500/10 to-transparent',
      border: 'border-violet-500/20',
      accent: 'text-violet-400',
    },
  ]
}

export default function DashboardPage() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')

  useEffect(() => {
    listBookings()
      .then(setBookings)
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false))
  }, [])

  const stats = useMemo(() => buildStats(bookings), [bookings])

  const filtered = filter === 'all'
    ? bookings
    : bookings.filter((b) => b.status === filter)

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(155deg, #060C1B 0%, #0A1228 45%, #06091A 100%)' }}>
      <Navbar />

      {/* Ambient glow orbs */}
      <div className="fixed top-20 left-10 w-80 h-80 rounded-full opacity-8 blur-3xl pointer-events-none" style={{ background: 'radial-gradient(circle, #2563EB, transparent)' }} />
      <div className="fixed bottom-20 right-10 w-96 h-96 rounded-full opacity-6 blur-3xl pointer-events-none" style={{ background: 'radial-gradient(circle, #7C3AED, transparent)' }} />

      <main className="relative max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-3xl font-black tracking-tight text-white">My Bookings</h1>
              {/* Live indicator */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Live</span>
              </div>
            </div>
            <p className="text-sm text-white/35">Track and manage all your freight shipments</p>
          </div>
          <Link
            href="/bookings/new"
            className="inline-flex items-center gap-2 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg hover:-translate-y-0.5 active:scale-95"
            style={{
              background: 'linear-gradient(135deg, #2563EB 0%, #4F46E5 100%)',
              boxShadow: '0 8px 24px rgba(37,99,235,0.35)',
            }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            New Booking
          </Link>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((s, i) => (
            <div
              key={s.label}
              className={`rounded-2xl p-5 border relative overflow-hidden group cursor-default transition-all duration-300 hover:-translate-y-1 ${s.border}`}
              style={{
                background: 'rgba(255,255,255,0.03)',
                backdropFilter: 'blur(12px)',
                animationDelay: `${i * 80}ms`,
              }}
            >
              {/* Gradient overlay */}
              <div className={`absolute inset-0 bg-gradient-to-br ${s.gradient} opacity-100 group-hover:opacity-150 transition-opacity`} />

              {/* Corner decoration */}
              <div className="absolute -top-4 -right-4 w-16 h-16 rounded-full opacity-10 group-hover:opacity-20 transition-opacity"
                style={{ background: 'radial-gradient(circle, white, transparent)' }} />

              <div className="relative">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-2xl">{s.icon}</span>
                  <div className={`text-[10px] font-bold uppercase tracking-wider ${s.accent}`}>
                    {s.sub}
                  </div>
                </div>
                <p className={`text-3xl font-black text-white mb-0.5 ${s.accent.replace('text-', 'drop-shadow-none')}`}>
                  {s.value}
                </p>
                <p className="text-xs font-semibold text-white/40 uppercase tracking-widest">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {ALL_FILTERS.map((f) => {
            const isSelected = filter === f
            const label = f === 'all' ? 'All Bookings' : (STATUS_CONFIG[f]?.label ?? f)
            const count = f === 'all' ? bookings.length : bookings.filter(b => b.status === f).length
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all border ${
                  isSelected
                    ? 'text-white border-blue-500/50 shadow-lg'
                    : 'border-white/8 text-white/40 hover:text-white/70 hover:border-white/15'
                }`}
                style={isSelected ? {
                  background: 'linear-gradient(135deg, #1D4ED8, #4F46E5)',
                  boxShadow: '0 4px 16px rgba(37,99,235,0.3)',
                } : {
                  background: 'rgba(255,255,255,0.03)',
                }}
              >
                {label}
                {count > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-black ${
                    isSelected ? 'bg-card/20 text-white' : 'bg-card/8 text-white/40'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Grid */}
        {loading ? (
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
        ) : bookings.length === 0 ? (
          <div className="text-center py-20 text-white/25">
            <div className="text-6xl mb-4 animate-float inline-block">📦</div>
            <p className="text-lg font-bold text-white/40">No bookings yet</p>
            <p className="mt-1 text-sm text-white/30">Create your first booking to get started.</p>
            <Link
              href="/bookings/new"
              className="mt-4 inline-block px-5 py-2 rounded-full text-xs font-bold text-white/60 border border-white/12 hover:text-white hover:border-white/25 transition-all"
              style={{ background: 'rgba(255,255,255,0.04)' }}
            >
              New Booking
            </Link>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-white/25">
            <div className="text-6xl mb-4 animate-float inline-block">📦</div>
            <p className="text-lg font-bold text-white/40">No bookings match this filter</p>
            <button
              onClick={() => setFilter('all')}
              className="mt-4 px-5 py-2 rounded-full text-xs font-bold text-white/60 border border-white/12 hover:text-white hover:border-white/25 transition-all"
              style={{ background: 'rgba(255,255,255,0.04)' }}
            >
              Clear filter
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((booking, i) => (
              <BookingCard key={booking.id} booking={booking} index={i} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

function BookingCard({ booking, index }: { booking: Booking; index: number }) {
  const status = STATUS_CONFIG[booking.status] ?? STATUS_CONFIG.pending

  return (
    <Link
      href={`/bookings/${booking.id}`}
      className={`group block rounded-2xl border border-white/8 p-5 transition-all duration-300 hover:-translate-y-1 hover:border-white/18 relative overflow-hidden ${status.glow}`}
      style={{
        background: 'rgba(255,255,255,0.035)',
        backdropFilter: 'blur(12px)',
        animationDelay: `${index * 60}ms`,
        boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
      }}
    >
      {/* Hover shine */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-br from-white/5 to-transparent pointer-events-none rounded-2xl" />

      {/* Corner glow dot */}
      <div className={`absolute top-0 right-0 w-20 h-20 rounded-bl-full opacity-5 group-hover:opacity-10 transition-opacity ${status.dot.replace('bg-', 'bg-')}`}
        style={{ background: `radial-gradient(circle at top right, ${status.dot.includes('emerald') ? '#10b981' : status.dot.includes('blue') ? '#60a5fa' : status.dot.includes('amber') ? '#f59e0b' : status.dot.includes('violet') ? '#a78bfa' : '#ffffff'}, transparent)` }}
      />

      {/* Status + type row */}
      <div className="flex items-center justify-between mb-4">
        <span className={`inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-xl border ${status.badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${status.dot} ${booking.status === 'in_transit' ? 'animate-pulse' : ''}`} />
          {status.label}
        </span>
        <span
          className={`text-[9px] font-black text-white/40 uppercase tracking-widest px-2 py-1 rounded-lg border border-white/8`}
          style={{ background: 'rgba(255,255,255,0.05)' }}
        >
          {booking.booking_type}
        </span>
      </div>

      {/* Route */}
      <div className="mb-5">
        <div className="flex items-center gap-3 mb-1.5">
          <div className="w-2 h-2 rounded-full bg-emerald-400 ring-4 ring-emerald-400/20 shrink-0" />
          <span className="text-sm text-white font-semibold truncate leading-snug">{booking.source_address}</span>
        </div>
        <div className="ml-0.5 pl-3.5 border-l border-dashed border-white/12 h-3.5" />
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-rose-400 ring-4 ring-rose-400/20 shrink-0" />
          <span className="text-sm text-white font-semibold truncate leading-snug">{booking.destination_address}</span>
        </div>
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 pt-4 border-t border-white/8">
        <div>
          <p className="text-[9px] font-black text-white/30 uppercase tracking-widest mb-0.5">Load type</p>
          <p className="text-xs font-bold text-white capitalize">{booking.load_type}</p>
        </div>
        <div>
          <p className="text-[9px] font-black text-white/30 uppercase tracking-widest mb-0.5">Weight</p>
          <p className="text-xs font-bold text-white">{booking.weight_kg.toLocaleString()} kg</p>
        </div>
        <div>
          <p className="text-[9px] font-black text-white/30 uppercase tracking-widest mb-0.5">Quoted</p>
          <p className="text-base font-black text-white">₹{booking.quoted_price.toLocaleString('en-IN')}</p>
        </div>
        <div>
          <p className="text-[9px] font-black text-white/30 uppercase tracking-widest mb-0.5">Pickup</p>
          <p className="text-xs font-bold text-white">
            {new Date(booking.pickup_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
      </div>

      {/* View arrow */}
      <div className="absolute right-4 bottom-4 w-7 h-7 rounded-full opacity-0 group-hover:opacity-100 transition-all duration-200 flex items-center justify-center translate-x-2 group-hover:translate-x-0"
        style={{ background: 'rgba(255,255,255,0.08)' }}>
        <svg className="w-3.5 h-3.5 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  )
}
