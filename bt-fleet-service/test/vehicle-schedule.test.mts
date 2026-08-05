/**
 * bt-fleet-service — D-19, THE TRUCK CARRIES THE SCHEDULE.
 *
 * What is pinned here is the failure, not the feature: a driver affiliated to two
 * fleets (D-8) plus an owner-driver self-selecting off the marketplace gives one
 * truck three independent sources of commitment, none of which can see the others'
 * calendar. The outcome this prevents is two loads accepted for the same truck on
 * the same dates — a trip that physically cannot run, discovered at the loading bay.
 *
 * Every case below is a way that guard can quietly stop guarding:
 *   - an overlap that is not refused                    -> the double-booking itself
 *   - a RELEASED assignment that still blocks           -> the truck retires after
 *                                                          one trip
 *   - back-to-back windows treated as overlapping       -> refuses the dispatching a
 *                                                          profitable fleet lives on
 *   - a booking with no dates throwing                  -> assignment breaks for
 *                                                          every pre-0024 trip
 *
 * The whole module is exercised WITHOUT a database on purpose. getSupabase() throws
 * unless SUPABASE_URL is set, so any test below that reached the network would fail
 * loudly rather than silently pass — which is also how the last case proves the
 * no-dates path short-circuits before the round trip.
 *
 * Run: npm test   (or: npx tsx test/vehicle-schedule.test.mts)
 */
import type { ScheduleEntry, ScheduleWindow } from '../src/lib/vehicle-schedule.js'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}`) }
  else { failures.push(`${name} ${detail}`); console.log(`  FAIL  ${name} ${detail}`) }
}

const VEHICLE = '11111111-1111-1111-1111-111111111111'

// Mumbai -> Nagpur, ~700 road km: 3 days at the 300 km/day default.
const MUMBAI = { source_lat: 19.076, source_lng: 72.8777 }
const NAGPUR = { dest_lat: 21.1458, dest_lng: 79.0882 }
// Mumbai -> Pune, ~150 road km: inside one day.
const PUNE = { dest_lat: 18.5204, dest_lng: 73.8567 }

function booking(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'booking-a',
    vehicle_id: VEHICLE,
    source_address: 'Bhiwandi, Mumbai',
    destination_address: 'MIDC, Nagpur',
    pickup_date: '2026-08-10',
    status: 'accepted',
    ...MUMBAI,
    ...NAGPUR,
    ...over,
  } as never
}

function assignment(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'assignment-a',
    booking_id: 'booking-a',
    released_at: null,
    window_start: null,
    window_end: null,
    ...over,
  } as never
}

// IST, not UTC: the truck's day starts when the shipper's does.
const ist = (date: string) => new Date(`${date}T00:00:00+05:30`).toISOString()
const window = (from: string, to: string | null): ScheduleWindow => ({ start: ist(from), end: to ? ist(to) : null })

async function main() {
  const {
    assertVehicleAvailable, bookingWindow, buildSchedule, findScheduleConflict,
    istStartOfDay, selectConflicts, transitDays, windowsOverlap,
  } = await import('../src/lib/vehicle-schedule.js')

  console.log('\n── the window a booking takes its truck out of the pool for ──')
  check('pickup_date anchors at IST start-of-day, not UTC midnight',
    istStartOfDay('2026-08-10') === '2026-08-09T18:30:00.000Z', `(got ${istStartOfDay('2026-08-10')})`)
  check('Mumbai -> Nagpur is a 3-day commitment at 300 km/day',
    transitDays(booking()) === 3, `(got ${transitDays(booking())})`)
  check('Mumbai -> Pune still takes the truck for a whole day',
    transitDays(booking(PUNE)) === 1, `(got ${transitDays(booking(PUNE))})`)
  check('a trip with unusable coordinates locks the truck for one day, not forever',
    transitDays(booking({ dest_lat: null, dest_lng: null })) === 1)

  const mumbaiNagpur = bookingWindow(booking())
  check('window starts at the pickup date', mumbaiNagpur.start === ist('2026-08-10'))
  check('window ends 3 days later', mumbaiNagpur.end === ist('2026-08-13'), `(got ${mumbaiNagpur.end})`)

  console.log('\n── overlap is half-open [start, end) ──')
  check('two loads on the same dates overlap',
    windowsOverlap(window('2026-08-10', '2026-08-13'), window('2026-08-11', '2026-08-12')))
  check('a window wholly inside another overlaps',
    windowsOverlap(window('2026-08-11', '2026-08-12'), window('2026-08-10', '2026-08-13')))
  check('back-to-back loads do NOT overlap — drop on the 13th, pick up on the 13th',
    !windowsOverlap(window('2026-08-10', '2026-08-13'), window('2026-08-13', '2026-08-16')))
  check('a gap between loads does not overlap',
    !windowsOverlap(window('2026-08-10', '2026-08-13'), window('2026-08-20', '2026-08-23')))
  check('an open-ended commitment blocks everything after it starts',
    windowsOverlap(window('2026-09-01', '2026-09-02'), window('2026-08-10', null)))
  check('an open-ended commitment does not reach backwards',
    !windowsOverlap(window('2026-08-01', '2026-08-02'), window('2026-08-10', null)))
  check('an unknown start (pre-0024 row) never blocks',
    !windowsOverlap(window('2026-08-10', '2026-08-13'), { start: null, end: null }))

  console.log('\n── the truck\'s calendar, from both places a commitment is recorded ──')
  const live = buildSchedule(VEHICLE, [assignment()], [booking()])
  check('a live assignment is one commitment', live.length === 1, `(got ${live.length})`)
  check('it is attributed to the assignment row', live[0].source === 'assignment')
  check('it names the trip so the refusal can too',
    live[0].description === 'Bhiwandi, Mumbai → MIDC, Nagpur, pickup 2026-08-10', `(got ${live[0].description})`)
  check('with no stored window it falls back to the booking',
    live[0].window.end === ist('2026-08-13'))

  const stored = buildSchedule(VEHICLE,
    [assignment({ window_start: ist('2026-08-10'), window_end: ist('2026-08-12') })],
    [booking({ pickup_date: '2026-09-01' })])
  check('a stored window wins over a pickup_date edited after dispatch',
    stored[0].window.end === ist('2026-08-12'), `(got ${stored[0].window.end})`)

  // The regression this pins: released_at means the truck is back in the pool. If
  // this ever stops being true, a truck is retired for good after its first trip and
  // the only symptom is a dispatcher who cannot assign anything.
  const released = buildSchedule(VEHICLE, [assignment({ released_at: '2026-08-14T00:00:00.000Z' })], [])
  check('a RELEASED assignment is not a commitment', released.length === 0, `(got ${released.length})`)

  const finished = buildSchedule(VEHICLE, [assignment()], [booking({ status: 'paid' })])
  check('a live assignment row on a finished trip does not block either',
    finished.length === 0, `(got ${finished.length})`)

  // The self-selected load: the trip is on the road but its assignment row is gone.
  const selfSelected = buildSchedule(VEHICLE, [], [booking({ id: 'booking-b', status: 'in_transit' })])
  check('a running booking with no assignment row still holds the truck',
    selfSelected.length === 1 && selfSelected[0].source === 'booking')
  check('a booking that names another truck does not hold this one',
    buildSchedule(VEHICLE, [], [booking({ vehicle_id: 'another-truck' })]).length === 0)
  check('the same trip is counted once, not twice',
    buildSchedule(VEHICLE, [assignment()], [booking()]).length === 1)

  console.log('\n── the refusal ──')
  const calendar: ScheduleEntry[] = buildSchedule(VEHICLE,
    [assignment({ id: 'a-late', booking_id: 'booking-late', window_start: ist('2026-08-20'), window_end: ist('2026-08-24') }),
     assignment({ id: 'a-early', booking_id: 'booking-a' })],
    [booking(), booking({ id: 'booking-late', pickup_date: '2026-08-20', vehicle_id: 'unused' })])

  const clash = findScheduleConflict(window('2026-08-12', '2026-08-22'), calendar)
  check('an overlapping window is refused', clash !== null)
  check('and it is the trip the truck is on NOW, not the one furthest away',
    clash?.booking_id === 'booking-a', `(got ${clash?.booking_id})`)
  check('both clashes are reported, earliest first',
    selectConflicts(window('2026-08-12', '2026-08-22'), calendar).map(c => c.booking_id)
      .join(',') === 'booking-a,booking-late')
  check('a window in the gap between the two trips is free',
    findScheduleConflict(window('2026-08-14', '2026-08-19'), calendar) === null)
  check('adjacent to both, touching neither, is free',
    findScheduleConflict(window('2026-08-13', '2026-08-20'), calendar) === null)

  console.log('\n── degrading safely ──')
  // A booking with no pickup_date has an UNKNOWN window, never a free one. It must
  // decline to improve on the 0016 indexes rather than break assignment for the 677
  // live bookings that predate this column meaning anything.
  const undated = bookingWindow(booking({ pickup_date: null }))
  check('no pickup_date yields an unknown window, not a guessed one',
    undated.start === null && undated.end === null)
  check('a garbage pickup_date is unknown too, not NaN',
    bookingWindow(booking({ pickup_date: 'not-a-date' })).start === null)
  check('an unknown window conflicts with nothing', findScheduleConflict(undated, calendar) === null)

  let threw: unknown = null
  try {
    // SUPABASE_URL is unset in this process, so a round trip here would throw. The
    // assertion is therefore double: the undated booking is allowed AND the check
    // short-circuits before spending a query on a question it cannot answer.
    await assertVehicleAvailable(VEHICLE, undated)
  } catch (err) { threw = err }
  check('an undated booking is assignable without touching the database',
    threw === null, `(threw ${threw instanceof Error ? threw.message : threw})`)

  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) {
    for (const f of failures) console.error('  x ' + f)
    process.exit(1)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
