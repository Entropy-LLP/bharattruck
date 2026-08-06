/**
 * Freight documents — the real routes via app.inject(), against an in-memory
 * fake Supabase (the T-BE-1 injection seam), same shape as pod.e2e.mts.
 *
 * What this pins, all of it compliance rather than plumbing:
 *
 *   - WHO issues what. The consignment note is the CARRIER's document and the
 *     invoice is the SHIPPER's; neither party can issue the other's, and neither
 *     can name a different issuer, because the issuer is derived from the booking
 *     and the JWT and is never read off the request body. That is red line 1
 *     (§1.3) expressed as an authorization rule.
 *   - The §11.4 anti-drift rule: the invoice number and value printed on an LR
 *     come from OUR invoice row, not from whatever the caller typed. On paper a
 *     clerk retypes them and they drift by ₹63,776, and consignment value drives
 *     the e-way bill threshold.
 *   - actual vs charged weight — charged is computed as max(actual, volumetric)
 *     server-side, so a caller cannot under-state the weight the freight bills on.
 *   - valid_upto is STORED VERBATIM from the portal (§4.4). Nothing derives it.
 *   - A pre-0024 database: reads answer "no documents", writes fail loudly with a
 *     503 rather than pretending to have issued a legal document.
 *
 * Run: npx tsx test/freight-documents.e2e.mts
 */
process.env.JWT_SECRET = 'test-jwt-secret-long-enough-for-hs256-verification'
process.env.INTERNAL_SERVICE_SECRET = 'internal-secret-for-tests'
process.env.SUPABASE_URL = 'http://fake.local'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key'

import Fastify from 'fastify'
import jwt from 'jsonwebtoken'

// Fleet-carried booking
const B_FLEET   = '11111111-1111-4111-8111-111111111111'
// Solo-driver booking
const B_SOLO    = '22222222-2222-4222-8222-222222222222'
// Awarded to nobody yet
const B_OPEN    = '33333333-3333-4333-8333-333333333333'

const U_SHIPPER = '44444444-4444-4444-8444-444444444444'
const U_OWNER   = '55555555-5555-4555-8555-555555555555'
const U_DRIVER  = '66666666-6666-4666-8666-666666666666'
const U_OTHER   = '77777777-7777-4777-8777-777777777777'

const FLEET_ID  = '88888888-8888-4888-8888-888888888888'
const DRIVER_ID = '99999999-9999-4999-8999-999999999999'
const OTHER_DRV = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

type Row = Record<string, any>

function seedStore(): Record<string, Row[]> {
  return {
    bookings: [
      { id: B_FLEET, shipper_id: U_SHIPPER, driver_id: DRIVER_ID, fleet_owner_id: FLEET_ID, status: 'in_transit' },
      { id: B_SOLO,  shipper_id: U_SHIPPER, driver_id: DRIVER_ID, fleet_owner_id: null,      status: 'in_transit' },
      { id: B_OPEN,  shipper_id: U_SHIPPER, driver_id: null,      fleet_owner_id: null,      status: 'pending' },
    ],
    drivers: [
      { id: DRIVER_ID, user_id: U_DRIVER },
      { id: OTHER_DRV, user_id: U_OTHER },
    ],
    fleet_owners: [
      {
        id: FLEET_ID, user_id: U_OWNER, is_active: true,
        company_name: 'Shree Balaji Roadlines Pvt Ltd',
        gstin: '29AABCV3609C1ZJ', pan: 'AABCV3609C', billing_address: 'Hubballi, Karnataka',
      },
    ],
    users: [
      { id: U_SHIPPER, full_name: 'Destinio Clothing Co.' },
      { id: U_OWNER,   full_name: 'Balaji Owner' },
      { id: U_DRIVER,  full_name: 'Ramesh Kumar' },
      { id: U_OTHER,   full_name: 'Someone Else' },
    ],
    lorry_receipts: [],
    freight_invoices: [],
    eway_bill_records: [],
  }
}

const DOC_TABLES = new Set(['lorry_receipts', 'freight_invoices', 'eway_bill_records'])

class FakeQuery {
  private filters: Array<[string, any]> = []
  private mode: 'select' | 'insert' = 'select'
  private payload: Row | null = null
  constructor(private table: string, private store: Record<string, Row[]>, private missingTables: Set<string>) {}
  select() { return this }
  insert(p: Row) { this.mode = 'insert'; this.payload = p; return this }
  eq(c: string, v: any) { this.filters.push([c, v]); return this }
  order() { return this }
  private match(r: Row) { return this.filters.every(([c, v]) => r[c] === v) }
  private run(): { data: any; error: any } {
    if (this.missingTables.has(this.table)) {
      // PostgREST's schema-cache miss — a database without migration 0024.
      return { data: null, error: { code: 'PGRST205', message: `Could not find the table '${this.table}'` } }
    }
    const rows = this.store[this.table] ?? []
    if (this.mode === 'insert') {
      const row = { id: `${this.table}-${rows.length + 1}`, recorded_at: new Date().toISOString(), ...this.payload }
      const uniqueCol = this.table === 'eway_bill_records' ? 'ewb_number' : null
      if (uniqueCol && rows.some(r => r[uniqueCol] === row[uniqueCol])) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
      }
      rows.push(row)
      return { data: [row], error: null }
    }
    return { data: rows.filter(r => this.match(r)), error: null }
  }
  maybeSingle() { const { data, error } = this.run(); return Promise.resolve({ data: data?.length ? data[0] : null, error }) }
  single() { return this.maybeSingle() }
  then(f: (v: any) => any, r?: (e: any) => any) { return Promise.resolve(this.run()).then(f, r) }
}

/**
 * The RPC side stands in for migration 0024's issue_* functions: allocate on a
 * per-(kind, issuer, FY) counter and insert, as one unit. Deliberately minimal —
 * the allocation CONTRACT (gapless, per-owner, idempotent) is exercised properly
 * in document-numbering.unit.mts; here it exists so the route layer has something
 * to talk to.
 */
function makeRpc(store: Record<string, Row[]>, missing: Set<string>) {
  const counters = new Map<string, number>()
  const FY = '2026-27'
  const nextNumber = (key: string, prefix: string | null) => {
    const n = (counters.get(key) ?? 0) + 1
    counters.set(key, n)
    return `${prefix ? `${prefix}/` : ''}${FY}/${n}`
  }

  return async (fn: string, args: any) => {
    if (missing.has('rpc')) return { data: null, error: { code: 'PGRST202', message: `no function ${fn}` } }

    if (fn === 'issue_lorry_receipt') {
      const existing = store.lorry_receipts.find(r => r.booking_id === args.p_booking_id)
      if (existing) return { data: existing, error: null }
      const number = nextNumber(`lr|${args.p_issuer_kind}|${args.p_issuer_id}`, args.p_prefix)
      const row = {
        id: `lr-${number}`, booking_id: args.p_booking_id, lr_number: number, financial_year: FY,
        issuer_kind: args.p_issuer_kind, issuer_id: args.p_issuer_id,
        total_charge_inr:
          Number(args.p_payload.freight_charge_inr ?? 0) + Number(args.p_payload.stationary_charge_inr ?? 0) +
          Number(args.p_payload.handling_charge_inr ?? 0) + Number(args.p_payload.other_charge_inr ?? 0),
        issued_at: new Date().toISOString(),
        ...args.p_payload,
      }
      store.lorry_receipts.push(row)
      return { data: row, error: null }
    }

    if (fn === 'issue_freight_invoice') {
      const existing = store.freight_invoices.find(r => r.booking_id === args.p_booking_id)
      if (existing) return { data: existing, error: null }
      const number = nextNumber(`invoice|shipper|${args.p_supplier_user_id}`, args.p_prefix)
      const p = args.p_payload
      const row = {
        id: `inv-${number}`, booking_id: args.p_booking_id, invoice_number: number, financial_year: FY,
        supplier_user_id: args.p_supplier_user_id,
        // The generated column, computed the way the DB computes it.
        consignment_value_inr:
          Number(p.taxable_value_inr) + Number(p.cgst_inr ?? 0) + Number(p.sgst_inr ?? 0) +
          Number(p.utgst_inr ?? 0) + Number(p.igst_inr ?? 0) + Number(p.cess_inr ?? 0) -
          Number(p.exempt_value_inr ?? 0),
        issued_at: new Date().toISOString(),
        ...p,
      }
      store.freight_invoices.push(row)
      return { data: row, error: null }
    }

    return { data: null, error: { code: 'PGRST202', message: `no function ${fn}` } }
  }
}

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}`) } else { failures.push(`${name} ${detail}`); console.log(`  FAIL  ${name} ${detail}`) }
}
const tok = (u: string, role: string) => jwt.sign({ userId: u, role }, process.env.JWT_SECRET!)

const LR_BODY = {
  consignor_name: 'Destinio Clothing Co.',
  consignor_gstin: '29AAACD1234E1Z5',
  consignee_name: 'Maru Enterprises Pvt Ltd',
  origin_place: 'Hubballi',
  destination_place: 'Bengaluru',
  actual_weight_kg: 9000,
  volumetric_weight_kg: 12500,
  said_to_contain: 'READYMADE GARMENTS - 42 CARTONS',
  freight_charge_inr: 18000,
  stationary_charge_inr: 50,
  handling_charge_inr: 900,
  freight_term: 'TO_PAY',
  delivery_mode: 'GODOWN',
}

const INVOICE_BODY = {
  billed_to_name: 'Maru Enterprises Pvt Ltd',
  billed_to_state_code: '29',
  // The §4.1 worked example: ₹48,000 + 5% = ₹50,400, which is over the line.
  taxable_value_inr: 48000,
  cgst_inr: 1200,
  sgst_inr: 1200,
}

async function build(store: Record<string, Row[]>, missing = new Set<string>()) {
  const { __setSupabaseClientForTests } = await import('../src/lib/supabase.js')
  const authPlugin = (await import('../src/plugins/auth.js')).default
  const { bookingRoutes } = await import('../src/routes/bookings.js')
  const { documentRoutes } = await import('../src/routes/documents.js')

  __setSupabaseClientForTests({
    from: (t: string) => new FakeQuery(t, store, missing),
    rpc: makeRpc(store, missing),
  } as any)

  const app = Fastify({ logger: false })
  await app.register(async (a) => {
    await a.register(authPlugin)
    await a.register(bookingRoutes, { prefix: '/bookings' })
    await a.register(documentRoutes, { prefix: '/bookings' })
  })
  await app.ready()
  return app
}

async function main() {
  console.log('\n── the LR is the CARRIER\'s document ──')
  {
    const store = seedStore()
    const app = await build(store)

    let r = await app.inject({
      method: 'POST', url: `/bookings/${B_FLEET}/documents/lr`,
      headers: { authorization: `Bearer ${tok(U_SHIPPER, 'shipper')}` }, payload: LR_BODY,
    })
    check('the shipper cannot issue the carrier\'s consignment note', r.statusCode === 403, `(got ${r.statusCode})`)

    r = await app.inject({
      method: 'POST', url: `/bookings/${B_FLEET}/documents/lr`,
      headers: { authorization: `Bearer ${tok(U_OTHER, 'fleet_owner')}` }, payload: LR_BODY,
    })
    check('an unrelated fleet cannot issue on this booking', r.statusCode === 403, `(got ${r.statusCode})`)

    r = await app.inject({
      method: 'POST', url: `/bookings/${B_FLEET}/documents/lr`,
      headers: { authorization: `Bearer ${tok(U_OWNER, 'fleet_owner')}` }, payload: LR_BODY,
    })
    check('the carrying fleet CAN', r.statusCode === 201, `(got ${r.statusCode}: ${r.body})`)

    const lr = r.json().data
    check('the number is per-owner and Rule 46(b)-shaped', lr.lr_number === '2026-27/1', `(got ${lr.lr_number})`)
    check('it is not a uuid', !/^[0-9a-f]{8}-/.test(lr.lr_number))

    // 🔴 The issuer is the FLEET, read from its own row. Never the platform, and
    // never anything the caller could have supplied.
    check('the issuer is the fleet owner', lr.issuer_kind === 'fleet_owner' && lr.issuer_id === FLEET_ID)
    check('named from the fleet\'s own record', lr.issuer_legal_name === 'Shree Balaji Roadlines Pvt Ltd')
    check('carrying the fleet\'s GSTIN as the transporter id', lr.issuer_transporter_id === '29AABCV3609C1ZJ')
    check('the platform is nowhere in the issuer block', !JSON.stringify(lr).includes('BharatTruck'))

    // §11.2 — both weights, and the charged one is computed.
    check('actual weight is what was handed over', Number(lr.actual_weight_kg) === 9000)
    check('charged weight is max(actual, volumetric), computed server-side', Number(lr.charged_weight_kg) === 12500)

    // Separate charge lines, not one lump figure.
    check('freight, stationary and hamali are separate lines',
      Number(lr.freight_charge_inr) === 18000 && Number(lr.stationary_charge_inr) === 50 && Number(lr.handling_charge_inr) === 900)
    check('and they sum to the total', Number(lr.total_charge_inr) === 18950, `(got ${lr.total_charge_inr})`)
    check('the response echoes the same total', lr.charges_total_inr === 18950)

    check('the freight term is first-class (§5.8)', lr.freight_term === 'TO_PAY')
    check('delivery mode is recorded', lr.delivery_mode === 'GODOWN')
    check('"said to contain" is preserved verbatim', lr.said_to_contain === 'READYMADE GARMENTS - 42 CARTONS')
    check('RCM is the default GTA posture', lr.reverse_charge === true)
    check('the risk election defaults to owner\'s risk', lr.carriage_risk === 'owners_risk')

    // Idempotent: never renumbered.
    r = await app.inject({
      method: 'POST', url: `/bookings/${B_FLEET}/documents/lr`,
      headers: { authorization: `Bearer ${tok(U_OWNER, 'fleet_owner')}` }, payload: LR_BODY,
    })
    check('re-issuing returns the SAME number', r.json().data.lr_number === '2026-27/1')
    check('and does not create a second document', store.lorry_receipts.length === 1)

    await app.close()
  }

  console.log('\n── a solo owner-driver issues under their OWN series ──')
  {
    const store = seedStore()
    const app = await build(store)

    let r = await app.inject({
      method: 'POST', url: `/bookings/${B_SOLO}/documents/lr`,
      headers: { authorization: `Bearer ${tok(U_OTHER, 'driver')}` }, payload: LR_BODY,
    })
    check('a driver who is not on the booking gets 403', r.statusCode === 403, `(got ${r.statusCode})`)

    r = await app.inject({
      method: 'POST', url: `/bookings/${B_SOLO}/documents/lr`,
      headers: { authorization: `Bearer ${tok(U_DRIVER, 'driver')}` }, payload: LR_BODY,
    })
    check('the assigned owner-driver issues their own LR', r.statusCode === 201, `(got ${r.statusCode}: ${r.body})`)
    const lr = r.json().data
    check('issuer_kind is driver, not fleet_owner', lr.issuer_kind === 'driver')
    // drivers.id, NOT users.id — the identity gotcha this repo keeps re-learning.
    check('and the issuer id is the drivers row, not the users row', lr.issuer_id === DRIVER_ID)
    check('their series also starts at 1', lr.lr_number === '2026-27/1')

    await app.close()
  }

  console.log('\n── no carrier, no consignment note ──')
  {
    const app = await build(seedStore())
    const r = await app.inject({
      method: 'POST', url: `/bookings/${B_OPEN}/documents/lr`,
      headers: { authorization: `Bearer ${tok(U_DRIVER, 'driver')}` }, payload: LR_BODY,
    })
    // Issuing one transfers the lien and makes the carrier responsible for the
    // goods (CBIC Flyer 38) — there is nobody to transfer it to yet.
    check('issuing before a carrier is awarded is a 409', r.statusCode === 409, `(got ${r.statusCode})`)
    await app.close()
  }

  console.log('\n── the invoice is the SHIPPER\'s document, on the SHIPPER\'s series ──')
  {
    const store = seedStore()
    const app = await build(store)

    let r = await app.inject({
      method: 'POST', url: `/bookings/${B_FLEET}/documents/invoice`,
      headers: { authorization: `Bearer ${tok(U_OWNER, 'fleet_owner')}` }, payload: INVOICE_BODY,
    })
    check('the carrier cannot issue the shipper\'s invoice', r.statusCode === 403, `(got ${r.statusCode})`)

    r = await app.inject({
      method: 'POST', url: `/bookings/${B_FLEET}/documents/invoice`,
      headers: { authorization: `Bearer ${tok(U_SHIPPER, 'shipper')}` }, payload: INVOICE_BODY,
    })
    check('the shipper can', r.statusCode === 201, `(got ${r.statusCode}: ${r.body})`)

    const inv = r.json().data
    check('numbered on the shipper\'s own series', inv.invoice_number === '2026-27/1')
    check('the supplier is the shipper', inv.supplier_user_id === U_SHIPPER)
    check('named from their user record when not supplied', inv.supplier_legal_name === 'Destinio Clothing Co.')

    // §4.1 — the whole point.
    check('consignment value INCLUDES GST: 48,000 + 2,400 = 50,400',
      Number(inv.consignment_value_inr) === 50400, `(got ${inv.consignment_value_inr})`)
    check('which is over the ₹50,000 line the pre-tax figure would have missed',
      Number(inv.consignment_value_inr) > 50000 && Number(inv.taxable_value_inr) < 50000)
    check('the grand total is computed server-side, not accepted', Number(inv.grand_total_inr) === 50400)

    await app.close()
  }

  console.log('\n── neither party transcribes the other\'s numbers (§11.4) ──')
  {
    const store = seedStore()
    const app = await build(store)

    // Invoice first, then the LR. The LR must carry the invoice's number and its
    // GST-INCLUSIVE value — the two fields a booking clerk retypes and gets wrong.
    await app.inject({
      method: 'POST', url: `/bookings/${B_FLEET}/documents/invoice`,
      headers: { authorization: `Bearer ${tok(U_SHIPPER, 'shipper')}` }, payload: INVOICE_BODY,
    })

    const r = await app.inject({
      method: 'POST', url: `/bookings/${B_FLEET}/documents/lr`,
      headers: { authorization: `Bearer ${tok(U_OWNER, 'fleet_owner')}` },
      // A caller trying to hand-key the linkage, exactly as on paper.
      payload: { ...LR_BODY, invoice_number: 'WRONG/1', invoice_value_inr: 127552 },
    })
    const lr = r.json().data
    check('the LR carries OUR invoice number', lr.invoice_number === '2026-27/1', `(got ${lr.invoice_number})`)
    check('the hand-keyed number is ignored', lr.invoice_number !== 'WRONG/1')
    check('the invoice value is the GST-inclusive consignment value', Number(lr.invoice_value_inr) === 50400, `(got ${lr.invoice_value_inr})`)
    check('the hand-keyed value is ignored — no ₹63,776 drift', Number(lr.invoice_value_inr) !== 127552)

    await app.close()
  }

  console.log('\n── e-way bill: recorded, never generated (D-17) ──')
  {
    const store = seedStore()
    const app = await build(store)

    // §4.4: the portal applied the midnight rule and handed us a deadline — a
    // bill raised late in the evening dies at midnight the FOLLOWING day, so it
    // gets ~24 hours where an early-morning one gets ~48 from the same "1 day".
    // Relative to now so the expiry verdicts stay meaningful, never so that the
    // deadline is computed from the generation time.
    const nowMs = Date.now()
    const generated = new Date(nowMs - 3600_000).toISOString()
    const validUpto = new Date(nowMs + 32 * 3600_000).toISOString()

    let r = await app.inject({
      method: 'POST', url: `/bookings/${B_FLEET}/documents/eway-bill`,
      headers: { authorization: `Bearer ${tok(U_SHIPPER, 'shipper')}` },
      payload: { ewb_number: '12345678901', generated_at: generated, valid_upto: validUpto, issuing_portal: 'NIC1' },
    })
    check('an 11-digit e-way bill number is rejected', r.statusCode === 400, `(got ${r.statusCode})`)

    r = await app.inject({
      method: 'POST', url: `/bookings/${B_FLEET}/documents/eway-bill`,
      headers: { authorization: `Bearer ${tok(U_SHIPPER, 'shipper')}` },
      payload: { ewb_number: '181234567890', generated_at: generated, valid_upto: generated, issuing_portal: 'NIC1' },
    })
    check('a valid_upto at or before generation is rejected', r.statusCode === 400, `(got ${r.statusCode})`)

    r = await app.inject({
      method: 'POST', url: `/bookings/${B_FLEET}/documents/eway-bill`,
      headers: { authorization: `Bearer ${tok(U_OTHER, 'shipper')}` },
      payload: { ewb_number: '181234567890', generated_at: generated, valid_upto: validUpto, issuing_portal: 'NIC1' },
    })
    check('a stranger cannot file against this booking', r.statusCode === 403, `(got ${r.statusCode})`)

    r = await app.inject({
      method: 'POST', url: `/bookings/${B_FLEET}/documents/eway-bill`,
      headers: { authorization: `Bearer ${tok(U_SHIPPER, 'shipper')}` },
      payload: {
        ewb_number: '181234567890', generated_at: generated, valid_upto: validUpto,
        issuing_portal: 'NIC2', part_b_entered_at: generated,
      },
    })
    check('the shipper records the bill', r.statusCode === 201, `(got ${r.statusCode}: ${r.body})`)
    const ewb = r.json().data
    check('valid_upto is stored EXACTLY as the portal gave it', ewb.valid_upto === validUpto, `(got ${ewb.valid_upto})`)
    check('the issuing portal is kept — NIC1 and NIC2 are not interchangeable', ewb.issuing_portal === 'NIC2')
    check('Part B entry is timestamped (Rule 138(5A) one-way door)', ewb.part_b_entered_at === generated)
    // §9.3: the 4-day alert window, computed FROM the stored deadline.
    check('an expiry verdict is derived from the stored deadline', ewb.expiry?.state === 'expiring_soon', JSON.stringify(ewb.expiry))
    check('the countdown matches the deadline we were given',
      ewb.expiry.hours_remaining >= 30 && ewb.expiry.hours_remaining <= 32, `(got ${ewb.expiry?.hours_remaining})`)

    // A bill that died yesterday. Nothing about it is "nearly valid".
    r = await app.inject({
      method: 'POST', url: `/bookings/${B_SOLO}/documents/eway-bill`,
      headers: { authorization: `Bearer ${tok(U_SHIPPER, 'shipper')}` },
      payload: {
        ewb_number: '181234567891',
        generated_at: new Date(nowMs - 72 * 3600_000).toISOString(),
        valid_upto:   new Date(nowMs - 24 * 3600_000).toISOString(),
        issuing_portal: 'NIC1',
      },
    })
    const dead = r.json().data
    check('an expired bill reads as expired, not "1 hour left"',
      dead.expiry.state === 'expired' && dead.expiry.hours_remaining === 0, JSON.stringify(dead.expiry))

    r = await app.inject({
      method: 'POST', url: `/bookings/${B_FLEET}/documents/eway-bill`,
      headers: { authorization: `Bearer ${tok(U_SHIPPER, 'shipper')}` },
      payload: { ewb_number: '181234567890', generated_at: generated, valid_upto: validUpto, issuing_portal: 'NIC2' },
    })
    check('the same bill cannot be filed twice', r.statusCode === 409, `(got ${r.statusCode})`)

    await app.close()
  }

  console.log('\n── reading a booking\'s documents ──')
  {
    const store = seedStore()
    const app = await build(store)

    await app.inject({
      method: 'POST', url: `/bookings/${B_FLEET}/documents/invoice`,
      headers: { authorization: `Bearer ${tok(U_SHIPPER, 'shipper')}` }, payload: INVOICE_BODY,
    })

    let r = await app.inject({
      method: 'GET', url: `/bookings/${B_FLEET}/documents`,
      headers: { authorization: `Bearer ${tok(U_SHIPPER, 'shipper')}` },
    })
    check('the shipper reads their own booking\'s documents', r.statusCode === 200, `(got ${r.statusCode})`)
    check('the invoice is there', r.json().data.invoice?.invoice_number === '2026-27/1')
    check('no LR has been issued yet, and that is a null not an error', r.json().data.lorry_receipt === null)

    r = await app.inject({
      method: 'GET', url: `/bookings/${B_FLEET}/documents`,
      headers: { authorization: `Bearer ${tok(U_OWNER, 'fleet_owner')}` },
    })
    check('the carrying fleet reads them too', r.statusCode === 200, `(got ${r.statusCode})`)

    r = await app.inject({
      method: 'GET', url: `/bookings/${B_FLEET}/documents`,
      headers: { authorization: `Bearer ${tok(U_OTHER, 'shipper')}` },
    })
    check('an unrelated shipper cannot', r.statusCode === 403, `(got ${r.statusCode})`)

    r = await app.inject({
      method: 'GET', url: '/bookings/not-a-uuid/documents',
      headers: { authorization: `Bearer ${tok(U_SHIPPER, 'shipper')}` },
    })
    check('a malformed id is a 400', r.statusCode === 400, `(got ${r.statusCode})`)

    await app.close()
  }

  console.log('\n── a database without migration 0024 ──')
  {
    // Migrations are applied by hand while CD deploys on merge, so this state is
    // real, not hypothetical.
    const app = await build(seedStore(), new Set([...DOC_TABLES, 'rpc']))

    let r = await app.inject({
      method: 'GET', url: `/bookings/${B_FLEET}/documents`,
      headers: { authorization: `Bearer ${tok(U_SHIPPER, 'shipper')}` },
    })
    check('reads still answer 200', r.statusCode === 200, `(got ${r.statusCode})`)
    check('with no documents rather than an error', r.json().data.lorry_receipt === null && r.json().data.invoice === null)
    check('and an empty e-way bill list', Array.isArray(r.json().data.eway_bills) && r.json().data.eway_bills.length === 0)

    r = await app.inject({
      method: 'POST', url: `/bookings/${B_FLEET}/documents/lr`,
      headers: { authorization: `Bearer ${tok(U_OWNER, 'fleet_owner')}` }, payload: LR_BODY,
    })
    check('issuing fails loudly with a 503, never a fake document', r.statusCode === 503, `(got ${r.statusCode})`)
    check('and the message names the missing migration', /0024/.test(r.json().error ?? ''), r.body)

    r = await app.inject({
      method: 'POST', url: `/bookings/${B_FLEET}/documents/eway-bill`,
      headers: { authorization: `Bearer ${tok(U_SHIPPER, 'shipper')}` },
      payload: { ewb_number: '181234567890', generated_at: '2026-08-06T18:25:00.000Z', valid_upto: '2026-08-07T18:29:59.000Z', issuing_portal: 'NIC1' },
    })
    check('recording an e-way bill is a 503 too', r.statusCode === 503, `(got ${r.statusCode})`)

    // The additive rule: an existing flow on the same booking is untouched.
    r = await app.inject({
      method: 'GET', url: `/bookings/${B_FLEET}`,
      headers: { authorization: `Bearer ${tok(U_SHIPPER, 'shipper')}` },
    })
    check('an existing booking read is completely unaffected', r.statusCode === 200, `(got ${r.statusCode})`)

    await app.close()
  }

  console.log(`\nRESULT: ${failures.length ? 'FAIL' : 'PASS'} — ${passed} checks passed, ${failures.length} failed`)
  if (failures.length) { failures.forEach(f => console.log(`  - ${f}`)); process.exit(1) }
}

main().catch(err => { console.error(err); process.exit(1) })
