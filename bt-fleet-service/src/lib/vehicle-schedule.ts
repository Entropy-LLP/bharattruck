import { getSupabase } from './supabase.js'
import { asRows, FleetError, type BookingRow } from './types.js'

// -----------------------------------------------------------
// vehicle-schedule — D-19: THE TRUCK CARRIES THE SCHEDULE.
//
// A driver may be affiliated to several fleets (D-8) and an owner-driver also
// self-selects work off the marketplace, so one truck has up to three independent
// sources of commitment — fleet A, fleet B, and its own driver — none of which can
// see the others' calendar. Hanging the schedule on the VEHICLE collapses them into
// one calendar: whoever accepted the work, the truck can only be in one place.
//
// THIS IS A STRICT ADDITION TO THE 0016 INDEXES, NEVER A REPLACEMENT. Those partial
// unique indexes stay the authoritative mutual exclusion because they are enforced
// by the INSERT and therefore survive two dispatchers racing; a read-then-write
// check like this one cannot. What it adds is (a) a refusal that names the trip the
// truck is already on, where the index can only say "already has a live assignment",
// and (b) a schedule the app can query BEFORE the owner picks a truck, so the
// conflict shows up in the picker instead of as a 409 after the fact.
// -----------------------------------------------------------

// A truck's day is not the UTC day. pickup_date is a plain calendar date keyed in
// by an Indian shipper, so anchoring it at UTC midnight would free the truck from
// 18:30 the evening before and hold it until 05:30 the morning after — half a
// working day wrong at both ends, every time.
const IST_START_OF_DAY = 'T00:00:00+05:30'

const DAY_MS = 24 * 60 * 60 * 1000

const EARTH_RADIUS_KM = 6371
// Straight-line km underestimates road distance. Same 1.3 circuity factor
// economics.ts and bt-pricing-service/src/lib/geo.ts use — the FROZEN maps rule
// keeps the Google server key in bt-tracking-service alone, so no other service may
// ask Routes for a real road distance.
const ROAD_WINDING_FACTOR = 1.3

// What a loaded truck actually covers in a day on the pilot corridor: driving-hour
// reality plus halts, not vehicle speed. Deliberately on the low side, because the
// two errors are not symmetric — under-estimating the day makes the window LONGER
// and may refuse an assignment on a truck that is in fact free (visible to the
// dispatcher, one click to override by picking another truck), while
// over-estimating it double-books a truck, which is a trip that physically cannot
// run. Overridable because it is a fleet operating fact, not a constant.
const DEFAULT_KM_PER_DAY = 300

function kmPerDay(): number {
  const raw = Number(process.env.TRUCK_SCHEDULE_KM_PER_DAY)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_KM_PER_DAY
}

export type ScheduleWindow = {
  start: string | null
  end: string | null
}

// One commitment on a truck's calendar. `source` records which table proved it:
// 'assignment' is a fleet dispatch, 'booking' is a trip that is still running while
// its assignment row is gone (see listVehicleCommitments).
export type ScheduleEntry = {
  booking_id: string
  assignment_id: string | null
  source: 'assignment' | 'booking'
  status: string
  description: string
  window: ScheduleWindow
}

// Once a booking reaches one of these the truck is free again. Same list
// assignment.ts sweeps on, kept in step deliberately: a status that frees the truck
// there but not here would make the two guards disagree about the same trip.
const TERMINAL_BOOKING_STATUSES = ['completed', 'paid', 'cancelled']

const SCHEDULE_BOOKING_COLUMNS =
  'id, vehicle_id, source_address, source_lat, source_lng, destination_address, ' +
  'dest_lat, dest_lng, pickup_date, status'

type ScheduleBooking = Pick<
  BookingRow,
  'id' | 'vehicle_id' | 'source_address' | 'source_lat' | 'source_lng' |
  'destination_address' | 'dest_lat' | 'dest_lng' | 'pickup_date' | 'status'
>

type LiveAssignmentWindow = {
  id: string
  booking_id: string
  released_at: string | null
  window_start: string | null
  window_end: string | null
}

// -----------------------------------------------------------
// Pure window arithmetic. Kept free of the database so the D-19 rule itself is
// testable without one — the failure this prevents is a silent double-booking, and
// a rule that can only be exercised against live Supabase is a rule nobody checks.
// -----------------------------------------------------------

function toMs(iso: string | null): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

export function istStartOfDay(date: string): string | null {
  const ms = toMs(`${date}${IST_START_OF_DAY}`)
  return ms === null ? null : new Date(ms).toISOString()
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * How many days this trip takes the truck out of the pool.
 *
 * Coordinates that are not finite fall back to ONE day rather than to an open-ended
 * lock. A data defect must not be able to retire a truck indefinitely, and the 0016
 * index still backstops the same-vehicle case underneath.
 */
export function transitDays(booking: Pick<ScheduleBooking, 'source_lat' | 'source_lng' | 'dest_lat' | 'dest_lng'>): number {
  // Typed unknown, not number: BookingRow describes the columns as NOT NULL, but the
  // live DB is the authority here (see types.ts) and legacy rows predate that.
  const raw: unknown[] = [booking.source_lat, booking.source_lng, booking.dest_lat, booking.dest_lng]
  // Number(null) is 0, not NaN. Screening for nullish BEFORE the cast is what stops
  // a missing coordinate reading as the Gulf of Guinea and turning a Mumbai pickup
  // into a fortnight-long commitment. PostgREST can hand numerics back as strings,
  // so the cast itself has to stay.
  if (raw.some(v => v === null || v === undefined || v === '')) return 1
  const coords = raw.map(Number)
  if (!coords.every(Number.isFinite)) return 1
  const km = haversineKm(coords[0], coords[1], coords[2], coords[3]) * ROAD_WINDING_FACTOR
  return Math.max(1, Math.ceil(km / kmPerDay()))
}

/**
 * The window a booking occupies its truck for.
 *
 * A booking with no usable pickup_date yields {null, null} — UNKNOWN, which never
 * conflicts with anything. That is the degrade-safely case and it is the important
 * one: bookings predate this column being meaningful, and throwing (or, worse,
 * defaulting to "now") would break assignment for every historical trip rather than
 * merely declining to improve on today's guard.
 */
export function bookingWindow(booking: Pick<ScheduleBooking, 'pickup_date' | 'source_lat' | 'source_lng' | 'dest_lat' | 'dest_lng'>): ScheduleWindow {
  const start = typeof booking.pickup_date === 'string' && booking.pickup_date
    ? istStartOfDay(booking.pickup_date)
    : null
  if (!start) return { start: null, end: null }
  return {
    start,
    end: new Date(Date.parse(start) + transitDays(booking) * DAY_MS).toISOString(),
  }
}

/**
 * Half-open [start, end) overlap.
 *
 * Adjacency is NOT a conflict: a truck that drops on the 5th and picks up again on
 * the 5th is running back-to-back loads, which is the fleet's whole business model.
 * Treating touching windows as overlapping would refuse exactly the dispatching a
 * profitable fleet does every day.
 *
 * An unknown start is treated as non-blocking. Refusing on it would take every
 * pre-0024 assignment and turn it into a permanent lock on its truck; the 0016
 * indexes already refuse the live same-vehicle case, so conceding here costs
 * nothing that was previously caught.
 */
export function windowsOverlap(a: ScheduleWindow, b: ScheduleWindow): boolean {
  const aStart = toMs(a.start)
  const bStart = toMs(b.start)
  if (aStart === null || bStart === null) return false
  // A missing end is open-ended, not zero-length: the truck is out until something
  // releases it.
  const aEnd = toMs(a.end) ?? Infinity
  const bEnd = toMs(b.end) ?? Infinity
  return aStart < bEnd && bStart < aEnd
}

/**
 * Every commitment the candidate window collides with, earliest first.
 *
 * The ordering is not cosmetic: it is what makes the refusal name the trip the
 * truck is on NOW rather than an arbitrary one from further down the calendar.
 */
export function selectConflicts(candidate: ScheduleWindow, entries: ScheduleEntry[]): ScheduleEntry[] {
  return entries
    .filter(e => windowsOverlap(candidate, e.window))
    .sort((x, y) => (toMs(x.window.start) ?? 0) - (toMs(y.window.start) ?? 0))
}

export function findScheduleConflict(candidate: ScheduleWindow, entries: ScheduleEntry[]): ScheduleEntry | null {
  return selectConflicts(candidate, entries)[0] ?? null
}

function describeBooking(booking: Pick<ScheduleBooking, 'source_address' | 'destination_address' | 'pickup_date'>): string {
  const lane = `${booking.source_address} → ${booking.destination_address}`
  return booking.pickup_date ? `${lane}, pickup ${booking.pickup_date}` : lane
}

// -----------------------------------------------------------
// Reads. Everything below is deliberately NOT fleet-scoped: D-19 says the truck is
// blocked by whoever committed it, so filtering by fleet_owner_id here would
// reintroduce exactly the blind spot the decision exists to close.
// -----------------------------------------------------------

/**
 * Turn raw rows into the truck's calendar.
 *
 * Two sources, because neither alone is complete:
 *   - vehicle_assignments — the fleet dispatch, carrying its stored window;
 *   - non-terminal bookings holding this vehicle_id with no live assignment row —
 *     a trip still on the road after its assignment was released early (a swept
 *     stale row, or the compensating release in assignDriverAndVehicle losing its
 *     race). Reading assignments alone would show that truck as free while it is
 *     physically loaded.
 *
 * The two rules that free a truck — released_at is stamped, or the trip reached a
 * terminal status — are applied HERE and not only in the WHERE clause. The SQL
 * filters are an index-backed narrowing so the query stays cheap; this is where the
 * rule itself lives, in one place, exercisable without a database. A rule about
 * double-booking that can only be run against live Supabase is a rule nobody runs.
 */
export function buildSchedule(
  vehicleId: string,
  assignments: LiveAssignmentWindow[],
  bookings: ScheduleBooking[],
): ScheduleEntry[] {
  const byId = new Map(bookings.map(b => [b.id, b]))
  const entries: ScheduleEntry[] = []
  const claimed = new Set<string>()

  for (const assignment of assignments) {
    if (assignment.released_at !== null) continue
    const booking = byId.get(assignment.booking_id)
    // A live assignment on a finished trip is a stale row, not a commitment — the
    // same judgement releaseFinishedAssignments makes when it sweeps them. An
    // assignment whose booking could not be read stays blocking: unreadable is not
    // evidence of freedom.
    if (booking && TERMINAL_BOOKING_STATUSES.includes(booking.status)) continue
    claimed.add(assignment.booking_id)
    entries.push({
      booking_id: assignment.booking_id,
      assignment_id: assignment.id,
      source: 'assignment',
      status: booking?.status ?? 'unknown',
      description: booking ? describeBooking(booking) : 'a trip that is no longer readable',
      // The stored window is authoritative; deriving it again would let a booking
      // edited after dispatch quietly move a commitment the truck already made.
      // Only a pre-0024 row with nothing stored falls back to the booking.
      window: assignment.window_start !== null || assignment.window_end !== null
        ? { start: assignment.window_start, end: assignment.window_end }
        : booking ? bookingWindow(booking) : { start: null, end: null },
    })
  }

  for (const booking of bookings) {
    // vehicle_id is re-checked because the caller also fetches bookings by id (to
    // name the trips its assignments point at); one of those may have been
    // re-crewed onto a different truck and must not block this one.
    if (booking.vehicle_id !== vehicleId) continue
    if (claimed.has(booking.id) || TERMINAL_BOOKING_STATUSES.includes(booking.status)) continue
    entries.push({
      booking_id: booking.id,
      assignment_id: null,
      source: 'booking',
      status: booking.status,
      description: describeBooking(booking),
      window: bookingWindow(booking),
    })
  }

  return entries
}

export async function listVehicleCommitments(vehicleId: string): Promise<ScheduleEntry[]> {
  const supabase = getSupabase()

  const [assignmentsRes, bookingsRes] = await Promise.all([
    supabase
      .from('vehicle_assignments')
      .select('id, booking_id, released_at, window_start, window_end')
      .eq('vehicle_id', vehicleId)
      .is('released_at', null),
    supabase
      .from('bookings')
      .select(SCHEDULE_BOOKING_COLUMNS)
      .eq('vehicle_id', vehicleId)
      .not('status', 'in', `(${TERMINAL_BOOKING_STATUSES.join(',')})`),
  ])
  if (assignmentsRes.error) throw new Error(`vehicle_assignments select failed: ${assignmentsRes.error.message}`)
  if (bookingsRes.error) throw new Error(`bookings select failed: ${bookingsRes.error.message}`)

  const assignments = asRows<LiveAssignmentWindow>(assignmentsRes.data)
  const bookings = asRows<ScheduleBooking>(bookingsRes.data)

  // An assignment can point at a booking that no longer names this vehicle (the
  // booking update in assignDriverAndVehicle is a second, non-transactional write),
  // so the trips those rows describe still have to be fetched to be named — and to
  // be recognised as finished.
  const known = new Set(bookings.map(b => b.id))
  const unfetched = assignments.map(a => a.booking_id).filter(id => !known.has(id))
  if (unfetched.length > 0) {
    const { data, error } = await supabase
      .from('bookings')
      .select(SCHEDULE_BOOKING_COLUMNS)
      .in('id', unfetched)
    if (error) throw new Error(`bookings select failed: ${error.message}`)
    bookings.push(...asRows<ScheduleBooking>(data))
  }

  return buildSchedule(vehicleId, assignments, bookings)
}

export type VehicleAvailability = {
  vehicle_id: string
  window: ScheduleWindow
  is_free: boolean
  conflicts: ScheduleEntry[]
}

/**
 * The read helper: is this truck free between X and Y.
 *
 * `exceptBookingId` excludes the trip being asked about from its own answer — the
 * caller re-checking a booking that already holds this truck must not be told the
 * truck is taken by itself.
 */
export async function getVehicleAvailability(
  vehicleId: string,
  window: ScheduleWindow,
  opts: { exceptBookingId?: string } = {},
): Promise<VehicleAvailability> {
  const entries = (await listVehicleCommitments(vehicleId))
    .filter(e => e.booking_id !== opts.exceptBookingId)
  const conflicts = selectConflicts(window, entries)
  return { vehicle_id: vehicleId, window, is_free: conflicts.length === 0, conflicts }
}

/**
 * Refuse an assignment whose window collides with one the truck already carries.
 *
 * 409 with the conflicting trip named: "already has a live assignment" tells a
 * dispatcher nothing they can act on, whereas the lane and pickup date of the
 * blocking trip tell them immediately whether to release it or pick another truck.
 */
export async function assertVehicleAvailable(
  vehicleId: string,
  window: ScheduleWindow,
  opts: { exceptBookingId?: string } = {},
): Promise<void> {
  // An unknown candidate window can collide with nothing, so the round trip is
  // pure cost — this is the pre-0024 booking path and it must stay as cheap as it
  // is today.
  if (!window.start) return

  const conflict = (await getVehicleAvailability(vehicleId, window, opts)).conflicts[0]
  if (!conflict) return

  throw new FleetError(
    `This truck is already committed to ${conflict.description} (booking ${conflict.booking_id}, ` +
    `${conflict.status}) over the same dates — release that trip or assign another truck`,
    'INVALID_TRANSITION',
    409,
  )
}
