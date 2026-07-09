'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapPin, Truck, RefreshCw, Loader2, AlertTriangle } from 'lucide-react'
import {
  listBookings,
  getBookingLocation,
  cancelBooking,
  type Booking,
  type BookingStatus,
  type DriverLocation,
} from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

const STATUS_BADGE: Record<BookingStatus, { label: string; className: string }> = {
  pending:     { label: 'Pending',     className: 'bg-zinc-500/15 text-zinc-500' },
  negotiating: { label: 'Negotiating', className: 'bg-blue-500/15 text-blue-500' },
  accepted:    { label: 'Assigned',    className: 'bg-amber-500/15 text-amber-500' },
  in_transit:  { label: 'In Transit',  className: 'bg-[#F97316]/15 text-[#F97316]' },
  completed:   { label: 'Delivered',   className: 'bg-green-500/15 text-green-600' },
  paid:        { label: 'Paid',        className: 'bg-emerald-500/15 text-emerald-600' },
  cancelled:   { label: 'Cancelled',   className: 'bg-red-500/15 text-red-500' },
}

// Backend cancelBooking accepts an admin/ops actor only from these states.
const CANCELLABLE: BookingStatus[] = ['pending', 'negotiating', 'accepted']

const LOCATION_POLL_MS = 15_000
const STALE_AFTER_MS = 30_000

function ageText(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

export default function TripsPage() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [locations, setLocations] = useState<Record<string, DriverLocation | null>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await listBookings()
      setBookings(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trips')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Live location for in-transit trips, refreshed on an interval (D-010).
  const inTransitIds = useMemo(
    () => bookings.filter(b => b.status === 'in_transit').map(b => b.id),
    [bookings],
  )
  useEffect(() => {
    if (inTransitIds.length === 0) return
    let cancelled = false
    async function pollLocations() {
      const entries = await Promise.all(
        inTransitIds.map(async (id) => {
          try { return [id, await getBookingLocation(id)] as const }
          catch { return [id, null] as const }
        }),
      )
      if (!cancelled) setLocations(Object.fromEntries(entries))
    }
    pollLocations()
    const t = setInterval(pollLocations, LOCATION_POLL_MS)
    return () => { cancelled = true; clearInterval(t) }
  }, [inTransitIds])

  const active = useMemo(
    () => bookings.filter(b => b.status !== 'cancelled'),
    [bookings],
  )
  const liveCount = inTransitIds.length

  async function confirmCancel() {
    if (!cancelTarget) return
    const id = cancelTarget.id
    setCancelTarget(null)
    try {
      const updated = await cancelBooking(id)
      setBookings(prev => prev.map(b => (b.id === id ? updated : b)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed')
    }
  }

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white text-[#09090B]">Live Trips</h1>
          <p className="text-sm dark:text-[#888] text-[#71717A] mt-1">
            {loading ? 'Loading…' : `${active.length} active · ${liveCount} in transit`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {liveCount > 0 && (
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#22C55E] animate-pulse" />
              <span className="text-sm font-medium text-[#22C55E]">Live tracking active</span>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => load()}>
            <RefreshCw size={14} /> Refresh
          </Button>
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
      ) : active.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Truck size={28} className="text-[#F97316] mb-3" />
          <p className="text-sm dark:text-white text-[#09090B] font-medium">No active trips</p>
          <p className="text-xs dark:text-[#888] text-[#71717A] mt-1">Trips appear here once a booking is placed.</p>
        </div>
      ) : (
        <div className="rounded-2xl border dark:border-[#2A2A2A] border-[#E4E4E7] overflow-hidden dark:bg-[#111111] bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Booking</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Live position</TableHead>
                <TableHead className="text-right">Override</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {active.map((b) => {
                const loc = locations[b.id]
                const ageMs = loc ? Date.now() - new Date(loc.updated_at).getTime() : Infinity
                const fresh = ageMs <= STALE_AFTER_MS
                const badge = STATUS_BADGE[b.status]
                return (
                  <TableRow key={b.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-[#F97316]/10 flex items-center justify-center shrink-0">
                          <Truck size={14} className="text-[#F97316]" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-mono text-xs dark:text-white text-[#09090B]">{b.id.slice(0, 8)}…</p>
                          <p className="text-xs dark:text-[#888] text-[#71717A] truncate max-w-[160px]">{b.shipper_name}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs dark:text-[#CCC] text-[#3F3F46] max-w-[220px]">
                        <p className="truncate">{b.source_address}</p>
                        <p className="truncate dark:text-[#888] text-[#71717A]">→ {b.destination_address}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={badge.className}>{badge.label}</Badge>
                    </TableCell>
                    <TableCell>
                      {b.status === 'in_transit' ? (
                        loc ? (
                          <div className="flex items-center gap-1.5 text-xs">
                            <MapPin size={12} className={fresh ? 'text-[#22C55E]' : 'text-amber-500'} />
                            <span className="dark:text-[#CCC] text-[#3F3F46] font-mono">
                              {loc.lat.toFixed(3)}, {loc.lng.toFixed(3)}
                            </span>
                            <span className={fresh ? 'text-[#22C55E]' : 'text-amber-500'}>
                              · {ageText(ageMs)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs dark:text-[#888] text-[#71717A]">awaiting GPS…</span>
                        )
                      ) : (
                        <span className="text-xs dark:text-[#555] text-[#A1A1AA]">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {CANCELLABLE.includes(b.status) ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-red-500 border-red-500/30 hover:bg-red-500/10"
                          onClick={() => setCancelTarget(b)}
                        >
                          Cancel
                        </Button>
                      ) : (
                        <span className="text-xs dark:text-[#555] text-[#A1A1AA]">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Override note: force-complete / reassign land once backend adds the
          ops-only endpoints (raised as a blocker). Cancel is live today. */}
      <p className="text-xs dark:text-[#555] text-[#A1A1AA]">
        Override: cancelling a stuck trip is available before pickup (pending / assigned).
        Force-complete and reassign for in-transit trips are pending backend ops endpoints.
      </p>

      <Dialog open={!!cancelTarget} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this trip?</DialogTitle>
            <DialogDescription>
              {cancelTarget && (
                <>Booking <span className="font-mono">{cancelTarget.id.slice(0, 8)}…</span> ({cancelTarget.shipper_name}) will be cancelled. This cannot be undone.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>Keep trip</Button>
            <Button
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={confirmCancel}
            >
              Cancel trip
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
