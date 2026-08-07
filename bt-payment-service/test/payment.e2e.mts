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
 * either party now that a booking may legitimately hold two payout rows;
 * and D-24's unaffiliated executing driver, who used to be paid ₹0 in
 * silence because a missing affiliation row read as a share of 0.
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
const BD = 'ddddddd1-dddd-4ddd-8ddd-ddddddddddd1' // completed — FLEET, share = 100 after a saga pre-create
const BE = 'eeeeeee1-eeee-4eee-8eee-eeeeeeeeeee1' // completed — solo, settled on the PRE-0023 schema
const BF = 'fffffff1-ffff-4fff-8fff-fffffffffff1' // completed — FLEET split attempted on the PRE-0023 schema
const BG = 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2' // completed — FLEET, driver with NO affiliation (D-24)
const D1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const D2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab' // fleet driver on a 30% revenue share
const D3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac' // fleet driver on 33.33% — the awkward one
const D4 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad' // fleet driver on 100% — the owner keeps nothing
const D5 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae' // ran a fleet trip with NO fleet_drivers row at all
const F1 = 'ffffffff-ffff-4fff-8fff-ffffffffffff' // fleet_owners.id (NOT a users.id)
const U1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' // driver user
const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc' // fleet-driver user (D2)
const U3 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbd' // fleet-driver user (D3)
const U4 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe' // fleet-driver user (D4)
const U5 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbf' // unaffiliated driver user (D5)
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
    // share = 100: the settlement pays the DRIVER alone, so the fleet_owner row
    // the saga pre-created at completion is a payee this settlement does not pay.
    { id: BD, driver_id: D4, fleet_owner_id: F1, shipper_id: S1, status: 'completed', quoted_price: 6000, final_price: 6000 },
    // Pre-0023 schema targets: a solo settlement (100% of live traffic) and a
    // split the old UNIQUE(booking_id) physically cannot store.
    { id: BE, driver_id: D1, shipper_id: S1, status: 'completed', quoted_price: 5000, final_price: 5000 },
    { id: BF, driver_id: D2, fleet_owner_id: F1, shipper_id: S1, status: 'completed', quoted_price: 6000, final_price: 6000 },
    // D-24: the fleet won the work, but the driver of record holds no affiliation
    // with it — the sub-contracted case. The share lookup has nothing to read.
    { id: BG, driver_id: D5, fleet_owner_id: F1, shipper_id: S1, status: 'completed', quoted_price: 6000, final_price: 6000 },
  ],
  drivers: [
    { id: D1, user_id: U1 }, { id: D2, user_id: U2 }, { id: D3, user_id: U3 },
    { id: D4, user_id: U4 }, { id: D5, user_id: U5 },
  ],
}

// fleet_drivers as bt-payment-service reads it (migration 0022, column added by
// 0023's predecessor). D1 sits at 0 — salaried, which is what all 620 live rows
// do — so every pre-split check in this file must stay byte-identical.
// D5 is deliberately ABSENT: no row for (F1, D5) at all, which is not the same fact
// as a row saying 0 and must not be paid out as if it were (D-24).
const affiliations: Row[] = [
  { fleet_owner_id: F1, driver_id: D1, status: 'active', revenue_share_pct: 0 },
  { fleet_owner_id: F1, driver_id: D2, status: 'active', revenue_share_pct: 30 },
  { fleet_owner_id: F1, driver_id: D3, status: 'active', revenue_share_pct: 33.33 },
  { fleet_owner_id: F1, driver_id: D4, status: 'active', revenue_share_pct: 100 },
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
//
// The two schema states this fake can wear, flipped independently because they
// come from different migrations and production really does sit in each:
//   uniqueOnBookingIdOnly — pre-0023: migration 011's UNIQUE(booking_id) still
//     stands, so the table holds at most ONE payout per booking. deploy.yml
//     ships this service on merge and 0023 is applied by hand afterwards, so
//     every settlement has to keep working across that window.
//   hidePayeeType — pre-0016: the column does not exist, so it is absent from
//     the row objects PostgREST returns and cannot be named in a filter.
const payoutKey = (r: Row) => `${r.booking_id}|${r.payee_type ?? 'driver'}`
const P = { payments: new Map<string, Row>(), payouts: new Map<string, Row>() }
let uniqueOnBookingIdOnly = false
let hidePayeeType = false
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
  async getPayouts(b: string) {
    const rows = [...P.payouts.values()].filter(r => r.booking_id === b)
    // Pre-0016 rows have no payee_type COLUMN, so the key is absent from the
    // object — which is exactly the signal planPayoutWrites reads to decide
    // whether it may filter on it. Deleting the key rather than nulling it is
    // the point: `'payee_type' in row` must be false.
    return hidePayeeType ? rows.map(({ payee_type, fleet_owner_id, ...rest }) => rest) : rows
  },
  async insertPayout(r: Row) {
    // The pre-0023 table's own UNIQUE(booking_id) — the thing that refuses the
    // second row of a split rather than letting it overwrite the first.
    const clash = uniqueOnBookingIdOnly
      ? [...P.payouts.values()].some(x => x.booking_id === r.booking_id)
      : P.payouts.has(payoutKey(r))
    if (clash) throw new Error(`payouts insert hit a unique violation for booking ${r.booking_id}`)
    P.payouts.set(payoutKey(r), { ...r })
  },
  async updatePayout(r: Row, keyByPayeeType: boolean) {
    // Mirrors the real UPDATE ... WHERE booking_id [AND payee_type]: without
    // payee_type the filter matches every row of the booking, which on the
    // pre-0016 schema is at most one.
    for (const [k, row] of P.payouts) {
      if (row.booking_id !== r.booking_id) continue
      if (keyByPayeeType && (row.payee_type ?? 'driver') !== r.payee_type) continue
      P.payouts.set(k, { ...r })
    }
  },
  async deletePayout(key: { bookingId: string; payeeType: string; keyByPayeeType: boolean }) {
    for (const [k, row] of [...P.payouts]) {
      if (row.booking_id !== key.bookingId) continue
      if (key.keyByPayeeType && (row.payee_type ?? 'driver') !== key.payeeType) continue
      P.payouts.delete(k)
    }
  },
  async insertPendingPayoutIfAbsent(r: Row) { if (!P.payouts.has(payoutKey(r))) P.payouts.set(payoutKey(r), { ...r }) },
  // Mirrors SupabasePaymentStore.getDriverShare: NO ROW is reported as its own
  // answer rather than flattened into a share of 0. Returning a bare number here is
  // what made the ₹0 sub-contract payout invisible to this suite.
  async getDriverShare(fleetOwnerId: string, driverId: string) {
    const rows = affiliations.filter(a => a.fleet_owner_id === fleetOwnerId && a.driver_id === driverId)
    const governing = rows.find(a => a.status === 'active') ?? rows[0]
    if (!governing) return { affiliation: 'none' as const, share_pct: 0, status: null }
    return {
      affiliation: 'affiliated' as const,
      share_pct: Number(governing.revenue_share_pct ?? 0),
      status: governing.status as string,
    }
  },
}

// "The payout" stopped being a question with one answer, so every check below
// names the payee it means.
// `?? 'driver'` because a pre-0016 row carries no payee_type at all and IS the
// driver's — the same reading the service does, so the legacy-schema checks
// below are asserting against the row the service actually sees.
const payoutOf = async (b: string, type: 'driver' | 'fleet_owner' = 'driver') =>
  (await fakeStore.getPayouts(b)).find(r => (r.payee_type ?? 'driver') === type) ?? null
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
  // A capturing logger, not a silent one: the D-24 anomaly is half a log line and
  // half a response field, and the log is the half that survives the HTTP call.
  const warnings: { obj: Record<string, unknown>; msg: string }[] = []
  const deps = {
    booking: new HttpBookingClient(bookingBase, SECRET),
    store: fakeStore as any,
    logger: { warn: (obj: unknown, msg: string) => { warnings.push({ obj: obj as Record<string, unknown>, msg }) } },
  }
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
  // A salaried trip is an AGREEMENT, not a gap: the affiliation exists and says 0.
  // It must stay silent, or the D-24 signal is noise on all 620 live rows.
  check('a salaried settlement raises NO anomaly', (r.json().data?.anomalies ?? []).length === 0, JSON.stringify(r.json().data?.anomalies))
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
  check('a split backed by a real affiliation raises NO anomaly', (r.json().data?.anomalies ?? []).length === 0, JSON.stringify(r.json().data?.anomalies))

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

  console.log('\n── D-24: an UNAFFILIATED executing driver is LOUD, not silently paid ₹0 ──')
  // The failure this closes. The D-7 share lookup returned 0 whenever no
  // fleet_drivers row existed, so a driver who ran a trip for a fleet they are not
  // affiliated with was treated as salaried and paid NOTHING — no payout row, no
  // error, no log line, and a ledger that agrees the trip was settled in full. The
  // only party who would ever notice is the one who drove.
  //
  // The payout POLICY is deliberately unchanged (the carrier won the work and is
  // paid it; what a sub-contracted driver is owed is post-MVP). What changes is that
  // the settlement now says which fact it was missing when it decided that.
  r = await settle({ booking_id: BG, amount: 6000, mode: 'cash', reference: 'UTR-SUBK' }, tok(S1, 'shipper'))
  check('an unaffiliated-driver trip still settles 200 paid (money is not held hostage)',
    r.statusCode === 200 && bStatus(BG) === 'paid', `(got ${r.statusCode}/${bStatus(BG)})`)
  const subcontract = (r.json().data?.anomalies ?? [])[0]
  check('the settlement result carries the anomaly',
    subcontract?.code === 'UNAFFILIATED_EXECUTING_DRIVER', JSON.stringify(r.json().data?.anomalies))
  check('the anomaly names the driver AND the carrier, so it can be acted on',
    subcontract?.driver_id === D5 && subcontract?.fleet_owner_id === F1, JSON.stringify(subcontract))
  check('no ₹0 driver row was written to the ledger', !(await payoutOf(BG, 'driver')), JSON.stringify(await payoutOf(BG, 'driver')))
  check('the whole freight is still recorded to the carrier that won the work',
    (await fakeStore.getPayouts(BG)).length === 1 && (await payoutOf(BG, 'fleet_owner'))?.amount === 6000,
    JSON.stringify(await fakeStore.getPayouts(BG)))
  // The response field is read by whoever made the call; the log is what is still
  // there next week. It has to carry every id needed to chase the driver's money
  // without first working out which trip the line is about.
  const warned = warnings.find(w => w.obj.code === 'UNAFFILIATED_EXECUTING_DRIVER')
  check('the anomaly is logged, not only returned', !!warned, JSON.stringify(warnings.map(w => w.obj.code)))
  check('the log line carries booking, driver, carrier and the amount settled',
    warned?.obj.booking_id === BG && warned?.obj.driver_id === D5 &&
    warned?.obj.fleet_owner_id === F1 && warned?.obj.amount === 6000, JSON.stringify(warned?.obj))
  check('a salaried fleet settlement logged nothing of the kind',
    warnings.filter(w => w.obj.code === 'UNAFFILIATED_EXECUTING_DRIVER').length === 1,
    JSON.stringify(warnings.map(w => w.obj.booking_id)))

  console.log('\n── D-7 revenue split: the resolver, without a database ──')
  // resolvePayees is kept pure so the disbursement layer (D-12, a later PR) can
  // reuse it; these pin the edges that never show up in a happy-path settlement.
  const { resolvePayees, resolveSettlement } = await import('../src/lib/payment-service.js')
  const fleetBooking = { driver_id: D2, fleet_owner_id: F1 }
  check('share=100 pays the driver alone — no ₹0 owner row in the ledger', JSON.stringify(resolvePayees(fleetBooking, 6000, 100)) === JSON.stringify([{ payee_type: 'driver', driver_id: D2, fleet_owner_id: null, amount: 6000 }]), JSON.stringify(resolvePayees(fleetBooking, 6000, 100)))
  check('a share above 100 is clamped, never a negative owner payout', resolvePayees(fleetBooking, 6000, 150).every(p => p.amount >= 0) && resolvePayees(fleetBooking, 6000, 150).reduce((s, p) => s + paise(p.amount), 0) === paise(6000), JSON.stringify(resolvePayees(fleetBooking, 6000, 150)))
  check('a negative share is clamped to salaried (owner keeps 100%)', resolvePayees(fleetBooking, 6000, -5).length === 1 && resolvePayees(fleetBooking, 6000, -5)[0].payee_type === 'fleet_owner', JSON.stringify(resolvePayees(fleetBooking, 6000, -5)))
  check('fleet booking with no assigned driver has nobody to split with', resolvePayees({ driver_id: null, fleet_owner_id: F1 }, 6000, 30).length === 1, JSON.stringify(resolvePayees({ driver_id: null, fleet_owner_id: F1 }, 6000, 30)))
  check('a booking with no bidder resolves to no payees at all', resolvePayees({ driver_id: null, fleet_owner_id: null }, 6000, 30).length === 0, '')

  console.log('\n── D-24: which zero is which, without a database ──')
  // Three ways to arrive at "the driver gets nothing", only one of which is an
  // anomaly. Getting these confused is the whole defect: two of them are ordinary
  // and must stay silent, and the third must never be mistaken for them.
  const salaried = { affiliation: 'affiliated' as const, share_pct: 0, status: 'active' }
  const unaffiliated = { affiliation: 'none' as const, share_pct: 0, status: null }
  const preMigration = { affiliation: 'unknown' as const, share_pct: 0, status: null }
  const split30 = { affiliation: 'affiliated' as const, share_pct: 30, status: 'active' }
  {
    const asSalary = resolveSettlement(fleetBooking, 6000, salaried)
    check('affiliated + share 0 is a SALARY: owner keeps 6000, nothing flagged',
      asSalary.anomalies.length === 0 && asSalary.payees.length === 1 && asSalary.payees[0].amount === 6000,
      JSON.stringify(asSalary))
    const asSubcontract = resolveSettlement(fleetBooking, 6000, unaffiliated)
    check('no affiliation row pays the SAME money but raises the anomaly',
      asSubcontract.anomalies.length === 1 && asSubcontract.payees.length === 1 && asSubcontract.payees[0].amount === 6000,
      JSON.stringify(asSubcontract))
    check('and the anomaly quotes both parties in its message, not just its fields',
      asSubcontract.anomalies[0].message.includes(D2) && asSubcontract.anomalies[0].message.includes(F1),
      asSubcontract.anomalies[0]?.message)
    check('a pre-0022 schema that CANNOT answer stays silent (every trip is salaried there)',
      resolveSettlement(fleetBooking, 6000, preMigration).anomalies.length === 0, '')
    check('an affiliated 30% split is unchanged and silent',
      JSON.stringify(resolveSettlement(fleetBooking, 6000, split30).payees) === JSON.stringify(resolvePayees(fleetBooking, 6000, 30)) &&
      resolveSettlement(fleetBooking, 6000, split30).anomalies.length === 0,
      JSON.stringify(resolveSettlement(fleetBooking, 6000, split30)))
    check('a solo booking has no carrier for its driver to be unaffiliated FROM',
      resolveSettlement({ driver_id: D2, fleet_owner_id: null }, 5000, unaffiliated).anomalies.length === 0, '')
    check('a fleet booking with no driver has nobody whose cut could have gone missing',
      resolveSettlement({ driver_id: null, fleet_owner_id: F1 }, 6000, unaffiliated).anomalies.length === 0, '')
    check('a booking whose share was never read (solo path) is silent too',
      resolveSettlement({ driver_id: D2, fleet_owner_id: null }, 5000, null).anomalies.length === 0, '')
  }

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

  console.log('\n── D-7 share = 100: settle RECONCILES, it does not just overwrite ──')
  // Reproduced defect: the saga pre-creates a 'pending' fleet_owner payout at
  // completion, then the settlement resolves to the DRIVER alone (share 100
  // drops the owner's ₹0 row). Upserting only the computed rows left the owner's
  // stale pending row untouched, so the booking held rows summing to 12000 on a
  // 6000 settlement — and `payout`, the field the shipper app renders, returned
  // the stale 'pending' one.
  r = await payApp.inject({
    method: 'POST', url: '/internal/trip-completed',
    headers: { 'x-internal-secret': SECRET }, payload: { booking_id: BD, driver_id: D4, fleet_owner_id: F1, amount: 6000 },
  })
  check('saga pre-created the owner row at completion', (await payoutOf(BD, 'fleet_owner'))?.status === 'pending', JSON.stringify(await payoutOf(BD, 'fleet_owner')))
  r = await settle({ booking_id: BD, amount: 6000, mode: 'upi', reference: 'UTR-100' }, tok(S1, 'shipper'))
  check('settle share=100 booking 200 paid', r.statusCode === 200 && bStatus(BD) === 'paid', `(got ${r.statusCode}/${bStatus(BD)})`)
  const reconciled = await fakeStore.getPayouts(BD)
  check('the owner row this settlement does not pay is GONE', !(await payoutOf(BD, 'fleet_owner')), JSON.stringify(await payoutOf(BD, 'fleet_owner')))
  check('exactly one payout row survives', reconciled.length === 1, JSON.stringify(reconciled))
  check('payout rows sum to the settlement, not to twice it', reconciled.reduce((s, p) => s + paise(p.amount), 0) === paise(6000), JSON.stringify(reconciled))
  check('the surviving row is the driver, recorded (no stale pending)', (await payoutOf(BD, 'driver'))?.status === 'recorded' && (await payoutOf(BD, 'driver'))?.driver_id === D4, JSON.stringify(await payoutOf(BD, 'driver')))
  check('back-compat `payout` is not the stale pending row', r.json().data?.payout?.status === 'recorded' && r.json().data?.payout?.payee_type === 'driver', JSON.stringify(r.json().data?.payout))
  // Reconciliation must be a no-op once it has converged, or a heal retry would
  // start deleting and re-inserting rows on every call.
  r = await settle({ booking_id: BD, amount: 6000, mode: 'upi', reference: 'UTR-100' }, tok(S1, 'shipper'))
  check('re-settling a reconciled booking changes nothing', r.statusCode === 200 && (await fakeStore.getPayouts(BD)).length === 1, JSON.stringify(await fakeStore.getPayouts(BD)))

  console.log('\n── the reconciliation plan, without a database ──')
  const { planPayoutWrites } = await import('../src/lib/payment-service.js')
  const ownerRow = { booking_id: 'b', payee_type: 'fleet_owner', driver_id: null, fleet_owner_id: F1, amount: 6000, mode: null, status: 'pending', recorded_by: null } as any
  const driverRow = { booking_id: 'b', payee_type: 'driver', driver_id: D4, fleet_owner_id: null, amount: 6000, mode: 'upi', status: 'recorded', recorded_by: S1 } as any
  {
    const plan = planPayoutWrites('b', [ownerRow], [driverRow])
    check('a payee that lost its share is planned for REMOVAL', plan.remove.length === 1 && plan.remove[0].payeeType === 'fleet_owner', JSON.stringify(plan.remove))
    check('the new payee is planned as an INSERT, not an update', plan.insert.length === 1 && plan.update.length === 0, JSON.stringify(plan))
  }
  {
    const plan = planPayoutWrites('b', [driverRow], [driverRow])
    check('an already-correct row is an UPDATE and nothing is removed', plan.update.length === 1 && plan.insert.length === 0 && plan.remove.length === 0, JSON.stringify(plan))
  }
  {
    // A pre-0016 row carries no payee_type key at all. It IS the driver's (that
    // is the column's own default), and nothing may filter on a column the table
    // does not have — so the plan must neither orphan it nor key on payee_type.
    const { payee_type, fleet_owner_id, ...pre0016 } = driverRow
    const plan = planPayoutWrites('b', [pre0016 as any], [driverRow])
    check('a pre-0016 row is matched as the driver, not orphaned', plan.update.length === 1 && plan.remove.length === 0, JSON.stringify(plan))
    check('pre-0016 addressing does not filter on payee_type', plan.keyByPayeeType === false, JSON.stringify(plan.keyByPayeeType))
  }
  check('post-0016 addressing filters on payee_type', planPayoutWrites('b', [driverRow], [driverRow]).keyByPayeeType === true, '')

  console.log('\n── PRE-0023 schema: the settle path must still work ──')
  // Migrations here are applied BY HAND; deploy.yml auto-deploys this service on
  // merge. So production passes through "new service, old schema", and on it the
  // old UNIQUE(booking_id) still stands and rows carry no payee_type. Inferring
  // ON CONFLICT (booking_id, payee_type) made Postgres raise 42P10 on the FIRST
  // write, so EVERY settlement 500'd for as long as that window lasted.
  uniqueOnBookingIdOnly = true
  hidePayeeType = true
  r = await settle({ booking_id: BE, amount: 5000, mode: 'cash', reference: 'UTR-LEGACY' }, tok(S1, 'shipper'))
  check('solo settle on a pre-0023 schema 200 paid', r.statusCode === 200 && bStatus(BE) === 'paid', `(got ${r.statusCode}/${bStatus(BE)})`)
  check('pre-0023 settle recorded the payment', (await fakeStore.getPayment(BE))?.amount === 5000, JSON.stringify(await fakeStore.getPayment(BE)))
  check('pre-0023 settle wrote exactly one payout for the full amount', (await fakeStore.getPayouts(BE)).length === 1 && (await payoutOf(BE))?.amount === 5000, JSON.stringify(await fakeStore.getPayouts(BE)))
  r = await settle({ booking_id: BE, amount: 5000, mode: 'cash', reference: 'UTR-LEGACY' }, tok(S1, 'shipper'))
  check('pre-0023 double-settle still idempotent', r.statusCode === 200 && (await fakeStore.getPayouts(BE)).length === 1, JSON.stringify(await fakeStore.getPayouts(BE)))
  // 0016 applied, 0023 not — the state the hand-migration ordering actually
  // produces. The saga left a fleet_owner row; share = 100 replaces it with a
  // driver row. ONE row in, one row out, so the old UNIQUE(booking_id) can hold
  // the result perfectly well — but only if the stale row goes before the new
  // one arrives. Inserting first would trip the constraint on a settlement the
  // table was always able to store.
  hidePayeeType = false
  // Rewind BD to just-completed so the same booking can be replayed against the
  // older schema; only its own rows are touched.
  bstore.bookings.find(b => b.id === BD)!.status = 'completed'
  P.payments.delete(BD)
  for (const [k, row] of [...P.payouts]) if (row.booking_id === BD) P.payouts.delete(k)
  await payApp.inject({
    method: 'POST', url: '/internal/trip-completed',
    headers: { 'x-internal-secret': SECRET }, payload: { booking_id: BD, driver_id: D4, fleet_owner_id: F1, amount: 6000 },
  })
  r = await settle({ booking_id: BD, amount: 6000, mode: 'upi' }, tok(S1, 'shipper'))
  check('pre-0023 reconciliation swaps one payee for another and settles', r.statusCode === 200 && bStatus(BD) === 'paid', `(got ${r.statusCode}/${bStatus(BD)})`)
  check('pre-0023 swap left exactly the driver row', (await fakeStore.getPayouts(BD)).length === 1 && (await payoutOf(BD, 'driver'))?.amount === 6000, JSON.stringify(await fakeStore.getPayouts(BD)))

  // The one thing a pre-0023 table genuinely cannot hold. It must REFUSE, loudly
  // and with nothing recorded — never let the second payee overwrite the first,
  // which would silently pay one party and drop the other.
  r = await settle({ booking_id: BF, amount: 6000, mode: 'cash' }, tok(S1, 'shipper'))
  check('a SPLIT on a pre-0023 schema is refused, not half-paid', r.statusCode === 500, `(got ${r.statusCode})`)
  check('refused split recorded no payment (retriable once 0023 lands)', !(await fakeStore.getPayment(BF)), '')
  check('refused split left the booking completed, not paid', bStatus(BF) === 'completed', `(got ${bStatus(BF)})`)
  check('refused split never wrote a driver row over the owner row', (await fakeStore.getPayouts(BF)).length <= 1, JSON.stringify(await fakeStore.getPayouts(BF)))
  // Apply the migration under a running service — no restart, no redeploy — and
  // the same settle now completes. That is the coupling being gone, not documented.
  uniqueOnBookingIdOnly = false
  r = await settle({ booking_id: BF, amount: 6000, mode: 'cash' }, tok(S1, 'shipper'))
  check('the SAME settle succeeds once 0023 is applied, no redeploy', r.statusCode === 200 && bStatus(BF) === 'paid', `(got ${r.statusCode}/${bStatus(BF)})`)
  const healed = await fakeStore.getPayouts(BF)
  check('post-migration retry holds exactly two rows summing to the settlement', healed.length === 2 && healed.reduce((s, p) => s + paise(p.amount), 0) === paise(6000), JSON.stringify(healed))

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
