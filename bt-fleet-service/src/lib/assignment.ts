import { getSupabase } from './supabase.js'
import { getActiveAffiliation } from './fleet-repo.js'
import { requireFleetVehicle } from './vehicles-repo.js'
import { assertVehicleAvailable, bookingWindow, type ScheduleWindow } from './vehicle-schedule.js'
import {
  asRow,
  asRowOrNull,
  asRows,
  FleetError,
  UNIQUE_VIOLATION,
  type BookingRow,
  type VehicleAssignmentRow,
} from './types.js'

// -----------------------------------------------------------
// assignment — the pairing step. Award -> assign(driver, vehicle) -> the trip runs
// EXACTLY as the solo-driver flow does; there is no fork in the booking state
// machine, which is why assignment writes bookings.driver_id/vehicle_id and then
// gets out of the way.
//
// CONCURRENCY: the three partial-unique indexes from migration 0016
// (one live assignment per booking, per vehicle, per driver) are the guard. We
// INSERT and catch 23505 rather than pre-checking — a check-then-insert has a race
// window in which two dispatchers can both hand the same truck to two loads.
//
// The D-19 schedule check added in 0024 sits IN FRONT of that insert and does not
// weaken it. A read-then-write check cannot win a race, so it is not asked to: it
// exists to name the conflicting trip (the index can only say "already assigned")
// and to see commitments that never produced an assignment row at all.
// -----------------------------------------------------------

const BOOKING_COLUMNS =
  'id, shipper_id, driver_id, fleet_owner_id, vehicle_id, source_address, source_lat, source_lng, ' +
  'destination_address, dest_lat, dest_lng, load_type, weight_kg, quoted_price, final_price, ' +
  'pickup_date, status, booking_type, dimensions_json, created_at, updated_at'

const ASSIGNMENT_COLUMNS =
  'id, fleet_owner_id, booking_id, vehicle_id, driver_id, assigned_by, assigned_at, released_at, ' +
  'window_start, window_end, created_at'

// Bookings the fleet won but has not yet crewed. Assigning before award has nothing
// to assign to; assigning after departure is mid-trip reassignment, which is
// explicitly out of v1 (Q13).
const ASSIGNABLE_STATUSES = ['accepted']

// Once a booking reaches one of these, its truck and driver are free again.
const TERMINAL_BOOKING_STATUSES = ['completed', 'paid', 'cancelled']

export async function getFleetBooking(fleetOwnerId: string, bookingId: string): Promise<BookingRow | null> {
  const { data, error } = await getSupabase()
    .from('bookings')
    .select(BOOKING_COLUMNS)
    .eq('id', bookingId)
    .eq('fleet_owner_id', fleetOwnerId)
    .maybeSingle()
  if (error) throw new Error(`bookings select failed: ${error.message}`)
  return asRowOrNull<BookingRow>(data)
}

export async function listFleetBookings(
  fleetOwnerId: string,
  opts: { status?: string; limit: number; offset: number },
): Promise<BookingRow[]> {
  let query = getSupabase()
    .from('bookings')
    .select(BOOKING_COLUMNS)
    .eq('fleet_owner_id', fleetOwnerId)
  if (opts.status) query = query.eq('status', opts.status)

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .range(opts.offset, opts.offset + opts.limit - 1)
  if (error) throw new Error(`bookings select failed: ${error.message}`)
  return asRows<BookingRow>(data)
}

export type AssignInput = {
  fleetOwnerId: string
  bookingId: string
  driverId: string
  vehicleId: string
  assignedBy: string
}

export type AssignResult = {
  assignment: VehicleAssignmentRow
  booking: BookingRow
}

export async function assignDriverAndVehicle(input: AssignInput): Promise<AssignResult> {
  const supabase = getSupabase()

  // (1) The booking must be THIS fleet's, and in a state that can be crewed.
  const booking = await getFleetBooking(input.fleetOwnerId, input.bookingId)
  if (!booking) throw new FleetError('Booking not found for this fleet', 'NOT_FOUND', 404)
  if (!ASSIGNABLE_STATUSES.includes(booking.status)) {
    throw new FleetError(
      `Booking is '${booking.status}' — a driver and truck can only be assigned to an accepted booking`,
      'INVALID_TRANSITION',
      409,
    )
  }

  // (2) The truck must be THIS fleet's (throws 404 otherwise).
  await requireFleetVehicle(input.fleetOwnerId, input.vehicleId)

  // (3) The driver must hold an ACTIVE affiliation with THIS fleet. Pending,
  // suspended and left drivers cannot be dispatched.
  const affiliation = await getActiveAffiliation(input.fleetOwnerId, input.driverId)
  if (!affiliation) {
    throw new FleetError('Driver is not an active member of this fleet', 'FORBIDDEN', 403)
  }

  // (4) D-19 — the truck carries the schedule. The insert below is still the
  // authority; this runs first so the dispatcher is told WHICH trip the truck is
  // already committed to, and so a commitment recorded outside vehicle_assignments
  // (a trip still running after its assignment row was released) is seen at all.
  // The booking excludes itself: re-assigning a booking that already holds this
  // truck must not report the truck as taken by that same booking.
  const window = bookingWindow(booking)
  await assertVehicleAvailable(input.vehicleId, window, { exceptBookingId: input.bookingId })

  // (5) The insert IS the mutual-exclusion check.
  let created = await insertAssignment(input, window)
  if (!created) {
    // A unique violation can mean two things: a genuine live conflict, or a stale
    // row from a trip that has already ended. Sweep the stale ones (the roll-up
    // hook may never have fired) and try once more before refusing.
    const swept = await releaseFinishedAssignments(input)
    created = swept ? await insertAssignment(input, window) : null
    if (!created) {
      throw new FleetError(
        'This booking, truck or driver already has a live assignment — finish or release it before assigning again',
        'INVALID_TRANSITION',
        409,
      )
    }
  }

  // (6) Bind the booking to the crew. bookings.driver_id is what tracking, POD and
  // GPS ingestion key off, so from here the trip is indistinguishable from a solo
  // driver's. Guarded on the status we validated in (1) so a booking that moved on
  // between the two reads is not silently re-crewed.
  const { data: updated, error: updateErr } = await supabase
    .from('bookings')
    .update({ driver_id: input.driverId, vehicle_id: input.vehicleId, updated_at: new Date().toISOString() })
    .eq('id', input.bookingId)
    .eq('fleet_owner_id', input.fleetOwnerId)
    .in('status', ASSIGNABLE_STATUSES)
    .select(BOOKING_COLUMNS)
    .maybeSingle()

  if (updateErr || !updated) {
    // Compensate: an assignment row that no booking points at would permanently
    // block that truck and driver via the partial-unique indexes.
    await releaseAssignment(created.id)
    if (updateErr) throw new Error(`bookings update failed: ${updateErr.message}`)
    throw new FleetError('Booking changed state during assignment — retry', 'INVALID_TRANSITION', 409)
  }

  return { assignment: created, booking: asRow<BookingRow>(updated) }
}

// insertAssignment — returns null on a unique violation so the caller can decide
// whether it is a real conflict or a stale row worth sweeping.
async function insertAssignment(input: AssignInput, window: ScheduleWindow): Promise<VehicleAssignmentRow | null> {
  const { data, error } = await getSupabase()
    .from('vehicle_assignments')
    .insert({
      fleet_owner_id: input.fleetOwnerId,
      booking_id: input.bookingId,
      vehicle_id: input.vehicleId,
      driver_id: input.driverId,
      assigned_by: input.assignedBy,
      // Stamped from the booking as it stood at dispatch (0024). Storing it rather
      // than re-deriving on read is what stops a shipper editing pickup_date after
      // dispatch from silently moving a commitment the truck has already made.
      window_start: window.start,
      window_end: window.end,
    })
    .select(ASSIGNMENT_COLUMNS)
    .single()
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return null
    throw new Error(`vehicle_assignments insert failed: ${error.message}`)
  }
  return asRow<VehicleAssignmentRow>(data)
}

// releaseFinishedAssignments — a truck is physically free the moment its trip ends,
// but released_at is only stamped when the roll-up hook fires on completed->paid.
// This closes the gap: any live assignment of this booking/truck/driver whose own
// booking has reached a terminal state is released here. Without it a single
// missed hook would take a truck out of service permanently.
// Returns true if anything was released.
async function releaseFinishedAssignments(input: AssignInput): Promise<boolean> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('vehicle_assignments')
    .select('id, booking_id')
    .eq('fleet_owner_id', input.fleetOwnerId)
    .is('released_at', null)
    .or(`booking_id.eq.${input.bookingId},vehicle_id.eq.${input.vehicleId},driver_id.eq.${input.driverId}`)
  if (error) throw new Error(`vehicle_assignments select failed: ${error.message}`)

  const candidates = asRows<{ id: string; booking_id: string }>(data)
  if (candidates.length === 0) return false

  const { data: bookings, error: bookingErr } = await supabase
    .from('bookings')
    .select('id, status')
    .in('id', candidates.map(c => c.booking_id))
    .in('status', TERMINAL_BOOKING_STATUSES)
  if (bookingErr) throw new Error(`bookings select failed: ${bookingErr.message}`)

  const finished = new Set(asRows<{ id: string }>(bookings).map(b => b.id))
  const stale = candidates.filter(c => finished.has(c.booking_id))
  for (const assignment of stale) await releaseAssignment(assignment.id)
  return stale.length > 0
}

export async function releaseAssignment(assignmentId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('vehicle_assignments')
    .update({ released_at: new Date().toISOString() })
    .eq('id', assignmentId)
    .is('released_at', null)
  if (error) throw new Error(`vehicle_assignments release failed: ${error.message}`)
}

// listLiveAssignments — every un-released assignment for one fleet. One query,
// used to decorate the vehicle list and the live map; never called per vehicle.
export async function listLiveAssignments(fleetOwnerId: string): Promise<VehicleAssignmentRow[]> {
  const { data, error } = await getSupabase()
    .from('vehicle_assignments')
    .select(ASSIGNMENT_COLUMNS)
    .eq('fleet_owner_id', fleetOwnerId)
    .is('released_at', null)
  if (error) throw new Error(`vehicle_assignments select failed: ${error.message}`)
  return asRows<VehicleAssignmentRow>(data)
}

export async function hasLiveAssignmentForDriver(fleetOwnerId: string, driverId: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from('vehicle_assignments')
    .select('id')
    .eq('fleet_owner_id', fleetOwnerId)
    .eq('driver_id', driverId)
    .is('released_at', null)
    .limit(1)
  if (error) throw new Error(`vehicle_assignments select failed: ${error.message}`)
  return (data?.length ?? 0) > 0
}

// releaseAssignmentForBooking — called by the trip-economics roll-up: the trip is
// over, so the truck and the driver go back into the pool. Idempotent (the
// released_at IS NULL filter makes a second call a no-op).
export async function releaseAssignmentForBooking(bookingId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('vehicle_assignments')
    .update({ released_at: new Date().toISOString() })
    .eq('booking_id', bookingId)
    .is('released_at', null)
  if (error) throw new Error(`vehicle_assignments release failed: ${error.message}`)
}
