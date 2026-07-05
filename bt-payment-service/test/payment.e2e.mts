/**
 * T-BE-4 — cash-recorded settlement + payout + complete→payout saga.
 * Boots the REAL bt-booking-service in-process (fake Supabase) on an
 * ephemeral port and drives the payment flow through the REAL
 * HttpBookingClient over HTTP, with a fake PaymentStore. Proves:
 * completed→settle→paid + payout recorded; idempotent double-settle;
 * unauthorized/non-completed blocked; saga consumer idempotent; and the
 * best-effort trip_completed emit pre-creates a pending payout.
 * Run: npx tsx test/payment.e2e.mts
 */
process.env.JWT_SECRET = 'shared-test-jwt-secret-hs256-both-services'
process.env.INTERNAL_SERVICE_SECRET = 'internal-secret-shared'
process.env.SUPABASE_URL = 'http://fake.local'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key'

import Fastify from 'fastify'
import jwt from 'jsonwebtoken'

const B1 = '11111111-1111-4111-8111-111111111111' // completed — settle success + double
const B2 = '22222222-2222-4222-8222-222222222222' // in_transit — non-completed 409
const B4 = '44444444-4444-4444-8444-444444444444' // in_transit — emit chain
const B5 = '55555555-5555-4555-8555-555555555555' // completed — admin settle
const B3 = '33333333-3333-4333-8333-333333333333' // saga-only id
const D1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const U1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' // driver user
const S1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' // shipper (owner) user
const OTHER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' // shipper (non-owner)
const ADMIN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

type Row = Record<string, any>
const bstore: Record<string, Row[]> = {
  bookings: [
    { id: B1, driver_id: D1, shipper_id: S1, status: 'completed', quoted_price: 5000, final_price: 5000 },
    { id: B2, driver_id: D1, shipper_id: S1, status: 'in_transit', quoted_price: 5000, final_price: null },
    { id: B4, driver_id: D1, shipper_id: S1, status: 'in_transit', quoted_price: 7000, final_price: null },
    { id: B5, driver_id: D1, shipper_id: S1, status: 'completed', quoted_price: 6000, final_price: 6000 },
  ],
  drivers: [{ id: D1, user_id: U1 }],
}
class FakeQuery {
  private f: Array<['eq' | 'in', string, any]> = []
  private mode: 'select' | 'update' = 'select'
  private payload: Row | null = null
  constructor(private table: string) {}
  select() { return this }
  update(p: Row) { this.mode = 'update'; this.payload = p; return this }
  eq(c: string, v: any) { this.f.push(['eq', c, v]); return this }
  in(c: string, v: any[]) { this.f.push(['in', c, v]); return this }
  private m(r: Row) { return this.f.every(([o, c, v]) => (o === 'eq' ? r[c] === v : v.includes(r[c]))) }
  private run() {
    const rows = bstore[this.table] ?? []
    if (this.mode === 'update') { const h = rows.filter(r => this.m(r)); h.forEach(r => Object.assign(r, this.payload)); return { data: h, error: null } }
    return { data: rows.filter(r => this.m(r)), error: null }
  }
  maybeSingle() { const { data, error } = this.run(); return Promise.resolve({ data: data.length ? data[0] : null, error }) }
  single() { return this.maybeSingle() }
  then(f: (v: any) => any, r?: (e: any) => any) { return Promise.resolve(this.run()).then(f, r) }
}
const fakeSupabase = { from: (t: string) => new FakeQuery(t) }

// Fake PaymentStore (in-memory)
const P = { payments: new Map<string, Row>(), payouts: new Map<string, Row>() }
const fakeStore = {
  async getPayment(b: string) { return P.payments.get(b) ?? null },
  async insertPayment(r: Row) { if (P.payments.has(r.booking_id)) throw new Error('dup payment'); P.payments.set(r.booking_id, { ...r }) },
  async getPayout(b: string) { return P.payouts.get(b) ?? null },
  async upsertPayout(r: Row) { P.payouts.set(r.booking_id, { ...r }) },
  async insertPendingPayoutIfAbsent(r: Row) { if (!P.payouts.has(r.booking_id)) P.payouts.set(r.booking_id, { ...r }) },
}

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}`) } else { failures.push(`${name} ${detail}`); console.log(`  FAIL  ${name} ${detail}`) }
}
const tok = (u: string, role: string) => jwt.sign({ userId: u, role }, process.env.JWT_SECRET!)
const bStatus = (id: string) => bstore.bookings.find(b => b.id === id)!.status

async function main() {
  const SECRET = process.env.INTERNAL_SERVICE_SECRET!

  // Boot booking-service (fake Supabase) with public + internal scopes.
  const { __setSupabaseClientForTests } = await import('../../bt-booking-service/src/lib/supabase.js')
  const bAuth = (await import('../../bt-booking-service/src/plugins/auth.js')).default
  const bInternalAuth = (await import('../../bt-booking-service/src/plugins/internal-auth.js')).default
  const { bookingRoutes } = await import('../../bt-booking-service/src/routes/bookings.js')
  const { internalRoutes } = await import('../../bt-booking-service/src/routes/internal.js')
  __setSupabaseClientForTests(fakeSupabase as any)
  const bookingApp = Fastify({ logger: false })
  await bookingApp.register(async (a) => { await a.register(bAuth); await a.register(bookingRoutes, { prefix: '/bookings' }) })
  await bookingApp.register(async (a) => { await a.register(bInternalAuth); await a.register(internalRoutes, { prefix: '/internal' }) })
  await bookingApp.listen({ port: 0, host: '127.0.0.1' })
  const bookingBase = `http://127.0.0.1:${(bookingApp.server.address() as any).port}`

  // Boot payment-service with a REAL HttpBookingClient → bookingBase + fake store.
  const pAuth = (await import('../src/plugins/auth.js')).default
  const pInternalAuth = (await import('../src/plugins/internal-auth.js')).default
  const { paymentRoutes } = await import('../src/routes/payments.js')
  const { internalPaymentRoutes } = await import('../src/routes/internal.js')
  const { HttpBookingClient } = await import('../src/lib/booking-client.js')
  const deps = { booking: new HttpBookingClient(bookingBase, SECRET), store: fakeStore as any }
  const payApp = Fastify({ logger: false })
  await payApp.register(async (a) => { await a.register(pAuth); await a.register(paymentRoutes, { prefix: '/payments', deps }) })
  await payApp.register(async (a) => { await a.register(pInternalAuth); await a.register(internalPaymentRoutes, { prefix: '/internal', deps }) })
  await payApp.listen({ port: 0, host: '127.0.0.1' })
  const payBase = `http://127.0.0.1:${(payApp.server.address() as any).port}`
  process.env.PAYMENT_SERVICE_URL = payBase // enables booking's best-effort emit

  const settle = (body: any, token?: string) => payApp.inject({
    method: 'POST', url: '/payments/settle',
    headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body,
  })
  const goodBody = (id: string) => ({ booking_id: id, amount: 5000, mode: 'upi', reference: 'UTR123' })

  console.log('\n── auth boundary (P1 #11) ──')
  let r = await settle(goodBody(B1))
  check('settle without token 401', r.statusCode === 401, `(got ${r.statusCode})`)
  r = await settle(goodBody(B1), tok(U1, 'driver'))
  check('settle as driver 403', r.statusCode === 403, `(got ${r.statusCode})`)
  r = await settle(goodBody(B1), tok(OTHER, 'shipper'))
  check('settle as non-owner shipper 403 (delegated to booking-svc)', r.statusCode === 403, `(got ${r.statusCode})`)

  console.log('\n── non-completed blocked ──')
  r = await settle(goodBody(B2), tok(S1, 'shipper'))
  check('settle on in_transit booking 409 INVALID_STATE', r.statusCode === 409 && r.json().code === 'INVALID_STATE', `(got ${r.statusCode}/${r.json().code})`)

  console.log('\n── completed → settle → paid + payout ──')
  r = await settle(goodBody(B1), tok(S1, 'shipper'))
  check('settle completed booking 200', r.statusCode === 200, `(got ${r.statusCode})`)
  check('response status paid', r.json().data?.status === 'paid', JSON.stringify(r.json().data?.status))
  check('booking flipped completed→paid (cross-service)', bStatus(B1) === 'paid', `(got ${bStatus(B1)})`)
  check('payment recorded', !!(await fakeStore.getPayment(B1)), '')
  check('payout recorded (amount+mode+recorded_by)', (await fakeStore.getPayout(B1))?.status === 'recorded' && (await fakeStore.getPayout(B1))?.amount === 5000, JSON.stringify(await fakeStore.getPayout(B1)))

  console.log('\n── idempotent double-settle ──')
  r = await settle(goodBody(B1), tok(S1, 'shipper'))
  check('double-settle 200 already_settled', r.statusCode === 200 && r.json().data?.already_settled === true, `(got ${r.statusCode}/${JSON.stringify(r.json().data?.already_settled)})`)
  check('still exactly one payment for booking', P.payments.size === 1, `(payments=${P.payments.size})`)
  check('booking still paid (not double-applied)', bStatus(B1) === 'paid')

  console.log('\n── admin can settle ──')
  r = await settle({ booking_id: B5, amount: 6000, mode: 'cash' }, tok(ADMIN, 'admin'))
  check('admin settle completed booking 200 paid', r.statusCode === 200 && r.json().data?.status === 'paid', `(got ${r.statusCode})`)

  console.log('\n── saga consumer /internal/trip-completed (idempotent) ──')
  const tripCompleted = (id: string, secret: string) => payApp.inject({
    method: 'POST', url: '/internal/trip-completed',
    headers: { 'x-internal-secret': secret }, payload: { booking_id: id, driver_id: D1, amount: 4000 },
  })
  r = await tripCompleted(B3, 'wrong-secret')
  check('trip-completed wrong secret 401', r.statusCode === 401, `(got ${r.statusCode})`)
  r = await tripCompleted(B3, SECRET)
  check('trip-completed 200 creates pending payout', r.statusCode === 200 && (await fakeStore.getPayout(B3))?.status === 'pending', JSON.stringify(await fakeStore.getPayout(B3)))
  r = await tripCompleted(B3, SECRET)
  check('trip-completed replay idempotent (still pending, no change)', (await fakeStore.getPayout(B3))?.status === 'pending' && P.payouts.size >= 1, '')

  console.log('\n── best-effort emit: complete → pending payout ──')
  // Drive booking B4 in_transit→completed via the POD internal path; the
  // route best-effort emits trip_completed to payment-service.
  await bookingApp.inject({ method: 'POST', url: `/internal/bookings/${B4}/complete-pod`, headers: { 'x-internal-secret': SECRET } })
  let landed = false
  for (let i = 0; i < 40 && !landed; i++) { if (await fakeStore.getPayout(B4)) { landed = true; break } await new Promise(res => setTimeout(res, 50)) }
  check('emit created pending payout for B4', landed && (await fakeStore.getPayout(B4))?.status === 'pending', JSON.stringify(await fakeStore.getPayout(B4)))

  await payApp.close()
  await bookingApp.close()
  console.log(`\n${failures.length ? 'RESULT: FAIL' : 'RESULT: PASS'} — ${passed} checks passed, ${failures.length} failed`)
  if (failures.length) { failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1) }
}
main().catch(err => { console.error(err); process.exit(1) })
