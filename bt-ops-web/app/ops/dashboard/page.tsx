'use client'

import { useEffect, useMemo, useState } from 'react'
import { Truck, MapPin, TrendingUp, Loader2, AlertTriangle, PackageCheck } from 'lucide-react'
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

function inr(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`
}

export default function OpsDashboard() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listBookings()
      .then((data) => { setBookings(data); setError(null) })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

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
      .slice(0, 6),
    [bookings],
  )

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold dark:text-white text-[#09090B]">Operations Overview</h1>
          <p className="text-sm dark:text-[#888] text-[#71717A] mt-1">
            {loading ? 'Loading…' : `${stats.total} bookings on the platform`}
          </p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#22C55E]/10 border-[#22C55E]/20 border">
          <span className="w-2 h-2 rounded-full bg-[#22C55E] animate-pulse" />
          <span className="text-sm font-medium text-[#22C55E]">Platform Live</span>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-500">
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-[#F97316]" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Active Trips" value={String(stats.active)} sub="Assigned + in transit" icon={MapPin} accent />
            <StatCard label="In Transit" value={String(stats.inTransit)} sub="Live on the road now" icon={Truck} />
            <StatCard label="Delivered" value={String(stats.delivered)} sub="Completed + paid" icon={PackageCheck} />
            <StatCard label="Completion Rate" value={stats.completionRate === '—' ? '—' : `${stats.completionRate}%`} sub="Of non-cancelled trips" icon={TrendingUp} />
          </div>

          <div className="dark:bg-[#111111] bg-white rounded-2xl border dark:border-[#2A2A2A] border-[#E4E4E7]">
            <div className="px-5 py-4 flex items-center justify-between border-b dark:border-[#2A2A2A] border-[#E4E4E7]">
              <h2 className="font-semibold dark:text-white text-[#09090B]">Recent Bookings</h2>
              <a href="/ops/trips" className="text-xs text-[#F97316] hover:underline font-medium">View live trips →</a>
            </div>
            {recent.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm dark:text-[#888] text-[#71717A]">No bookings yet.</p>
            ) : (
              <div className="divide-y dark:divide-[#1A1A1A] divide-[#F4F4F5]">
                {recent.map((b) => {
                  const badge = STATUS_BADGE[b.status]
                  return (
                    <div key={b.id} className="px-5 py-3.5 flex items-center gap-4 hover:dark:bg-[#1A1A1A] hover:bg-[#FAFAFA] transition-colors">
                      <div className="w-16 text-xs font-mono dark:text-[#555] text-[#A1A1AA]">{b.id.slice(0, 8)}…</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium dark:text-white text-[#09090B] truncate">{b.shipper_name}</p>
                        <p className="text-xs dark:text-[#888] text-[#71717A] truncate">{b.source_address} → {b.destination_address}</p>
                      </div>
                      <div className="text-right hidden sm:block">
                        <p className="text-sm font-semibold dark:text-white text-[#09090B]">{inr(b.final_price ?? b.quoted_price)}</p>
                        <p className="text-xs dark:text-[#888] text-[#71717A]">{b.weight_kg} kg</p>
                      </div>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
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
