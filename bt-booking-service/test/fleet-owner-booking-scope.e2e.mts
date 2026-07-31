/**
 * Tenant isolation for GET /bookings, pinned per role.
 *
 * THE BUG THIS EXISTS FOR: repository.listBookings() branched on 'shipper' and 'driver'.
 * `fleet_owner` — added to the role enum in migration 0014 — matched NEITHER, so it fell
 * through to the branch commented `// admin: no additional filter` and the endpoint
 * returned EVERY booking on the platform to any fleet account: other shippers' loads,
 * addresses, and prices. No test covered the role, which is why it survived.
 *
 * These checks are deliberately about what each role must NOT see. A test that only
 * asserts "the fleet sees the open load" would have passed against the broken code too.
 *
 * Exercises the REAL route via app.inject() with the in-memory fake Supabase seam.
 * Run: REDIS_URL=redis://localhost:6379 npx tsx test/fleet-owner-booking-scope.e2e.mts
 */
process.env.JWT_SECRET = 'test-jwt-secret-long-enough-for-hs256-verification'
process.env.INTERNAL_SERVICE_SECRET = 'internal-secret-for-tests'
process.env.SUPABASE_URL = 'http://fake.local'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key'

import Fastify from 'fastify'
import jwt from 'jsonwebtoken'

const OPEN_A = '11111111-1111-4111-8111-111111111111'   // pending, open to bids
const OPEN_B = '22222222-2222-4222-8222-222222222222'   // pending, open to bids
const PRIVATE_INTRANSIT = '33333333-3333-4333-8333-333333333333' // another shipper's live trip
const PRIVATE_PAID = '44444444-4444-4444-8444-444444444444'      // another shipper's paid trip

const SHIPPER_1 = '55555555-5555-4555-8555-555555555555'
const SHIPPER_2 = '66666666-6666-4666-8666-666666666666'
const FLEET_USER = '77777777-7777-4777-8777-777777777777'
const DRIVER_USER = '88888888-8888-4888-8888-888888888888'
const ADMIN_USER = '99999999-9999-4999-8999-999999999999'

type Row = Record<string, any>
const store: Record<string, Row[]> = {
  bookings: [
    { id: OPEN_A, shipper_id: SHIPPER_1, driver_id: null, status: 'pending', quoted_price: 45000, created_at: '2026-07-30T00:00:00Z' },
    { id: OPEN_B, shipper_id: SHIPPER_2, driver_id: null, status: 'pending', quoted_price: 20000, created_at: '2026-07-29T00:00:00Z' },
    { id: PRIVATE_INTRANSIT, shipper_id: SHIPPER_2, driver_id: 'd1', status: 'in_transit', quoted_price: 90000, created_at: '2026-07-28T00:00:00Z' },
    { id: PRIVATE_PAID, shipper_id: SHIPPER_2, driver_id: 'd1', status: 'paid', quoted_price: 83500, created_at: '2026-07-27T00:00:00Z' },
  ],
  // No fleet_drivers row for this user: the actor is a fleet OWNER, not a fleet driver.
  fleet_drivers: [],
  drivers: [],
}

class FakeQuery {
  private filters: Array<['eq' | 'in', string, any]> = []
  constructor(private table: string) {}
  select() { return this }
  eq(c: string, v: any) { this.filters.push(['eq', c, v]); return this }
  in(c: string, v: any[]) { this.filters.push(['in', c, v]); return this }
  order() { return this }
  limit() { return this }
  private match(r: Row) {
    return this.filters.every(([o, c, v]) => (o === 'eq' ? r[c] === v : v.includes(r[c])))
  }
  private run() { return { data: (store[this.table] ?? []).filter(r => this.match(r)), error: null } }
  maybeSingle() { const { data, error } = this.run(); return Promise.resolve({ data: data.length ? data[0] : null, error }) }
  single() { return this.maybeSingle() }
  then(f: (v: any) => any, r?: (e: any) => any) { return Promise.resolve(this.run()).then(f, r) }
}
const fakeSupabase = { from: (t: string) => new FakeQuery(t) }

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}`) }
  else { failures.push(`${name} ${detail}`); console.log(`  FAIL  ${name} ${detail}`) }
}
const tok = (u: string, role: string) => jwt.sign({ userId: u, role }, process.env.JWT_SECRET!)

async function main() {
  const { __setSupabaseClientForTests } = await import('../src/lib/supabase.js')
  const authPlugin = (await import('../src/plugins/auth.js')).default
  const { bookingRoutes } = await import('../src/routes/bookings.js')
  __setSupabaseClientForTests(fakeSupabase as any)

  const app = Fastify({ logger: false })
  await app.register(async (a) => {
    await a.register(authPlugin)
    await a.register(bookingRoutes, { prefix: '/bookings' })
  })
  await app.ready()

  const listAs = async (user: string, role: string) => {
    const r = await app.inject({
      method: 'GET', url: '/bookings',
      headers: { authorization: `Bearer ${tok(user, role)}` },
    })
    return { code: r.statusCode, ids: (r.json().data ?? []).map((b: Row) => b.id) as string[] }
  }

  console.log('\n── fleet_owner sees the open load board and nothing else ──')
  const fleet = await listAs(FLEET_USER, 'fleet_owner')
  check('fleet_owner 200', fleet.code === 200, `(got ${fleet.code})`)
  check('fleet_owner sees both open loads', fleet.ids.includes(OPEN_A) && fleet.ids.includes(OPEN_B), JSON.stringify(fleet.ids))
  // The regression guards. Before the fix each of these leaked.
  check("fleet_owner does NOT see another shipper's in_transit booking", !fleet.ids.includes(PRIVATE_INTRANSIT), JSON.stringify(fleet.ids))
  check("fleet_owner does NOT see another shipper's paid booking", !fleet.ids.includes(PRIVATE_PAID), JSON.stringify(fleet.ids))
  check('fleet_owner sees exactly the 2 pending loads', fleet.ids.length === 2, `(got ${fleet.ids.length})`)

  console.log('\n── the other roles are unchanged ──')
  const shipper1 = await listAs(SHIPPER_1, 'shipper')
  check('shipper sees only their own booking', shipper1.ids.length === 1 && shipper1.ids[0] === OPEN_A, JSON.stringify(shipper1.ids))
  check("shipper does NOT see the other shipper's loads", !shipper1.ids.includes(OPEN_B) && !shipper1.ids.includes(PRIVATE_PAID), JSON.stringify(shipper1.ids))

  const solo = await listAs(DRIVER_USER, 'driver')
  check('solo driver sees the open board only', solo.ids.length === 2 && !solo.ids.includes(PRIVATE_INTRANSIT), JSON.stringify(solo.ids))

  const admin = await listAs(ADMIN_USER, 'admin')
  check('admin still sees everything (unfiltered branch preserved)', admin.ids.length === 4, `(got ${admin.ids.length})`)

  await app.close()
  console.log(`\n${failures.length ? 'RESULT: FAIL' : 'RESULT: PASS'} — ${passed} checks passed, ${failures.length} failed`)
  if (failures.length) { failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1) }
}
main().catch(err => { console.error(err); process.exit(1) })
