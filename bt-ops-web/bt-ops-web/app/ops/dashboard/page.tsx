'use client'

import { useEffect, useMemo, useState } from 'react'
import { Truck, MapPin, TrendingUp, Loader2, AlertTriangle, PackageCheck, RefreshCw } from 'lucide-react'
import { StatCard } from '@/components/stat-card'
import { Badge } from '@/components/badge'
import { listBookings, type Booking, type BookingStatus } from '@/lib/api'

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'muted' | 'accent'
const STATUS_BADGE: Record<BookingStatus, { variant: BadgeVariant; label: string }> = {
  pending:     { variant: 'warning', label: 'Pending'     },
  negotiating: { variant: 'info',    label: 'Negotiating' },
  accepted:    { variant: 'accent',  label: 'Assigned'    },
  in_transit:  { variant: 'accent',  label: 'In Transit'  },
  completed:   { variant: 'success', label: 'Delivered'   },
  paid:        { variant: 'success', label: 'Paid'        },
  cancelled:   { variant: 'error',   label: 'Cancelled'   },
}

// Status dot colors
const STATUS_DOTS: Record<BookingStatus, string> = {
  pending:     'bg-amber-400',
  negotiating: 'bg-blue-400',
  accepted:    'bg-violet-400',
  in_transit:  'bg-[#FF7A00]',
  completed:   'bg-emerald-500',
  paid:        'bg-emerald-500',
  cancelled:   'bg-red-500',
}

function inr(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`
}

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function OpsDashboard() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  async function fetchData() {
    try {
      const data = await listBookings()
      setBookings(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  function handleRefresh() {
    setRefreshing(true)
    fetchData()
  }

  const stats = useMemo(() => {
    const by = (s: BookingStatus) => bookings.filter(b => b.status === s).length
    const inTransit = by('in_transit')
    const active = bookings.filter(b => ['accepted', 'in_transit'].includes(b.status)).length
    const delivered = by('completed') + by('paid')
    const nonCancelled = bookings.filter(b => b.status !== 'cancelled').length
    const completionRate = nonCancelled > 0 ? ((delivered / nonCancelled) * 100).toFixed(1) : '—'
    return { total: bookings.length, inTransit, active, delivered, completionRate }
  }, [bookings])

  const recent = useMemo(
    () => [...bookings]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 8),
    [bookings],
  )

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 animate-slide-up">
        <div>
          <h1 className="text-2xl font-black dark:text-white text-[#0F172A] tracking-tight">
            Operations Overview
          </h1>
          <p className="text-sm dark:text-[#8892A4] text-[#64748B] mt-1">
            {loading ? 'Loading platform data…' : (
              <span>
                <span className="dark:text-white text-[#0F172A] font-semibold">{stats.total}</span>
                {' '}bookings on the platform
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Refresh button */}
          <button
            onClick={handleRefresh}
            disabled={loading || refreshing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all disabled:opacity-50 dark:text-[#8892A4] text-[#64748B] dark:hover:text-white hover:text-[#0F172A] dark:bg-[#161B25] bg-[#F1F5F9] dark:hover:bg-[#1E2535] hover:bg-[#E2E8F0] border dark:border-[#1E2535] border-[#E2E8F0]"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>

          {/* Live indicator */}
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl border"
            style={{ background: 'rgba(16,185,129,0.06)', borderColor: 'rgba(16,185,129,0.2)' }}>
            <div className="relative w-2 h-2">
              <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-60" />
              <span className="absolute inset-0 rounded-full bg-emerald-500" />
            </div>
            <span className="text-xs font-bold text-emerald-500">Platform Live</span>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2.5 rounded-xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-400 animate-slide-up">
          <AlertTriangle size={15} className="shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          {/* Spinner with glow */}
          <div className="relative">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(255,122,0,0.08)', border: '1px solid rgba(255,122,0,0.15)' }}>
              <Loader2 className="h-6 w-6 animate-spin text-[#FF7A00]" />
            </div>
          </div>
          <p className="text-sm dark:text-[#8892A4] text-[#64748B] font-medium animate-pulse">Loading operations data…</p>
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-slide-up" style={{ animationDelay: '60ms' }}>
            <StatCard label="Active Trips" value={String(stats.active)} sub="Assigned + in transit" icon={MapPin} accent />
            <StatCard label="In Transit" value={String(stats.inTransit)} sub="Live on the road now" icon={Truck} />
            <StatCard label="Delivered" value={String(stats.delivered)} sub="Completed + paid" icon={PackageCheck} />
            <StatCard
              label="Completion Rate"
              value={stats.completionRate === '—' ? '—' : `${stats.completionRate}%`}
              sub="Of non-cancelled trips"
              icon={TrendingUp}
            />
          </div>

          {/* Recent Bookings table */}
          <div
            className="rounded-2xl border overflow-hidden animate-slide-up"
            style={{ animationDelay: '120ms' }}
          >
            {/* Table header */}
            <div className="px-6 py-4 flex items-center justify-between dark:border-[#1E2535] border-[#E2E8F0] border-b dark:bg-[#0E1117] bg-white">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: 'rgba(255,122,0,0.1)', border: '1px solid rgba(255,122,0,0.2)' }}>
                  <Truck size={14} className="text-[#FF7A00]" />
                </div>
                <div>
                  <h2 className="font-bold dark:text-white text-[#0F172A] text-sm leading-none">Recent Bookings</h2>
                  <p className="text-[10px] dark:text-[#8892A4] text-[#64748B] mt-0.5">Last {recent.length} transactions</p>
                </div>
              </div>
              <a
                href="/ops/trips"
                className="text-xs text-[#FF7A00] hover:text-[#FFB347] font-bold transition-colors flex items-center gap-1"
              >
                Live Trips
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                </svg>
              </a>
            </div>

            {recent.length === 0 ? (
              <div className="px-6 py-12 text-center dark:bg-[#0E1117] bg-white">
                <div className="w-12 h-12 rounded-xl dark:bg-[#161B25] bg-[#F8FAFC] flex items-center justify-center mx-auto mb-3">
                  <PackageCheck size={20} className="dark:text-[#434D5E] text-[#94A3B8]" />
                </div>
                <p className="text-sm dark:text-[#8892A4] text-[#64748B]">No bookings yet.</p>
              </div>
            ) : (
              <div className="divide-y dark:divide-[#1E2535] divide-[#F1F5F9] dark:bg-[#0E1117] bg-white">
                {recent.map((b, i) => {
                  const badge = STATUS_BADGE[b.status]
                  const dot = STATUS_DOTS[b.status]
                  return (
                    <div
                      key={b.id}
                      className="px-6 py-4 flex items-center gap-4 transition-colors dark:hover:bg-[#161B25] hover:bg-[#F8FAFC] group cursor-pointer animate-fade-in"
                      style={{ animationDelay: `${i * 40}ms` }}
                    >
                      {/* Booking ID + truck icon */}
                      <div className="flex items-center gap-3 w-32 shrink-0">
                        <div className="w-8 h-8 rounded-lg dark:bg-[#161B25] bg-[#F1F5F9] flex items-center justify-center shrink-0">
                          <Truck size={13} className="text-[#FF7A00]" />
                        </div>
                        <span className="font-mono text-xs dark:text-[#434D5E] text-[#94A3B8] group-hover:dark:text-[#8892A4] transition-colors">
                          {b.id.slice(0, 8)}…
                        </span>
                      </div>

                      {/* Shipper + route */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold dark:text-white text-[#0F172A] truncate leading-none">{b.shipper_name}</p>
                        <p className="text-xs dark:text-[#8892A4] text-[#64748B] truncate mt-1">
                          {b.source_address}
                          <span className="dark:text-[#434D5E] text-[#CBD5E1] mx-1">→</span>
                          {b.destination_address}
                        </p>
                      </div>

                      {/* Time */}
                      <div className="hidden md:block w-16 text-right">
                        <span className="text-[10px] font-medium dark:text-[#434D5E] text-[#94A3B8]">
                          {timeAgo(b.created_at)}
                        </span>
                      </div>

                      {/* Price + weight */}
                      <div className="text-right hidden sm:block w-20">
                        <p className="text-sm font-bold dark:text-white text-[#0F172A]">{inr(b.final_price ?? b.quoted_price)}</p>
                        <p className="text-[10px] dark:text-[#8892A4] text-[#64748B]">{b.weight_kg} kg</p>
                      </div>

                      {/* Status badge with dot */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`w-1.5 h-1.5 rounded-full ${dot} ${b.status === 'in_transit' ? 'animate-pulse' : ''}`} />
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
