'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapPin, Truck, RefreshCw, Loader2, AlertTriangle } from 'lucide-react'
import {
  listBookings,
  getBookingLocation,
  cancelBooking,
  forceCompleteBooking,
  reassignBooking,
  type Booking,
  type BookingStatus,
  type DriverLocation,
} from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  // Evidence captured, receiver could not confirm — waiting on an ops close (0025).
  delivery_asserted: { label: 'Awaiting Close', className: 'bg-amber-500/15 text-amber-500' },
  completed:   { label: 'Delivered',   className: 'bg-green-500/15 text-green-600' },
  paid:        { label: 'Paid',        className: 'bg-emerald-500/15 text-emerald-600' },
  cancelled:   { label: 'Cancelled',   className: 'bg-red-500/15 text-red-500' },
}

// Which ops override each status permits (mirrors the T-BE-6 state guards).
const CANCELLABLE: BookingStatus[] = ['pending', 'negotiating', 'accepted']
// 'delivery_asserted' mirrors OPS_FORCE_COMPLETE_SOURCES in bt-booking-service — and it
// is not optional here. An asserted delivery is closed by OPS and by nobody else, so a
// console that does not offer the button parks the trip forever one step short of paid.
// pod_strength stays 'asserted' across the close; the console surface that SHOWS which
// proof is being closed is a later PR.
const FORCE_COMPLETABLE: BookingStatus[] = ['accepted', 'in_transit', 'delivery_asserted']
const REASSIGNABLE: BookingStatus[] = ['accepted', 'in_transit']

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  const [forceTarget, setForceTarget] = useState<Booking | null>(null)
  const [reassignTarget, setReassignTarget] = useState<Booking | null>(null)
  const [reassignDriverId, setReassignDriverId] = useState('')
  const [busy, setBusy] = useState(false)

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

  function applyUpdate(updated: Booking) {
    setBookings(prev => prev.map(b => (b.id === updated.id ? updated : b)))
  }

  async function confirmCancel() {
    if (!cancelTarget) return
    const id = cancelTarget.id
    setCancelTarget(null)
    try {
      applyUpdate(await cancelBooking(id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed')
    }
  }

  async function confirmForceComplete() {
    if (!forceTarget) return
    const id = forceTarget.id
    setBusy(true)
    try {
      applyUpdate(await forceCompleteBooking(id))
      setForceTarget(null)
      setError(null)
    } catch (err) {
      // Surface the real backend error (403 non-ops / 409 illegal source / 404).
      setError(err instanceof Error ? err.message : 'Force-complete failed')
    } finally {
      setBusy(false)
    }
  }

  async function confirmReassign() {
    if (!reassignTarget) return
    const driverId = reassignDriverId.trim()
    if (!UUID_RE.test(driverId)) {
      setError('Enter a valid driver UUID to reassign')
      return
    }
    setBusy(true)
    try {
      applyUpdate(await reassignBooking(reassignTarget.id, driverId))
      setReassignTarget(null)
      setReassignDriverId('')
      setError(null)
    } catch (err) {
      // Surface the real backend error (403 non-ops / 404 booking-or-driver-missing).
      setError(err instanceof Error ? err.message : 'Reassign failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 animate-slide-up">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-black dark:text-white text-[#0F172A] tracking-tight">Live Trips</h1>
            {liveCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border"
                style={{ background: 'rgba(34,197,94,0.06)', borderColor: 'rgba(34,197,94,0.2)' }}>
                <div className="relative w-2 h-2">
                  <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-60" />
                  <span className="absolute inset-0 rounded-full bg-emerald-500" />
                </div>
                <span className="text-xs font-bold text-emerald-500">{liveCount} tracking live</span>
              </div>
            )}
          </div>
          <p className="text-sm dark:text-[#8892A4] text-[#64748B]">
            {loading ? 'Loading…' : (
              <><span className="dark:text-white text-[#0F172A] font-semibold">{active.length}</span> active · <span className="dark:text-white text-[#0F172A] font-semibold">{liveCount}</span> in transit</>
            )}
          </p>
        </div>
        <Button
          variant="outline" size="sm"
          onClick={() => load()}
          className="flex items-center gap-1.5 dark:border-[#1E2535] dark:text-[#8892A4] dark:hover:text-white dark:hover:bg-[#161B25]"
        >
          <RefreshCw size={13} /> Refresh
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2.5 rounded-xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-400 animate-slide-up">
          <AlertTriangle size={14} className="shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(255,122,0,0.08)', border: '1px solid rgba(255,122,0,0.15)' }}>
            <Loader2 className="h-6 w-6 animate-spin text-[#FF7A00]" />
          </div>
          <p className="text-sm dark:text-[#8892A4] text-[#64748B] font-medium animate-pulse">Loading trips…</p>
        </div>
      ) : active.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'rgba(255,122,0,0.08)', border: '1px solid rgba(255,122,0,0.15)' }}>
            <Truck size={24} className="text-[#FF7A00]" />
          </div>
          <p className="text-sm dark:text-white text-[#0F172A] font-bold">No active trips</p>
          <p className="text-xs dark:text-[#8892A4] text-[#64748B] mt-1.5 max-w-xs">Trips appear here once a booking is placed and accepted by a driver.</p>
        </div>
      ) : (
        <div className="rounded-2xl border overflow-hidden dark:border-[#1E2535] border-[#E2E8F0] dark:bg-[#0E1117] bg-white animate-fade-in">
          <Table>
            <TableHeader>
              <TableRow className="dark:border-[#1E2535] border-[#E2E8F0] dark:bg-[#080A0F]/50">
                <TableHead className="font-black text-[10px] uppercase tracking-widest dark:text-[#434D5E] text-[#94A3B8] py-3">Booking</TableHead>
                <TableHead className="font-black text-[10px] uppercase tracking-widest dark:text-[#434D5E] text-[#94A3B8]">Route</TableHead>
                <TableHead className="font-black text-[10px] uppercase tracking-widest dark:text-[#434D5E] text-[#94A3B8]">Status</TableHead>
                <TableHead className="font-black text-[10px] uppercase tracking-widest dark:text-[#434D5E] text-[#94A3B8]">GPS Position</TableHead>
                <TableHead className="text-right font-black text-[10px] uppercase tracking-widest dark:text-[#434D5E] text-[#94A3B8]">Override</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {active.map((b, i) => {
                const loc = locations[b.id]
                const ageMs = loc ? Date.now() - new Date(loc.updated_at).getTime() : Infinity
                const fresh = ageMs <= STALE_AFTER_MS
                const badge = STATUS_BADGE[b.status]
                return (
                  <TableRow
                    key={b.id}
                    className="dark:border-[#1E2535] border-[#F1F5F9] transition-colors dark:hover:bg-[#161B25]/60 hover:bg-[#F8FAFC] animate-fade-in"
                    style={{ animationDelay: `${i * 40}ms` }}
                  >
                    <TableCell className="py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                          style={{ background: 'rgba(255,122,0,0.08)', border: '1px solid rgba(255,122,0,0.15)' }}>
                          <Truck size={14} className="text-[#FF7A00]" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-mono text-xs font-semibold dark:text-white text-[#0F172A]">{b.id.slice(0, 8)}…</p>
                          <p className="text-[11px] dark:text-[#8892A4] text-[#64748B] truncate max-w-[150px] mt-0.5">{b.shipper_name}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs max-w-[220px] space-y-1">
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                          <p className="truncate dark:text-white/80 text-[#374151] font-medium">{b.source_address}</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
                          <p className="truncate dark:text-[#8892A4] text-[#64748B]">{b.destination_address}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${badge.className.includes('F97316') || badge.className.includes('amber') ? 'bg-[#FF7A00]' : badge.className.includes('green') ? 'bg-emerald-500' : badge.className.includes('blue') ? 'bg-blue-400' : badge.className.includes('red') ? 'bg-red-500' : 'bg-zinc-500'} ${b.status === 'in_transit' ? 'animate-pulse' : ''}`} />
                        <Badge variant="secondary" className={badge.className}>{badge.label}</Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      {b.status === 'in_transit' ? (
                        loc ? (
                          <div className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg font-mono border ${
                            fresh
                              ? 'bg-emerald-500/8 border-emerald-500/20 text-emerald-500'
                              : 'bg-amber-500/8 border-amber-500/20 text-amber-500'
                          }`}>
                            <MapPin size={11} />
                            {loc.lat.toFixed(3)}, {loc.lng.toFixed(3)}
                            <span className="opacity-60">· {ageText(ageMs)}</span>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs dark:text-[#434D5E] text-[#94A3B8] px-2 py-1 rounded-lg dark:bg-[#161B25] bg-[#F1F5F9]">
                            <span className="w-1 h-1 rounded-full bg-current animate-pulse" />
                            awaiting GPS
                          </span>
                        )
                      ) : (
                        <span className="text-xs dark:text-[#2A3449] text-[#CBD5E1]">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {(() => {
                        const canForce = FORCE_COMPLETABLE.includes(b.status)
                        const canReassign = REASSIGNABLE.includes(b.status)
                        const canCancel = CANCELLABLE.includes(b.status)
                        if (!canForce && !canReassign && !canCancel) {
                          return <span className="text-xs dark:text-[#2A3449] text-[#CBD5E1]">—</span>
                        }
                        return (
                          <div className="flex items-center justify-end gap-2">
                            {canForce && (
                              <Button
                                variant="outline" size="sm"
                                className="text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/8 dark:border-emerald-500/25 text-xs font-semibold"
                                onClick={() => setForceTarget(b)}
                              >
                                Force-complete
                              </Button>
                            )}
                            {canReassign && (
                              <Button
                                variant="outline" size="sm"
                                className="dark:border-[#1E2535] dark:text-[#8892A4] dark:hover:text-white dark:hover:bg-[#161B25] text-xs font-semibold"
                                onClick={() => { setReassignDriverId(''); setReassignTarget(b) }}
                              >
                                Reassign
                              </Button>
                            )}
                            {canCancel && (
                              <Button
                                variant="outline" size="sm"
                                className="text-red-400 border-red-500/25 hover:bg-red-500/8 text-xs font-semibold"
                                onClick={() => setCancelTarget(b)}
                              >
                                Cancel
                              </Button>
                            )}
                          </div>
                        )
                      })()}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Override capability note */}
      <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl dark:bg-[#0E1117] bg-[#F8FAFC] border dark:border-[#1E2535] border-[#E2E8F0]">
        <div className="w-4 h-4 rounded-md flex items-center justify-center shrink-0 mt-0.5"
          style={{ background: 'rgba(255,122,0,0.12)' }}>
          <span className="text-[#FF7A00] text-[8px] font-black">i</span>
        </div>
        <p className="text-xs dark:text-[#434D5E] text-[#94A3B8] leading-relaxed">
          Ops overrides: <span className="dark:text-[#8892A4] text-[#64748B] font-semibold">Cancel</span> (before pickup), <span className="dark:text-[#8892A4] text-[#64748B] font-semibold">Force-complete</span> and <span className="dark:text-[#8892A4] text-[#64748B] font-semibold">Reassign</span> (assigned / in transit) act on the real trip via ops-only endpoints. Actions require an ops/admin session.
        </p>
      </div>

      {/* Cancel */}
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
            <Button className="bg-red-600 text-white hover:bg-red-700" onClick={confirmCancel}>
              Cancel trip
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Force-complete */}
      <Dialog open={!!forceTarget} onOpenChange={(open) => !open && !busy && setForceTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Force-complete this trip?</DialogTitle>
            <DialogDescription>
              {forceTarget && (
                <>Booking <span className="font-mono">{forceTarget.id.slice(0, 8)}…</span> ({forceTarget.shipper_name}) will be marked <span className="font-medium">delivered</span> and trigger payout — bypassing the driver. Use only when the trip is physically complete.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setForceTarget(null)}>Back</Button>
            <Button className="bg-green-600 text-white hover:bg-green-700" disabled={busy} onClick={confirmForceComplete}>
              {busy && <Loader2 size={14} className="animate-spin" />} Force-complete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reassign */}
      <Dialog open={!!reassignTarget} onOpenChange={(open) => !open && !busy && setReassignTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reassign to another driver</DialogTitle>
            <DialogDescription>
              {reassignTarget && (
                <>Move booking <span className="font-mono">{reassignTarget.id.slice(0, 8)}…</span> to a different driver. The trip status is kept.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="py-1">
            <label htmlFor="reassign-driver" className="text-sm font-medium">New driver ID (UUID)</label>
            <Input
              id="reassign-driver"
              value={reassignDriverId}
              onChange={(e) => setReassignDriverId(e.target.value)}
              placeholder="e.g. 3f2a…-…-…"
              autoComplete="off"
              className="mt-1.5 font-mono"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setReassignTarget(null)}>Back</Button>
            <Button disabled={busy || !UUID_RE.test(reassignDriverId.trim())} onClick={confirmReassign}>
              {busy && <Loader2 size={14} className="animate-spin" />} Reassign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
