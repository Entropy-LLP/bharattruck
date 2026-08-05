/**
 * T-BE-4 — cash-recorded settlement + payout + complete→payout saga.
 * Boots the REAL bt-booking-service in-process (fake Supabase) on an
 * ephemeral port and drives the payment flow through the REAL
 * HttpBookingClient over HTTP, with a fake PaymentStore. Proves:
 * completed→settle→paid + payout recorded; idempotent double-settle;
 * unauthorized/non-completed blocked; saga consumer idempotent; the
 * best-effort trip_completed emit pre-creates a pending payout; and the
 * D-7 fleet↔driver revenue split — including the one that matters most,
 * that a settle RETRIED after a crash mid-write does not double-pay
 * either party now that a booking may legitimately hold two payout rows.
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
const B6 = '66666666-6666-4666-8666-666666666666' // completed — FLEET-won booking
const B7 = '77777777-7777-4777-8777-777777777777' // saga-only id, fleet payee
const B8 = '88888888-8888-4888-8888-888888888888' // completed — amount-reconciliation target
const B9 = '99999999-9999-4999-8999-999999999999' // completed — ops override target
const BA = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1' // completed — FLEET, driver on a 30% split
const BB = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1' // completed — FLEET, 33.33% (rounding remainder)
const BC = 'ccccccc1-cccc-4ccc-8ccc-ccccccccccc1' // completed — FLEET, split settle that crashes once
const D1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const D2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab' // fleet driver on a 30% revenue share
const D3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac' // fleet driver on 33.33% — the awkward one
const F1 = 'ffffffff-ffff-4fff-8fff-ffffffffffff' // fleet_owners.id (NOT a users.id)
const U1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' // driver user
const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc' // fleet-driver user (D2)
const U3 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbd' // fleet-driver user (D3)
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
    // Fleet-won: the fleet bid, so the fleet owner is the payee even though a
    // driver of record is assigned for tracking/POD.
    { id: B6, driver_id: D1, fleet_owner_id: F1, shipper_id: S1, status: 'completed', quoted_price: 8000, final_price: 8000 },
    // Auction-won: final_price (9000) supersedes the original quote (7500), so
    // 9000 is the only figure a shipper may settle — settling 7500 must fail.
    { id: B8, driver_id: D1, shipper_id: S1, status: 'completed', quoted_price: 7500, final_price: 9000 },
    { id: B9, driver_id: D1, shipper_id: S1, status: 'completed', quoted_price: 4000, final_price: 4000 },
    // D-7 split targets. Same fleet as B6, different drivers — the share is a
    // term of the AFFILIATION, so which driver ran the trip is what decides
    // whether the freight is shared and by how much.
    { id: BA, driver_id: D2, fleet_owner_id: F1, shipper_id: S1, status: 'completed', quoted_price: 6000, final_price: 6000 },
    { id: BB, driver_id: D3, fleet_owner_id: F1, shipper_id: S1, status: 'completed', quoted_price: 5001, final_price: 5001 },
    { id: BC, driver_id: D2, fleet_owner_id: F1, shipper_id: S1, status: 'completed', quoted_price: 6000, final_price: 6000 },
  ],
  drivers: [{ id: D1, user_id: U1 }, { id: D2, user_id: U2 }, { id: D3, user_id: U3 }],
}

// fleet_drivers as bt-payment-service reads it (migration 0022, column added by
// 0023's predecessor). D1 sits at 0 — salaried, which is what all 620 live rows
// do — so every pre-split check in this file must stay byte-identical.
const affiliations: Row[] = [
  { fleet_owner_id: F1, driver_id: D1, status: 'active', revenue_share_pct: 0 },
  { fleet_owner_id: F1, driver_id: D2, status: 'active', revenue_share_pct: 30 },
  { fleet_owner_id: F1, driver_id: D3, status: 'active', revenue_share_pct: 33.33 },
]
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

// Fake PaymentStore (in-memory).
//
// The payouts map is keyed on (booking_id, payee_type) — NOT booking_id — because
// that is the uniqueness constraint migration 0023 installs, and it is the only
// thing standing between a retried split settlement and a double payout. Keying
// this fake on booking_id alone would make the duplicate-on-retry bug invisible
// here (the second row would silently overwrite the first) while it happily
// wrote two rows in production.
const payoutKey = (r: Row) => `${r.booking_id}|${r.payee_type}`
const P = { payments: new Map<string, Row>(), payouts: new Map<string, Row>() }
// Set a booking id here to make the NEXT insertPayment for it blow up once —
// the crash that the payout-before-payment ordering exists to survive.
const crashPaymentInsertOnce = new Set<string>()
const fakeStore = {
  async getPayment(b: string) { return P.payments.get(b) ?? null },
  async insertPayment(r: Row) {
    if (crashPaymentInsertOnce.delete(r.booking_id)) throw new Error('simulated payments insert failure')
    if (P.payments.has(r.booking_id)) throw new Error('dup payment')
    P.payments.set(r.booking_id, { ...r })
  },
  async getPayouts(b: string) { return [...P.payouts.values()].filter(r => r.booking_id === b) },
  async upsertPayout(r: Row) { P.payouts.set(payoutKey(r), { ...r }) },
  async insertPendingPayoutIfAbsent(r: Row) { if (!P.payouts.has(payoutKey(r))) P.payouts.set(payoutKey(r), { ...r }) },
  async getDriverRevenueSharePct(fleetOwnerId: string, driverId: string) {
    const rows = affiliations.filter(a => a.fleet_owner_id === fleetOwnerId && a.driver_id === driverId)
    return Number((rows.find(a => a.status === 'active') ?? rows[0])?.revenue_share_pct ?? 0)
  },
}

// "The payout" stopped being a question with one answer, so every check below
// names the payee it means.
const payoutOf = async (b: string, type: 'driver' | 'fleet_owner' = 'driver') =>
  (await fakeStore.getPayouts(b)).find(r => r.payee_type === type) ?? null
// Compared in whole paise on purpose: `payouts.amount` is numeric(12,2), so
// paise IS the ledger's precision, and float addition of two 2-decimal rupee
// values is not guaranteed to land on the third exactly.
const paise = (n: number) => Math.round(n * 100)

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

  // Stand-in for bt-fleet-service: records which bookings got a trip-economics
  // roll-up, so we can prove fleet trips emit and solo-driver trips do not.
  const economicsHits: string[] = []
  const fleetApp = Fastify({ logger: false })
  fleetApp.post('/internal/trip-economics/:bookingId', async (req: any) => {
    economicsHits.push(req.params.bookingId)
    return { success: true, data: { booking_id: req.params.bookingId } }
  })
  await fleetApp.listen({ port: 0, host: '127.0.0.1' })
  process.env.FLEET_SERVICE_URL = `http://127.0.0.1:${(fleetApp.server.address() as any).port}`

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
  // The live payments table has CHECK (status IN ('pending','captured','settled','failed',
  // 'refunded')). The Map-backed fake store does NOT enforce it, so a status the DB rejects
  // (e.g. the old 'recorded') passes here silently and only 500s in production. Pin the value
  // to the DB-allowed set so a future drift is caught in CI, not by a failed real settlement.
  {
    const DB_ALLOWED = ['pending', 'captured', 'settled', 'failed', 'refunded']
    const pStatus = (await fakeStore.getPayment(B1))?.status
    check('payment status is a DB-allowed value (payments_status_check)', DB_ALLOWED.includes(pStatus as string), `(got ${pStatus})`)
  }
  check('payout recorded (amount+mode+recorded_by)', (await payoutOf(B1))?.status === 'recorded' && (await payoutOf(B1))?.amount === 5000, JSON.stringify(await payoutOf(B1)))

  console.log('\n── idempotent double-settle ──')
  r = await settle(goodBody(B1), tok(S1, 'shipper'))
  check('double-settle 200 already_settled', r.statusCode === 200 && r.json().data?.already_settled === true, `(got ${r.statusCode}/${JSON.stringify(r.json().data?.already_settled)})`)
  check('still exactly one payment for booking', P.payments.size === 1, `(payments=${P.payments.size})`)
  check('booking still paid (not double-applied)', bStatus(B1) === 'paid')

  console.log('\n── admin can settle ──')
  r = await settle({ booking_id: B5, amount: 6000, mode: 'cash' }, tok(ADMIN, 'admin'))
  check('admin settle completed booking 200 paid', r.statusCode === 200 && r.json().data?.status === 'paid', `(got ${r.statusCode})`)

  console.log('\n── money integrity: settled amount vs agreed price ──')
  // The whole point: a shipper must not be able to name their own price at
  // settlement time. B8 was won at 9000; 1 and 7500 (the superseded quote) are
  // both refusals, and neither may leave any trace behind.
  r = await settle({ booking_id: B8, amount: 1, mode: 'cash' }, tok(S1, 'shipper'))
  check('shipper underpaying 422 AMOUNT_MISMATCH', r.statusCode === 422 && r.json().code === 'AMOUNT_MISMATCH', `(got ${r.statusCode}/${r.json().code})`)
  check('rejected settle wrote no payment', !(await fakeStore.getPayment(B8)), JSON.stringify(await fakeStore.getPayment(B8)))
  check('rejected settle wrote no payout', !(await payoutOf(B8)), JSON.stringify(await payoutOf(B8)))
  check('rejected settle left booking completed (not paid)', bStatus(B8) === 'completed', `(got ${bStatus(B8)})`)
  r = await settle({ booking_id: B8, amount: 7500, mode: 'cash' }, tok(S1, 'shipper'))
  check('quoted_price is NOT settleable once final_price is set', r.statusCode === 422, `(got ${r.statusCode})`)
  r = await settle({ booking_id: B8, amount: 9000, mode: 'cash' }, tok(S1, 'shipper'))
  check('settling the agreed final_price 200 paid', r.statusCode === 200 && bStatus(B8) === 'paid', `(got ${r.statusCode}/${bStatus(B8)})`)

  console.log('\n── ops override: a real cash settlement may differ ──')
  // Ops keeps an escape hatch on purpose — detention, damage deductions and
  // part payments are real, and a hard gate here would strand those trips in
  // `completed` with no way to close them.
  r = await settle({ booking_id: B9, amount: 3500, mode: 'cash' }, tok(ADMIN, 'admin'))
  check('admin may settle a differing amount 200 paid', r.statusCode === 200 && bStatus(B9) === 'paid', `(got ${r.statusCode}/${bStatus(B9)})`)
  check('override payout carries the amount actually recorded', (await payoutOf(B9))?.amount === 3500, JSON.stringify(await payoutOf(B9)))

  console.log('\n── fleet-won booking: payee = the bidder (Q15) ──')
  check('solo payout is payee_type=driver with driver_id', (await payoutOf(B1))?.payee_type === 'driver' && (await payoutOf(B1))?.driver_id === D1 && (await payoutOf(B1))?.fleet_owner_id === null, JSON.stringify(await payoutOf(B1)))
  r = await settle({ booking_id: B6, amount: 8000, mode: 'direct' }, tok(S1, 'shipper'))
  check('settle fleet booking 200 paid', r.statusCode === 200 && r.json().data?.status === 'paid', `(got ${r.statusCode})`)
  const fleetPayout = await payoutOf(B6, 'fleet_owner')
  check('fleet payout payee_type=fleet_owner, driver_id NULL', fleetPayout?.payee_type === 'fleet_owner' && fleetPayout?.fleet_owner_id === F1 && fleetPayout?.driver_id === null, JSON.stringify(fleetPayout))

  console.log('\n── D-7 revenue split: share = 0 changes NOTHING ──')
  // The regression that would hurt most. All 620 live affiliations are salaried
  // (revenue_share_pct = 0): the owner keeps the freight and pays the driver
  // off-platform. If the split path leaked a second row here, every existing
  // fleet trip would start recording a payout to a driver who is not owed one.
  check('salaried fleet booking still writes exactly ONE payout', (await fakeStore.getPayouts(B6)).length === 1, JSON.stringify(await fakeStore.getPayouts(B6)))
  check('that one payout is the owner, for the whole settled amount', fleetPayout?.amount === 8000, JSON.stringify(fleetPayout))
  check('solo booking untouched by the split path (one driver payout, full amount)', (await fakeStore.getPayouts(B1)).length === 1 && (await payoutOf(B1))?.amount === 5000, JSON.stringify(await fakeStore.getPayouts(B1)))

  console.log('\n── D-7 revenue split: share = 30 pays both parties ──')
  r = await settle({ booking_id: BA, amount: 6000, mode: 'upi', reference: 'UTR-SPLIT' }, tok(S1, 'shipper'))
  check('settle split fleet booking 200 paid', r.statusCode === 200 && bStatus(BA) === 'paid', `(got ${r.statusCode}/${bStatus(BA)})`)
  const splitRows = await fakeStore.getPayouts(BA)
  check('split writes exactly TWO payout rows', splitRows.length === 2, JSON.stringify(splitRows))
  check('owner keeps 70% (6000 → 4200)', (await payoutOf(BA, 'fleet_owner'))?.amount === 4200, JSON.stringify(await payoutOf(BA, 'fleet_owner')))
  check('driver takes their 30% (6000 → 1800)', (await payoutOf(BA, 'driver'))?.amount === 1800, JSON.stringify(await payoutOf(BA, 'driver')))
  check('driver row names the driver and NOT the fleet (0016 payee CHECK)', (await payoutOf(BA, 'driver'))?.driver_id === D2 && (await payoutOf(BA, 'driver'))?.fleet_owner_id === null, JSON.stringify(await payoutOf(BA, 'driver')))
  check('both rows carry the settlement mode + recorder', splitRows.every(p => p.mode === 'upi' && p.status === 'recorded' && p.recorded_by === S1), JSON.stringify(splitRows))
  // The shipper app reads `payout` as a single object and predates splits, so it
  // must keep meaning the party the shipper contracted with — the bidder.
  check('response.payout is still the BIDDER row (shipper back-compat)', r.json().data?.payout?.payee_type === 'fleet_owner', JSON.stringify(r.json().data?.payout))
  check('response.payouts carries every payee', (r.json().data?.payouts ?? []).length === 2, JSON.stringify(r.json().data?.payouts))

  console.log('\n── D-7 revenue split: the parts must sum to the whole ──')
  // 33.33% of ₹5001 does not divide into whole paise. Somebody has to absorb the
  // remainder, deterministically and always in the same direction, or the ledger
  // pays out more or less than the shipper actually settled.
  r = await settle({ booking_id: BB, amount: 5001, mode: 'cash' }, tok(S1, 'shipper'))
  check('settle 33.33% split booking 200 paid', r.statusCode === 200 && bStatus(BB) === 'paid', `(got ${r.statusCode}/${bStatus(BB)})`)
  const oddRows = await fakeStore.getPayouts(BB)
  check('33.33% split sums to EXACTLY the settled amount', oddRows.reduce((s, p) => s + paise(p.amount), 0) === paise(5001), JSON.stringify(oddRows))
  check('driver gets the exact percentage (5001 × 33.33% = 1666.83)', (await payoutOf(BB, 'driver'))?.amount === 1666.83, JSON.stringify(await payoutOf(BB, 'driver')))
  check('owner absorbs the remainder (3334.17, not 3334.16)', (await payoutOf(BB, 'fleet_owner'))?.amount === 3334.17, JSON.stringify(await payoutOf(BB, 'fleet_owner')))

  console.log('\n── D-7 revenue split: the resolver, without a database ──')
  // resolvePayees is kept pure so the disbursement layer (D-12, a later PR) can
  // reuse it; these pin the edges that never show up in a happy-path settlement.
  const { resolvePayees } = await import('../src/lib/payment-service.js')
  const fleetBooking = { driver_id: D2, fleet_owner_id: F1 }
  check('share=100 pays the driver alone — no ₹0 owner row in the ledger', JSON.stringify(resolvePayees(fleetBooking, 6000, 100)) === JSON.stringify([{ payee_type: 'driver', driver_id: D2, fleet_owner_id: null, amount: 6000 }]), JSON.stringify(resolvePayees(fleetBooking, 6000, 100)))
  check('a share above 100 is clamped, never a negative owner payout', resolvePayees(fleetBooking, 6000, 150).every(p => p.amount >= 0) && resolvePayees(fleetBooking, 6000, 150).reduce((s, p) => s + paise(p.amount), 0) === paise(6000), JSON.stringify(resolvePayees(fleetBooking, 6000, 150)))
  check('a negative share is clamped to salaried (owner keeps 100%)', resolvePayees(fleetBooking, 6000, -5).length === 1 && resolvePayees(fleetBooking, 6000, -5)[0].payee_type === 'fleet_owner', JSON.stringify(resolvePayees(fleetBooking, 6000, -5)))
  check('fleet booking with no assigned driver has nobody to split with', resolvePayees({ driver_id: null, fleet_owner_id: F1 }, 6000, 30).length === 1, JSON.stringify(resolvePayees({ driver_id: null, fleet_owner_id: F1 }, 6000, 30)))
  check('a booking with no bidder resolves to no payees at all', resolvePayees({ driver_id: null, fleet_owner_id: null }, 6000, 30).length === 0, '')

  console.log('\n── D-7 revenue split: a RETRIED settle does not double-pay ──')
  // The exact bug the payout-before-payment ordering exists to prevent, now that
  // UNIQUE(booking_id) has been relaxed to UNIQUE(booking_id, payee_type): crash
  // AFTER both payout rows are written but BEFORE the payment lands, then retry.
  // Under a weaker anchor the retry appends two more rows and the fleet is paid
  // 200% of the freight.
  crashPaymentInsertOnce.add(BC)
  r = await settle({ booking_id: BC, amount: 6000, mode: 'cash' }, tok(S1, 'shipper'))
  check('settle that crashes on the payment write 500s', r.statusCode === 500, `(got ${r.statusCode})`)
  check('crashed settle left the payout rows behind (payout is written FIRST)', (await fakeStore.getPayouts(BC)).length === 2, JSON.stringify(await fakeStore.getPayouts(BC)))
  check('crashed settle recorded NO payment (so the retry replays both writes)', !(await fakeStore.getPayment(BC)), '')
  check('crashed settle left the booking completed, not paid', bStatus(BC) === 'completed', `(got ${bStatus(BC)})`)
  r = await settle({ booking_id: BC, amount: 6000, mode: 'cash' }, tok(S1, 'shipper'))
  check('retried settle 200 paid', r.statusCode === 200 && bStatus(BC) === 'paid', `(got ${r.statusCode}/${bStatus(BC)})`)
  const retried = await fakeStore.getPayouts(BC)
  check('retry did NOT duplicate either payout row', retried.length === 2, JSON.stringify(retried))
  check('retried payouts still sum to exactly the settled amount', retried.reduce((s, p) => s + paise(p.amount), 0) === paise(6000), JSON.stringify(retried))
  // A third, fully-idempotent settle: the booking is already 'paid' and the
  // payment exists, so this takes the short-circuit and must touch nothing.
  r = await settle({ booking_id: BC, amount: 6000, mode: 'cash' }, tok(S1, 'shipper'))
  check('third settle short-circuits already_settled', r.statusCode === 200 && r.json().data?.already_settled === true, JSON.stringify(r.json().data?.already_settled))
  check('still exactly two payout rows after the third settle', (await fakeStore.getPayouts(BC)).length === 2, JSON.stringify(await fakeStore.getPayouts(BC)))

  console.log('\n── trip-economics roll-up (best-effort, fleet only) ──')
  for (let i = 0; i < 40 && !economicsHits.includes(B6); i++) await new Promise(res => setTimeout(res, 50))
  check('fleet settlement emitted trip-economics', economicsHits.includes(B6), JSON.stringify(economicsHits))
  check('solo-driver settlements emitted nothing', !economicsHits.includes(B1) && !economicsHits.includes(B5), JSON.stringify(economicsHits))

  console.log('\n── saga consumer /internal/trip-completed (idempotent) ──')
  const tripCompleted = (id: string, secret: string) => payApp.inject({
    method: 'POST', url: '/internal/trip-completed',
    headers: { 'x-internal-secret': secret }, payload: { booking_id: id, driver_id: D1, amount: 4000 },
  })
  r = await tripCompleted(B3, 'wrong-secret')
  check('trip-completed wrong secret 401', r.statusCode === 401, `(got ${r.statusCode})`)
  r = await tripCompleted(B3, SECRET)
  check('trip-completed 200 creates pending payout', r.statusCode === 200 && (await payoutOf(B3))?.status === 'pending', JSON.stringify(await payoutOf(B3)))
  r = await tripCompleted(B3, SECRET)
  check('trip-completed replay idempotent (still pending, no change)', (await payoutOf(B3))?.status === 'pending' && P.payouts.size >= 1, '')
  r = await payApp.inject({
    method: 'POST', url: '/internal/trip-completed',
    headers: { 'x-internal-secret': SECRET }, payload: { booking_id: B7, driver_id: D1, fleet_owner_id: F1, amount: 4000 },
  })
  const pendingFleet = await payoutOf(B7, 'fleet_owner')
  check('trip-completed with fleet_owner_id → fleet payee pending payout', r.statusCode === 200 && pendingFleet?.payee_type === 'fleet_owner' && pendingFleet?.driver_id === null, JSON.stringify(pendingFleet))

  console.log('\n── best-effort emit: complete → pending payout ──')
  // Drive booking B4 in_transit→completed via the POD internal path; the
  // route best-effort emits trip_completed to payment-service.
  await bookingApp.inject({ method: 'POST', url: `/internal/bookings/${B4}/complete-pod`, headers: { 'x-internal-secret': SECRET } })
  let landed = false
  for (let i = 0; i < 40 && !landed; i++) { if (await payoutOf(B4)) { landed = true; break } await new Promise(res => setTimeout(res, 50)) }
  check('emit created pending payout for B4', landed && (await payoutOf(B4))?.status === 'pending', JSON.stringify(await payoutOf(B4)))

  await payApp.close()
  await bookingApp.close()
  await fleetApp.close()
  console.log(`\n${failures.length ? 'RESULT: FAIL' : 'RESULT: PASS'} — ${passed} checks passed, ${failures.length} failed`)
  if (failures.length) { failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1) }
}
main().catch(err => { console.error(err); process.exit(1) })
