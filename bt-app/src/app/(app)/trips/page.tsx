'use client'

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  AlertTriangle, ArrowRight, RefreshCw, Truck, UserRound, Users, X,
} from 'lucide-react'
import { PageHeader } from '@/components/app-shell'
import { Card, CardHead, Empty, ErrorNote, Loading, Stat } from '@/components/stat'
import {
  ApiError, assignToBooking, listFleetBookings, listFleetDrivers, listVehicles,
} from '@/lib/api'
import { inr, inrCompact, shortDate, timeAgo, tons } from '@/lib/format'
import { bookingStatusConfig } from '@/lib/status'
import type { BookingStatus, FleetBooking, FleetDriver, Vehicle } from '@/lib/types'

/**
 * Trips — where a booking the fleet has won becomes a trip that can actually roll.
 *
 * THE GATE IS REAL. bt-booking-service/src/lib/state.ts::assertFleetAssignmentReady
 * refuses accepted -> in_transit for any booking carrying a fleet_owner_id until a
 * live vehicle_assignments row exists. A fleet may bid with no free truck, so the
 * award binds nothing physical; until the owner pairs a driver AND a truck here the
 * trip has no truck of record and its distance, fuel and per-asset P&L would be
 * unattributable. So this page is not a convenience — it is the only way a won load
 * ever departs.
 *
 * MUTUAL EXCLUSION IS ALSO REAL. bt-fleet-service/src/lib/assignment.ts INSERTs and
 * catches 23505 on three partial-unique indexes (one live assignment per booking,
 * per vehicle, per driver) rather than pre-checking, because check-then-insert has
 * a race in which two dispatchers hand the same truck to two loads. The dialog
 * therefore treats a rejection as normal traffic: it stays open, re-reads who is
 * live, and says which of the two is already out.
 */

// GET /fleet/bookings returns the booking columns listed in
// bt-fleet-service/src/lib/assignment.ts (BOOKING_COLUMNS) — there is no join to
// the shipper, the truck or the driver. RC number and driver name below are
// therefore resolved locally from the fleet's own roster and vehicle list, which
// this page already loads for the assign dialog.

// GET /fleet/vehicles decorates each row (routes/vehicles.ts) with age_years,
// status and current_assignment; lib/types.ts Vehicle stops at the DB columns.
// Optional so a service that stops sending them degrades instead of crashing.
type LiveAssignment = {
  assignment_id: string
  booking_id: string
  driver_id: string
  driver_name: string | null
  assigned_at: string
}
type FleetVehicleRow = Vehicle & {
  status?: 'on_trip' | 'idle'
  current_assignment?: LiveAssignment | null
}

// GET /fleet/drivers nests the identity under `driver` (routes/drivers.ts), while
// FleetDriver declares those fields flat. Read both, prefer the nested one.
type DriverIdentity = { driver_id: string; full_name: string | null; phone_number: string | null }
type RosterRow = FleetDriver & { driver?: DriverIdentity | null }

const nameOf = (r: RosterRow) => r.driver?.full_name ?? r.full_name ?? null
const phoneOf = (r: RosterRow) => r.driver?.phone_number ?? r.phone_number ?? null

/** bt-fleet-service caps each booking list at 50 (BookingListQuery default). */
const PAGE_LIMIT = 50

/**
 * bookings.status is a plain string on the wire (BookingRow), so an unmapped value
 * degrades to a neutral pill instead of rendering `undefined.color` into a class.
 */
function pillFor(status: BookingStatus): { label: string; color: string } {
  return bookingStatusConfig[status] ?? {
    label: String(status).replace(/_/g, ' '),
    color: 'bg-gray-100 text-gray-600',
  }
}

type TabKey = 'needs' | 'in_transit' | 'completed' | 'paid' | 'all'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'needs',      label: 'Needs assignment' },
  { key: 'in_transit', label: 'In transit' },
  { key: 'completed',  label: 'Completed' },
  { key: 'paid',       label: 'Paid' },
  { key: 'all',        label: 'All' },
]

type Lists = {
  accepted: FleetBooking[]
  in_transit: FleetBooking[]
  completed: FleetBooking[]
  paid: FleetBooking[]
  all: FleetBooking[]
}

function errText(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return fallback
}

/** A trip departs only when BOTH halves are bound — that is the server's rule. */
function needsCrew(b: FleetBooking): boolean {
  return !b.vehicle_id || !b.driver_id
}

function priceOf(b: FleetBooking): number {
  return b.final_price ?? b.quoted_price
}

function sum(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0)
}

/** Whole days from today to a pickup date; null if the date is unparseable. */
function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return null
  then.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((then.getTime() - today.getTime()) / 86_400_000)
}

function routeLabel(b: FleetBooking): string {
  return `${b.source_address} → ${b.destination_address}`
}

export default function TripsPage() {
  const [lists, setLists] = useState<Lists | null>(null)
  const [vehicles, setVehicles] = useState<FleetVehicleRow[]>([])
  const [drivers, setDrivers] = useState<RosterRow[]>([])
  const [tab, setTab] = useState<TabKey>('needs')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [crewError, setCrewError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [assignTarget, setAssignTarget] = useState<FleetBooking | null>(null)

  // No state is written before the first await, so the mount effect below does not
  // set state synchronously; the Refresh button raises the spinner itself.
  const load = useCallback(async () => {
    // One list per tab: the service filters on an exact status and paginates each
    // query independently, so a fleet with 200 paid trips cannot push today's
    // unassigned queue past the 50-row window.
    const [booked, crew] = await Promise.allSettled([
      Promise.all([
        listFleetBookings('accepted'),
        listFleetBookings('in_transit'),
        listFleetBookings('completed'),
        listFleetBookings('paid'),
        listFleetBookings(),
      ]),
      Promise.all([listVehicles(), listFleetDrivers()]),
    ])

    if (booked.status === 'fulfilled') {
      const [accepted, in_transit, completed, paid, all] = booked.value
      setLists({ accepted, in_transit, completed, paid, all })
      setError(null)
    } else {
      setError(errText(booked.reason, 'Could not load trips'))
    }

    if (crew.status === 'fulfilled') {
      setVehicles(crew.value[0] as FleetVehicleRow[])
      setDrivers(crew.value[1] as RosterRow[])
      setCrewError(null)
    } else {
      // The table still renders without this; only the pairing step needs it.
      setCrewError(errText(crew.reason, 'Could not load your trucks and drivers'))
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  /** Re-read who is live. Used after a rejected assignment, where staleness IS the error. */
  const refreshCrew = useCallback(async () => {
    try {
      const [v, d] = await Promise.all([listVehicles(), listFleetDrivers()])
      setVehicles(v as FleetVehicleRow[])
      setDrivers(d as RosterRow[])
      return { vehicles: v as FleetVehicleRow[], drivers: d as RosterRow[] }
    } catch {
      return null
    }
  }, [])

  const vehicleById = new Map(vehicles.map(v => [v.id, v]))
  const driverById = new Map(drivers.map(d => [d.driver_id, d]))

  const accepted = lists?.accepted ?? []
  const needs = accepted.filter(needsCrew)
  const crewed = accepted.filter(b => !needsCrew(b))
  const inTransit = lists?.in_transit ?? []

  const counts: Record<TabKey, number> = {
    needs: needs.length,
    in_transit: inTransit.length,
    completed: lists?.completed.length ?? 0,
    paid: lists?.paid.length ?? 0,
    all: lists?.all.length ?? 0,
  }

  const onTripVehicles = vehicles.filter(v => v.current_assignment != null || v.status === 'on_trip')
  const idleVehicles = vehicles.length - onTripVehicles.length
  const busyDriverIds = new Set(
    vehicles.map(v => v.current_assignment?.driver_id).filter((id): id is string => Boolean(id)),
  )
  const activeDrivers = drivers.filter(d => d.status === 'active')
  const freeDrivers = activeDrivers.filter(d => !busyDriverIds.has(d.driver_id)).length
  const waitingValue = sum(needs.map(priceOf))

  const rows: FleetBooking[] =
    tab === 'needs' ? needs
    : tab === 'in_transit' ? inTransit
    : tab === 'completed' ? (lists?.completed ?? [])
    : tab === 'paid' ? (lists?.paid ?? [])
    : (lists?.all ?? [])

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Trips"
        info="A won load can't depart until you assign both a truck and a driver."
        subtitle={lists ? `${needs.length} waiting on a crew · ${inTransit.length} on the road` : undefined}
        actions={
          <button
            onClick={() => { setNotice(null); setLoading(true); void load() }}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium px-4 py-2.5 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />


      {loading ? (
        <Loading label="Loading trips" />
      ) : error ? (
        <div className="space-y-3">
          <ErrorNote message={error} />
          <button
            onClick={() => { setLoading(true); void load() }}
            className="rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium px-4 py-2.5"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat
              label="Waiting on a crew"
              value={needs.length}
              tone={needs.length > 0 ? 'warn' : 'good'}
              sub={needs.length > 0 ? `${inrCompact(waitingValue)} of work not moving` : 'Every won load is crewed'}
              icon={<AlertTriangle className="w-4 h-4" />}
            />
            <Stat
              label="On the road"
              value={inTransit.length}
              sub={crewed.length > 0 ? `${crewed.length} crewed, yet to depart` : 'No trip is waiting to start'}
              icon={<ArrowRight className="w-4 h-4" />}
            />
            <Stat
              label="Idle trucks"
              value={crewError ? '—' : idleVehicles}
              sub={crewError ? 'Fleet list unavailable' : `${onTripVehicles.length} of ${vehicles.length} on a live trip`}
              icon={<Truck className="w-4 h-4" />}
            />
            <Stat
              label="Free drivers"
              value={crewError ? '—' : freeDrivers}
              sub={crewError ? 'Roster unavailable' : `${activeDrivers.length} active on the roster`}
              icon={<Users className="w-4 h-4" />}
            />
          </div>

          {crewError && (
            <ErrorNote message={`Assigning is unavailable — ${crewError}`} />
          )}

          {notice && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              {notice}
            </div>
          )}

          {/* Tabs — the owner's queue first, because that is the only one with work in it. */}
          <div className="flex flex-wrap gap-1 p-1 bg-white rounded-xl border border-gray-200 shadow-sm w-fit">
            {TABS.map(t => {
              const active = tab === t.key
              const n = counts[t.key]
              return (
                <button
                  key={t.key}
                  onClick={() => { setTab(t.key); setNotice(null) }}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {t.label}
                  <span className={`text-xs tabular-nums rounded-full px-1.5 py-0.5 ${
                    active ? 'bg-blue-500 text-white'
                    : t.key === 'needs' && n > 0 ? 'bg-orange-100 text-orange-700'
                    : 'bg-gray-100 text-gray-500'
                  }`}>
                    {n >= PAGE_LIMIT ? `${PAGE_LIMIT}+` : n}
                  </span>
                </button>
              )
            })}
          </div>

          {tab === 'needs' ? (
            <>
              <Card>
                <CardHead title="Awaiting crew" />
                {needs.length === 0 ? (
                  <Empty
                    title="Nothing waiting on you"
                    hint="Every accepted booking already has a truck and driver."
                  />
                ) : (
                  <BookingTable
                    rows={needs}
                    vehicleById={vehicleById}
                    driverById={driverById}
                    onAssign={crewError ? undefined : setAssignTarget}
                  />
                )}
              </Card>

              {crewed.length > 0 && (
                <Card>
                  <CardHead
                    title="Crewed — clear to depart"
                    sub="Waiting on the driver to start"
                  />
                  <BookingTable rows={crewed} vehicleById={vehicleById} driverById={driverById} />
                </Card>
              )}
            </>
          ) : (
            <Card>
              <CardHead
                title={TABS.find(t => t.key === tab)?.label ?? 'Trips'}
                sub={rows.length >= PAGE_LIMIT
                  ? `Showing the ${PAGE_LIMIT} most recent`
                  : `${rows.length} ${rows.length === 1 ? 'trip' : 'trips'}`}
              />
              {rows.length === 0 ? (
                <Empty
                  title="No trips here"
                  hint={tab === 'in_transit'
                    ? 'A crewed trip appears here once the driver starts it.'
                    : 'Nothing in this state yet.'}
                />
              ) : (
                <BookingTable
                  rows={rows}
                  vehicleById={vehicleById}
                  driverById={driverById}
                  onAssign={crewError ? undefined : setAssignTarget}
                />
              )}
            </Card>
          )}

        </div>
      )}

      {assignTarget && (
        <AssignDialog
          booking={assignTarget}
          vehicles={vehicles}
          drivers={drivers}
          refreshCrew={refreshCrew}
          onClose={() => setAssignTarget(null)}
          onAssigned={(rc, driverName) => {
            setAssignTarget(null)
            setNotice(`${rc} and ${driverName} are on ${routeLabel(assignTarget)}. The driver can start the trip now.`)
            // Silent refetch: the confirmation stays on screen while the queue,
            // the busy-truck map and the roster catch up underneath it.
            void load()
          }}
        />
      )}
    </div>
  )
}

// ── Table ─────────────────────────────────────────────────────

function BookingTable({
  rows, vehicleById, driverById, onAssign,
}: {
  rows: FleetBooking[]
  vehicleById: Map<string, FleetVehicleRow>
  driverById: Map<string, RosterRow>
  onAssign?: (b: FleetBooking) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1040px]">
        <thead>
          <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
            <th className="py-2.5 px-4 text-left font-medium">Route</th>
            <th className="py-2.5 px-4 text-left font-medium">Load</th>
            <th className="py-2.5 px-4 text-left font-medium">Pickup</th>
            <th className="py-2.5 px-4 text-right font-medium">Price</th>
            <th className="py-2.5 px-4 text-left font-medium">Status</th>
            <th className="py-2.5 px-4 text-left font-medium">Truck &amp; driver</th>
            <th className="py-2.5 px-4 text-right font-medium"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(b => {
            const pill = pillFor(b.status)
            const vehicle = b.vehicle_id ? vehicleById.get(b.vehicle_id) ?? null : null
            const driver = b.driver_id ? driverById.get(b.driver_id) ?? null : null
            const shipper = (b.shipper_name ?? '').trim()
            const assignable = b.status === 'accepted' && needsCrew(b)

            return (
              <tr key={b.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                <td className="py-3 px-4 text-sm">
                  <div className="flex items-center gap-1.5 font-medium text-gray-900">
                    <span className="truncate max-w-[180px]" title={b.source_address}>{b.source_address}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    <span className="truncate max-w-[180px]" title={b.destination_address}>{b.destination_address}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {/* The booking list carries no shipper join today, so this line
                        appears only when the service does send a name. */}
                    {shipper !== '' ? shipper : `Booked ${shortDate(b.created_at)}`}
                    {b.booking_type ? ` · ${b.booking_type.replace(/_/g, ' ')}` : ''}
                  </div>
                </td>

                <td className="py-3 px-4 text-sm">
                  <div className="text-gray-900">{(b.load_type || 'Load').replace(/_/g, ' ')}</div>
                  <div className="text-xs text-gray-500 tabular-nums">{tons(b.weight_kg)}</div>
                </td>

                <td className="py-3 px-4 text-sm">
                  <div className="text-gray-900">{shortDate(b.pickup_date)}</div>
                  {assignable && <PickupUrgency iso={b.pickup_date} />}
                </td>

                <td className="py-3 px-4 text-sm text-right">
                  <div className="text-gray-900 font-medium tabular-nums">{inr(priceOf(b))}</div>
                  <div className="text-xs text-gray-400">{b.final_price === null ? 'quoted' : 'final'}</div>
                </td>

                <td className="py-3 px-4 text-sm">
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${pill.color}`}>
                    {pill.label}
                  </span>
                </td>

                <td className="py-3 px-4 text-sm">
                  {b.vehicle_id || b.driver_id ? (
                    <div>
                      <div className="font-medium text-gray-900 tabular-nums">
                        {b.vehicle_id ? vehicle?.rc_number ?? 'Truck outside this fleet' : 'No truck'}
                      </div>
                      <div className="text-xs text-gray-500">
                        {b.driver_id ? (driver ? nameOf(driver) ?? 'Unnamed driver' : 'Driver off this roster') : 'No driver'}
                      </div>
                    </div>
                  ) : (
                    <span className="text-gray-400">Not assigned</span>
                  )}
                </td>

                <td className="py-3 px-4 text-sm text-right">
                  {assignable && onAssign && (
                    <button
                      onClick={() => onAssign(b)}
                      className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 active:scale-[0.98] transition-transform"
                    >
                      Assign
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** How late the queue is running — a pickup date that has passed is the loudest signal here. */
function PickupUrgency({ iso }: { iso: string }) {
  const d = daysUntil(iso)
  if (d === null) return null
  if (d < 0) {
    return <div className="text-xs font-medium text-red-600">Pickup passed {Math.abs(d)}d ago</div>
  }
  if (d === 0) return <div className="text-xs font-medium text-orange-600">Pickup today</div>
  if (d === 1) return <div className="text-xs font-medium text-orange-600">Pickup tomorrow</div>
  return <div className="text-xs text-gray-400">in {d} days</div>
}

// ── Assign ────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/30 cursor-default" />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-lg bg-white rounded-xl border border-gray-200 shadow-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-100 sticky top-0 bg-white rounded-t-xl">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

function AssignDialog({
  booking, vehicles, drivers, refreshCrew, onClose, onAssigned,
}: {
  booking: FleetBooking
  vehicles: FleetVehicleRow[]
  drivers: RosterRow[]
  refreshCrew: () => Promise<{ vehicles: FleetVehicleRow[]; drivers: RosterRow[] } | null>
  onClose: () => void
  onAssigned: (rc: string, driverName: string) => void
}) {
  const [driverId, setDriverId] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Only ACTIVE affiliations can be dispatched — bt-fleet-service checks
  // getActiveAffiliation and 403s a pending, suspended or departed driver.
  const roster = drivers.filter(d => d.status === 'active')

  // Who is already out, straight from the live vehicle_assignments the vehicle
  // list is decorated with. This is a hint, not the guard — the insert is.
  const busyDriver = new Map<string, string>()
  for (const v of vehicles) {
    const a = v.current_assignment
    if (a) busyDriver.set(a.driver_id, v.rc_number)
  }
  // Free trucks first — a dispatcher should not have to scroll past the fleet's
  // busiest assets to find the one standing in the yard.
  const trucks = [...vehicles].sort((a, b) => {
    const aBusy = a.current_assignment ? 1 : 0
    const bBusy = b.current_assignment ? 1 : 0
    if (aBusy !== bBusy) return aBusy - bBusy
    return a.rc_number.localeCompare(b.rc_number)
  })

  const freeTrucks = trucks.filter(v => !v.current_assignment).length
  const freeDrivers = roster.filter(d => !busyDriver.has(d.driver_id)).length

  function describeConflict(vs: FleetVehicleRow[], ds: RosterRow[]): string {
    const truck = vs.find(v => v.id === vehicleId) ?? null
    const truckBusy = truck?.current_assignment ?? null
    const driverOn = vs.find(v => v.current_assignment?.driver_id === driverId) ?? null
    const chosen = ds.find(d => d.driver_id === driverId)
    const driverName = (chosen ? nameOf(chosen) : null) ?? 'That driver'

    const parts: string[] = []
    if (truckBusy && truck) {
      parts.push(
        `${truck.rc_number} is already on a live trip${truckBusy.driver_name ? ` with ${truckBusy.driver_name}` : ''}` +
        ` (assigned ${timeAgo(truckBusy.assigned_at)}).`,
      )
    }
    if (driverOn && driverOn.id !== vehicleId) {
      parts.push(`${driverName} is already out on ${driverOn.rc_number}.`)
    }
    if (parts.length === 0) {
      return 'That truck, that driver or this booking already has a live assignment — it may have just been crewed by someone else. Pick another pairing, or refresh the queue.'
    }
    return `${parts.join(' ')} Pick another and try again — the trip that is running has to finish or be released first.`
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!driverId || !vehicleId) {
      setErr('Pick both a driver and a truck — the trip cannot start with only one.')
      return
    }
    setBusy(true)
    setErr(null)
    setConflict(null)
    try {
      await assignToBooking(booking.id, driverId, vehicleId)
      const rc = vehicles.find(v => v.id === vehicleId)?.rc_number ?? 'The truck'
      const picked = roster.find(d => d.driver_id === driverId)
      onAssigned(rc, (picked ? nameOf(picked) : null) ?? 'the driver')
    } catch (e2) {
      if (e2 instanceof ApiError && (e2.code === 'CONFLICT' || e2.code === 'INVALID_TRANSITION')) {
        // The three partial-unique indexes just refused this pairing. Re-read who is
        // live — our view was stale, which is the whole reason the insert is the guard —
        // and keep the dialog open so another truck or driver can be picked.
        const fresh = await refreshCrew()
        setConflict(describeConflict(fresh?.vehicles ?? vehicles, fresh?.drivers ?? drivers))
      } else if (e2 instanceof ApiError && e2.code === 'FORBIDDEN') {
        setErr('That driver is no longer an active member of this fleet.')
      } else if (e2 instanceof ApiError && e2.code === 'NOT_FOUND') {
        setErr('That booking or truck is no longer available to this fleet — refresh the queue.')
      } else {
        setErr(errText(e2, 'Could not assign this trip'))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Assign a driver and a truck" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
            <span className="truncate">{booking.source_address}</span>
            <ArrowRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <span className="truncate">{booking.destination_address}</span>
          </div>
          <div className="text-xs text-gray-500 mt-1 tabular-nums">
            {(booking.load_type || 'Load').replace(/_/g, ' ')} · {tons(booking.weight_kg)} · pickup{' '}
            {shortDate(booking.pickup_date)} · {inr(priceOf(booking))}
          </div>
        </div>

        <div>
          <label htmlFor="assign-driver" className="text-xs text-gray-400 uppercase tracking-wide">
            Driver
          </label>
          <select
            id="assign-driver"
            value={driverId}
            onChange={e => { setDriverId(e.target.value); setConflict(null) }}
            className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            <option value="">Choose a driver…</option>
            {roster.map(d => {
              const on = busyDriver.get(d.driver_id)
              const label = nameOf(d) ?? 'Unnamed driver'
              const phone = phoneOf(d)
              return (
                <option key={d.driver_id} value={d.driver_id} disabled={Boolean(on)}>
                  {label}{phone ? ` · ${phone}` : ''}{on ? ` — on a trip (${on})` : ''}
                </option>
              )
            })}
          </select>
          <p className="mt-1.5 text-xs text-gray-500 flex items-center gap-1.5">
            <UserRound className="w-3.5 h-3.5 text-gray-400" />
            {roster.length === 0
              ? 'Nobody has accepted a fleet invitation yet — invite a driver from the Drivers page.'
              : `${freeDrivers} of ${roster.length} active drivers are free.`}
          </p>
        </div>

        <div>
          <label htmlFor="assign-truck" className="text-xs text-gray-400 uppercase tracking-wide">
            Truck
          </label>
          <select
            id="assign-truck"
            value={vehicleId}
            onChange={e => { setVehicleId(e.target.value); setConflict(null) }}
            className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            <option value="">Choose a truck…</option>
            {trucks.map(v => {
              const on = v.current_assignment
              const spec = [v.maker_model, v.capacity_tons !== null ? `${v.capacity_tons}t` : null]
                .filter(Boolean).join(' · ')
              return (
                <option key={v.id} value={v.id} disabled={Boolean(on)}>
                  {v.rc_number}{spec ? ` — ${spec}` : ''}
                  {v.is_active ? '' : ' · inactive'}
                  {on ? ` — on a trip${on.driver_name ? ` with ${on.driver_name}` : ''}` : ''}
                </option>
              )
            })}
          </select>
          <p className="mt-1.5 text-xs text-gray-500 flex items-center gap-1.5">
            <Truck className="w-3.5 h-3.5 text-gray-400" />
            {trucks.length === 0
              ? 'No trucks on this fleet yet — add one from the Trucks page.'
              : `${freeTrucks} of ${trucks.length} trucks are free.`}
          </p>
        </div>

        {conflict && (
          <div className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5 flex gap-2.5">
            <AlertTriangle className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
            <p className="text-sm text-orange-900">{conflict}</p>
          </div>
        )}
        {err && <ErrorNote message={err} />}

        <p className="text-xs text-gray-500">
          Binds this truck and driver until the trip finishes; no mid-trip reassignment.
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium px-4 py-2.5"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !driverId || !vehicleId}
            className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 active:scale-[0.98] transition-transform disabled:opacity-50"
          >
            {busy ? 'Assigning…' : 'Assign trip'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
