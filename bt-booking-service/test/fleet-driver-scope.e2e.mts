/**
 * Fleet-affiliated driver read scope (founder Q14/Q16).
 *
 * THE BUG THIS PINS: an employed driver was shown a "Submit Your Quote" form on
 * a trip already assigned to them and in_transit. Two server-side gaps fed it —
 * `GET /bookings/:id` masked the money for a fleet driver but let them read ANY
 * booking (while `GET /bookings` returned only their assignments), and nothing
 * in the payload told the app whether the caller was the assigned driver, so the
 * client fell back to "do I own a quote here?" — which is ALWAYS false for a
 * fleet driver, because their owner is the bidder.
 *
 * Exercises the REAL routes via app.inject() with an in-memory fake Supabase
 * (T-BE-1 injection seam). Not shipped (under test/, excluded from tsc src).
 * Run: npx tsx test/fleet-driver-scope.e2e.mts
 */
process.env.JWT_SECRET = 'test-jwt-secret-long-enough-for-hs256-verification'
process.env.INTERNAL_SERVICE_SECRET = 'internal-secret-for-tests'
process.env.SUPABASE_URL = 'http://fake.local'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key'

import Fastify from 'fastify'
import jwt from 'jsonwebtoken'

const B_FLEET   = '11111111-1111-4111-8111-111111111111' // in_transit, assigned to the fleet driver
const B_OTHER   = '22222222-2222-4222-8222-222222222222' // in_transit, assigned to someone else
const B_OPEN    = '33333333-3333-4333-8333-333333333333' // pending, on the open board
const B_SOLO    = '44444444-4444-4444-8444-444444444444' // accepted by the solo driver, NO quote row

const D_FLEET   = 'a1111111-1111-4111-8111-111111111111'
const D_SOLO    = 'a2222222-2222-4222-8222-222222222222'
const D_THIRD   = 'a3333333-3333-4333-8333-333333333333'

const U_FLEET   = 'b1111111-1111-4111-8111-111111111111'
const U_SOLO    = 'b2222222-2222-4222-8222-222222222222'
const S1        = 'c1111111-1111-4111-8111-111111111111'

const PRICE = 11400

type Row = Record<string, any>
const store: Record<string, Row[]> = {
  bookings: [
    { id: B_FLEET, driver_id: D_FLEET, shipper_id: S1, status: 'in_transit', quoted_price: PRICE, final_price: PRICE, min_acceptable: 9000, booking_type: 'auction' },
    { id: B_OTHER, driver_id: D_THIRD, shipper_id: S1, status: 'in_transit', quoted_price: PRICE, final_price: PRICE, min_acceptable: 9000, booking_type: 'auction' },
    { id: B_OPEN,  driver_id: null,    shipper_id: S1, status: 'pending',    quoted_price: PRICE, final_price: null,  min_acceptable: 9000, booking_type: 'auction' },
    { id: B_SOLO,  driver_id: D_SOLO,  shipper_id: S1, status: 'accepted',   quoted_price: PRICE, final_price: PRICE, min_acceptable: 9000, booking_type: 'auction' },
  ],
  drivers: [
    { id: D_FLEET, user_id: U_FLEET },
    { id: D_SOLO,  user_id: U_SOLO },
  ],
  // Only the fleet driver is employed. The solo driver has NO row here, which is
  // what keeps their behaviour byte-identical to the pre-fleet product.
  fleet_drivers: [
    { id: 'f1', driver_id: D_FLEET, fleet_owner_id: 'own-1', status: 'active' },
  ],
  quotes: [],
}

class FakeQuery {
  private filters: Array<['eq' | 'in' | 'is', string, any]> = []
  private mode: 'select' | 'update' | 'insert' = 'select'
  private payload: Row | null = null
  constructor(private table: string) {}
  select() { return this }
  update(p: Row) { this.mode = 'update'; this.payload = p; return this }
  insert(p: Row) { this.mode = 'insert'; this.payload = p; return this }
  eq(c: string, v: any) { this.filters.push(['eq', c, v]); return this }
  in(c: string, v: any[]) { this.filters.push(['in', c, v]); return this }
  is(c: string, v: any) { this.filters.push(['is', c, v]); return this }
  order() { return this }
  limit() { return this }
  private match(r: Row) {
    return this.filters.every(([o, c, v]) =>
      o === 'eq' ? r[c] === v : o === 'is' ? (r[c] ?? null) === v : v.includes(r[c]))
  }
  private run() {
    const rows = store[this.table] ?? []
    if (this.mode === 'update') { const hit = rows.filter(r => this.match(r)); hit.forEach(r => Object.assign(r, this.payload)); return { data: hit, error: null } }
    if (this.mode === 'insert') { const row = { id: `new-${rows.length}`, ...this.payload }; rows.push(row); return { data: [row], error: null } }
    return { data: rows.filter(r => this.match(r)), error: null }
  }
  maybeSingle() { const { data, error } = this.run(); return Promise.resolve({ data: data.length ? data[0] : null, error }) }
  single() { return this.maybeSingle() }
  then(f: (v: any) => any, r?: (e: any) => any) { return Promise.resolve(this.run()).then(f, r) }
}
const fakeSupabase = { from: (t: string) => new FakeQuery(t) }

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}`) } else { failures.push(`${name} ${detail}`); console.log(`  FAIL  ${name} ${detail}`) }
}
const tok = (u: string, role: string) => jwt.sign({ userId: u, role }, process.env.JWT_SECRET!)

async function main() {
  const { __setSupabaseClientForTests } = await import('../src/lib/supabase.js')
  const authPlugin = (await import('../src/plugins/auth.js')).default
  const { bookingRoutes } = await import('../src/routes/bookings.js')
  const { quoteRoutes } = await import('../src/routes/quotes.js')
  __setSupabaseClientForTests(fakeSupabase as any)

  const app = Fastify({ logger: false })
  await app.register(async (a) => {
    await a.register(authPlugin)
    await a.register(bookingRoutes, { prefix: '/bookings' })
    await a.register(quoteRoutes, { prefix: '/bookings' })
  })
  await app.ready()

  const FLEET = { authorization: `Bearer ${tok(U_FLEET, 'driver')}` }
  const SOLO  = { authorization: `Bearer ${tok(U_SOLO, 'driver')}` }
  const SHIP  = { authorization: `Bearer ${tok(S1, 'shipper')}` }

  console.log('\n── fleet driver: their own assigned trip ──')
  let r = await app.inject({ method: 'GET', url: `/bookings/${B_FLEET}`, headers: FLEET })
  check('own assigned trip 200', r.statusCode === 200, `(got ${r.statusCode})`)
  let d = r.json().data
  check('assigned_to_me true', d?.assigned_to_me === true, JSON.stringify(d?.assigned_to_me))
  check('quoted_price stripped', !('quoted_price' in (d ?? {})), JSON.stringify(Object.keys(d ?? {})))
  check('final_price stripped', !('final_price' in (d ?? {})), JSON.stringify(Object.keys(d ?? {})))
  check('min_acceptable stripped', !('min_acceptable' in (d ?? {})), JSON.stringify(Object.keys(d ?? {})))
  check('status still readable', d?.status === 'in_transit', `(got ${d?.status})`)

  console.log('\n── fleet driver: everything else is out of scope ──')
  r = await app.inject({ method: 'GET', url: `/bookings/${B_OPEN}`, headers: FLEET })
  check('open pending load 404 (was 200 + a bid form)', r.statusCode === 404, `(got ${r.statusCode})`)
  r = await app.inject({ method: 'GET', url: `/bookings/${B_OTHER}`, headers: FLEET })
  check("another driver's trip 404", r.statusCode === 404, `(got ${r.statusCode})`)
  r = await app.inject({ method: 'GET', url: `/bookings/${B_SOLO}`, headers: FLEET })
  check("a solo driver's trip 404", r.statusCode === 404, `(got ${r.statusCode})`)

  console.log('\n── fleet driver: bidding stays closed ──')
  r = await app.inject({ method: 'POST', url: `/bookings/${B_OPEN}/quotes`, headers: FLEET, payload: { amount: 9999 } })
  check('submit quote 403', r.statusCode === 403, `(got ${r.statusCode})`)
  check('no quote row written', store.quotes.length === 0, `(got ${store.quotes.length})`)
  r = await app.inject({ method: 'PATCH', url: `/bookings/${B_OPEN}/accept`, headers: FLEET })
  check('self-accept 403', r.statusCode === 403, `(got ${r.statusCode})`)

  console.log('\n── fleet driver: the list is assignments only ──')
  r = await app.inject({ method: 'GET', url: '/bookings', headers: FLEET })
  const ids = (r.json().data ?? []).map((b: Row) => b.id)
  check('list returns only the assigned trip', ids.length === 1 && ids[0] === B_FLEET, JSON.stringify(ids))
  check('list payload masked', !('quoted_price' in (r.json().data?.[0] ?? {})), JSON.stringify(Object.keys(r.json().data?.[0] ?? {})))

  console.log('\n── solo driver: the marketplace is unchanged ──')
  r = await app.inject({ method: 'GET', url: `/bookings/${B_OPEN}`, headers: SOLO })
  check('open pending load 200', r.statusCode === 200, `(got ${r.statusCode})`)
  d = r.json().data
  check('quoted_price visible', d?.quoted_price === PRICE, JSON.stringify(d?.quoted_price))
  check('assigned_to_me false on an open load', d?.assigned_to_me === false, JSON.stringify(d?.assigned_to_me))

  console.log('\n── solo driver: a trip taken with /accept has NO quote row ──')
  r = await app.inject({ method: 'GET', url: `/bookings/${B_SOLO}`, headers: SOLO })
  check('own accepted trip 200', r.statusCode === 200, `(got ${r.statusCode})`)
  d = r.json().data
  // The screen keys the trip lifecycle off this flag now. Keyed off quote
  // ownership (the old behaviour) this driver saw a bid form on their own trip.
  check('assigned_to_me true without any quote', d?.assigned_to_me === true, JSON.stringify(d?.assigned_to_me))
  check('quotes table still empty for this booking', store.quotes.length === 0, `(got ${store.quotes.length})`)

  console.log('\n── shipper payload is untouched ──')
  r = await app.inject({ method: 'GET', url: `/bookings/${B_FLEET}`, headers: SHIP })
  check('shipper reads own booking 200', r.statusCode === 200, `(got ${r.statusCode})`)
  d = r.json().data
  check('shipper keeps quoted_price', d?.quoted_price === PRICE, JSON.stringify(d?.quoted_price))
  check('shipper gets no assigned_to_me', !('assigned_to_me' in (d ?? {})), JSON.stringify(Object.keys(d ?? {})))

  await app.close()
  console.log(`\n${failures.length ? 'RESULT: FAIL' : 'RESULT: PASS'} — ${passed} checks passed, ${failures.length} failed`)
  if (failures.length) { failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1) }
}
main().catch(err => { console.error(err); process.exit(1) })
