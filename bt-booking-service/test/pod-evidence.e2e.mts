/**
 * feat/pod-rebuild — POD evidence hardening (migration 0025), the 0025-APPLIED side.
 *
 * The companion to pod.e2e.mts: that file pins "on a database WITHOUT 0025 the email-OTP
 * POD behaves exactly as today"; THIS file pins every new control on a database WHERE
 * 0025 is live. It exercises the REAL routes via app.inject() with an in-memory fake
 * Supabase that models the 0025 tables + the 0019 geofence tables, including the two
 * unique constraints that make resubmits idempotent.
 *
 * Each block pins a DECISION and the failure mode it prevents (§ = INDIA_FREIGHT_COMPLIANCE.md):
 *   1. camera-only, on-device hash stored-not-recomputed, server time authoritative (§5.4)
 *   2. geofence-gated OTP — block 40 km out, degrade on no signal (§5.5, D-14)
 *   3. structured discrepancy — server-held expected, dual ack, claim clocks (§5.7)
 *   4. delivery_asserted vs completed; confirmed vs asserted strength (§6.3)
 *
 * Run: npx tsx test/pod-evidence.e2e.mts
 */
process.env.JWT_SECRET = 'test-jwt-secret-long-enough-for-hs256-verification'
process.env.INTERNAL_SERVICE_SECRET = 'internal-secret-for-tests'
process.env.SUPABASE_URL = 'http://fake.local'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key'
delete process.env.PAYMENT_SERVICE_URL   // payout emit skips silently
delete process.env.POD_EVIDENCE_GCS_BUCKET // storage inert by default (toggled below)

import Fastify from 'fastify'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'

const B1 = '11111111-1111-4111-8111-111111111111'
const U_DRIVER = '22222222-2222-4222-8222-222222222222'
const D1 = '33333333-3333-4333-8333-333333333333'
const U_OTHER = '44444444-4444-4444-8444-444444444444'
const D2 = '55555555-5555-4555-8555-555555555555'
const S1 = '66666666-6666-4666-8666-666666666666'
const U_ADMIN = '77777777-7777-4777-8777-777777777777'

// Mumbai drop; a fix 0.001° north is ~111 m (inside), 0.012° is ~1.3 km (near band),
// 0.4° is ~44 km (clearly gone — the 40 km hole).
const DEST_LAT = 19.0
const DEST_LNG = 72.8
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)

type Row = Record<string, any>
let store: Record<string, Row[]>

function seed(bookingOverrides: Row = {}) {
  store = {
    bookings: [{
      id: B1, driver_id: D1, shipper_id: S1, status: 'in_transit', receiver_email: 'consignee@acme.co.in',
      source_address: 'Delhi', destination_address: 'Mumbai', dest_lat: DEST_LAT, dest_lng: DEST_LNG,
      source_lat: 28.6, source_lng: 77.2, load_type: 'general', weight_kg: 1000,
      quoted_price: 50000, final_price: null, fleet_owner_id: null,
      pod_expected_quantity: null, pod_quantity_unit: null,
      created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z',
      ...bookingOverrides,
    }],
    drivers: [{ id: D1, user_id: U_DRIVER, truck_number: 'DL01 1234' }, { id: D2, user_id: U_OTHER }],
    users: [{ id: S1, email: 'shipper@acme.co.in', full_name: 'Shipper' }],
    pod_evidence: [],
    pod_state: [],
    pod_discrepancies: [],
    pod_audit_log: [],
    geofence_events: [],
    trip_telemetry: [],
    notification_outbox: [],
    notification_preferences: [],
  }
}

// Table defaults applied on insert so the returned row carries the DB-default columns
// the service reads back (captured_at_server, storage_status, driver_ack_at, ...).
const INSERT_DEFAULTS: Record<string, () => Row> = {
  pod_evidence: () => ({ id: randomUUID(), captured_at_server: new Date().toISOString(), sha256_received: null, storage_status: 'pending', original_bytes_uri: null, created_at: new Date().toISOString() }),
  pod_discrepancies: () => ({ id: randomUUID(), driver_ack_at: new Date().toISOString(), consignee_ack_at: null, consignee_ack_via: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  pod_audit_log: () => ({ id: randomUUID(), occurred_at: new Date().toISOString() }),
}

// Unique constraints from migration 0025 — the idempotency anchors.
function uniqueViolation(table: string, payload: Row): boolean {
  const rows = store[table] ?? []
  if (table === 'pod_evidence') return rows.some(r => r.booking_id === payload.booking_id && r.sha256_original === payload.sha256_original)
  if (table === 'pod_discrepancies') return rows.some(r => r.booking_id === payload.booking_id)
  return false
}

class FakeQuery {
  private filters: Array<['eq' | 'in' | 'is', string, any]> = []
  private mode: 'select' | 'update' | 'insert' | 'upsert' = 'select'
  private payload: Row | null = null
  private conflict: string | null = null
  constructor(private table: string) {}
  select() { return this }
  insert(p: Row) { this.mode = 'insert'; this.payload = p; return this }
  upsert(p: Row, opts?: { onConflict?: string }) { this.mode = 'upsert'; this.payload = p; this.conflict = opts?.onConflict ?? 'id'; return this }
  update(p: Row) { this.mode = 'update'; this.payload = p; return this }
  eq(c: string, v: any) { this.filters.push(['eq', c, v]); return this }
  in(c: string, v: any[]) { this.filters.push(['in', c, v]); return this }
  is(c: string, v: any) { this.filters.push(['is', c, v]); return this }
  limit() { return this }
  order() { return this }
  private match(r: Row) {
    return this.filters.every(([o, c, v]) =>
      o === 'eq' ? r[c] === v : o === 'in' ? v.includes(r[c]) : (r[c] ?? null) === v)
  }
  private run() {
    const rows = store[this.table] ?? (store[this.table] = [])
    if (this.mode === 'insert') {
      if (uniqueViolation(this.table, this.payload as Row)) return { data: null, error: { code: '23505', message: 'duplicate key' } }
      const row = { ...(INSERT_DEFAULTS[this.table]?.() ?? { id: randomUUID() }), ...this.payload }
      rows.push(row)
      return { data: [row], error: null }
    }
    if (this.mode === 'upsert') {
      const key = this.conflict ?? 'id'
      const existing = rows.find(r => r[key] === (this.payload as Row)[key])
      if (existing) { Object.assign(existing, this.payload); return { data: [existing], error: null } }
      const row = { ...(INSERT_DEFAULTS[this.table]?.() ?? {}), ...this.payload }
      rows.push(row)
      return { data: [row], error: null }
    }
    if (this.mode === 'update') { const hit = rows.filter(r => this.match(r)); hit.forEach(r => Object.assign(r, this.payload)); return { data: hit, error: null } }
    return { data: rows.filter(r => this.match(r)), error: null }
  }
  maybeSingle() { const { data, error } = this.run(); return Promise.resolve({ data: data?.length ? data[0] : null, error }) }
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
const SECRET = process.env.INTERNAL_SERVICE_SECRET!

async function main() {
  const { __setSupabaseClientForTests } = await import('../src/lib/supabase.js')
  __setSupabaseClientForTests(fakeSupabase as any)
  const authPlugin = (await import('../src/plugins/auth.js')).default
  const internalAuthPlugin = (await import('../src/plugins/internal-auth.js')).default
  const { bookingRoutes } = await import('../src/routes/bookings.js')
  const { internalRoutes } = await import('../src/routes/internal.js')
  const { opsRoutes } = await import('../src/routes/ops.js')

  const app = Fastify({ logger: false })
  await app.register(async (a) => { await a.register(authPlugin); await a.register(bookingRoutes, { prefix: '/bookings' }) })
  await app.register(async (a) => { await a.register(authPlugin); await a.register(opsRoutes, { prefix: '/bookings', auditStore: { async record() {} } }) })
  await app.register(async (a) => { await a.register(internalAuthPlugin); await a.register(internalRoutes, { prefix: '/internal' }) })
  await app.ready()

  const driverHdr = { authorization: `Bearer ${tok(U_DRIVER, 'driver')}` }
  const capture = (body: any, hdr = driverHdr) => app.inject({ method: 'POST', url: `/bookings/${B1}/pod-evidence`, headers: hdr, payload: body })
  const podCtx = (hdr = driverHdr) => app.inject({ method: 'GET', url: `/bookings/${B1}/pod-context`, headers: hdr })
  const discrepancy = (body: any, hdr = driverHdr) => app.inject({ method: 'POST', url: `/bookings/${B1}/discrepancy`, headers: hdr, payload: body })
  const assertDel = (body: any, hdr = driverHdr) => app.inject({ method: 'POST', url: `/bookings/${B1}/assert-delivery`, headers: hdr, payload: body })
  const validCapture = { sha256_original: SHA_A, capture_method: 'camera', lat: DEST_LAT + 0.001, lng: DEST_LNG }

  // ═══ DECISION 1 — EVIDENCE CAPTURE (§5.4) ═══════════════════════════════════
  console.log('\n── evidence capture: camera-only, on-device hash, server time')
  seed()

  // Camera-only. A gallery import is refused before it can reach storage — the schema's
  // z.literal('camera') is the API half of the DB CHECK, so the fraud vector is closed twice.
  let r = await capture({ sha256_original: SHA_A, capture_method: 'gallery', lat: DEST_LAT, lng: DEST_LNG })
  check('DECISION-1 gallery import refused 400', r.statusCode === 400, `(got ${r.statusCode})`)
  check('nothing stored on the refused gallery import', store.pod_evidence.length === 0)

  r = await capture(validCapture)
  check('camera capture 201', r.statusCode === 201, `(got ${r.statusCode}) ${r.body.slice(0, 160)}`)
  const evId = r.json().data?.evidence_id
  check('one evidence row written', store.pod_evidence.length === 1)
  const evRow = store.pod_evidence[0]
  check('capture_method persisted as camera', evRow.capture_method === 'camera')

  // On-device hash STORED, NOT RECOMPUTED: the row carries exactly the hex the app sent,
  // and sha256_received (the server re-hash) stays null until the WORM store is wired.
  check('DECISION-1 on-device sha256 stored verbatim', evRow.sha256_original === SHA_A, evRow.sha256_original)
  check('server did NOT recompute a hash (sha256_received null)', evRow.sha256_received === null)

  // Server time authoritative; device time a claim; skew recorded and signed.
  r = await capture({ sha256_original: SHA_B, capture_method: 'camera', lat: DEST_LAT, lng: DEST_LNG, captured_at_device: '2026-08-06T00:00:00.000Z' })
  const skewRow = store.pod_evidence.find(e => e.sha256_original === SHA_B)!
  check('DECISION-1 captured_at_server stamped by server', typeof skewRow.captured_at_server === 'string')
  check('clock_skew_seconds computed from device-vs-server gap', typeof skewRow.clock_skew_seconds === 'number' && skewRow.clock_skew_seconds !== 0, String(skewRow.clock_skew_seconds))

  // GPS provenance + geofence against the delivery address (Rule 46(o)).
  check('geofence_result inside near the drop', evRow.geofence_result === 'inside', evRow.geofence_result)
  r = await capture({ sha256_original: 'c'.repeat(64), capture_method: 'camera', lat: DEST_LAT + 0.4, lng: DEST_LNG })
  check('geofence_result outside far from the drop', store.pod_evidence.find(e => e.geofence_result === 'outside') !== undefined)
  r = await capture({ sha256_original: 'd'.repeat(64), capture_method: 'camera', lat: DEST_LAT, lng: DEST_LNG, mock_location_detected: true })
  check('mock_location_detected recorded (not silently dropped)', store.pod_evidence.some(e => e.mock_location_detected === true))

  // Bad hash refused.
  r = await capture({ sha256_original: 'not-a-hash', capture_method: 'camera' })
  check('a non-hex sha256 is refused 400', r.statusCode === 400, `(got ${r.statusCode})`)

  // Append-only audit log carries the capture.
  check('DECISION-1 audit log has an evidence_captured entry', store.pod_audit_log.some(a => a.action === 'evidence_captured' && a.evidence_id === evId))

  console.log('\n── evidence capture: idempotent resubmit, assigned-driver-only')
  seed()
  r = await capture(validCapture)
  check('first capture 201 created', r.statusCode === 201 && r.json().data?.created === true)
  const firstId = r.json().data?.evidence_id
  r = await capture(validCapture)
  check('DECISION resubmit same (booking,hash) is a no-op 200', r.statusCode === 200 && r.json().data?.created === false, `(got ${r.statusCode})`)
  check('and returns the SAME evidence row', r.json().data?.evidence_id === firstId)
  check('no duplicate row written', store.pod_evidence.length === 1)

  r = await capture(validCapture, { authorization: `Bearer ${tok(U_OTHER, 'driver')}` })
  check('a non-assigned driver cannot capture 403', r.statusCode === 403, `(got ${r.statusCode})`)
  r = await capture(validCapture, { authorization: `Bearer ${tok(S1, 'shipper')}` })
  check('a shipper cannot capture 403', r.statusCode === 403, `(got ${r.statusCode})`)

  console.log('\n── evidence storage: inert vs live (never re-encode)')
  seed()
  delete process.env.POD_EVIDENCE_GCS_BUCKET
  r = await capture(validCapture)
  check('storage inert → status no_op', r.json().data?.storage_status === 'no_op', r.json().data?.storage_status)
  check('and no original_bytes_uri recorded while inert', store.pod_evidence[0].original_bytes_uri === null)
  seed()
  process.env.POD_EVIDENCE_GCS_BUCKET = 'bt-pod-worm'
  r = await capture(validCapture)
  check('storage live → status stored', r.json().data?.storage_status === 'stored', r.json().data?.storage_status)
  check('and a gs:// WORM uri recorded (bytes never touched by this service)', String(store.pod_evidence[0].original_bytes_uri).startsWith('gs://bt-pod-worm/pod/'))
  delete process.env.POD_EVIDENCE_GCS_BUCKET

  // ═══ DECISION 2 — GEOFENCE-GATED OTP (§5.5, D-14) ═══════════════════════════
  console.log('\n── geofence-gated OTP: pass / block / degrade')

  // Live telemetry at the drop → PASS, corroborated (strong).
  seed()
  store.trip_telemetry.push({ booking_id: B1, last_lat: DEST_LAT + 0.001, last_lng: DEST_LNG, last_fix_at: '2026-08-06T10:00:00Z' })
  r = await podCtx()
  check('DECISION-2 at-drop telemetry → pod-context 200', r.statusCode === 200, `(got ${r.statusCode})`)
  check('geofence gated=true, verdict inside', r.json().data?.geofence?.gated === true && r.json().data?.geofence?.verdict === 'inside', JSON.stringify(r.json().data?.geofence))
  check('an otp_gate_pass audit line was written', store.pod_audit_log.some(a => a.action === 'otp_gate_pass'))

  // Live telemetry 40 km out → BLOCK. This is the "driver phones ahead" hole.
  seed()
  store.trip_telemetry.push({ booking_id: B1, last_lat: DEST_LAT + 0.4, last_lng: DEST_LNG, last_fix_at: '2026-08-06T10:00:00Z' })
  r = await podCtx()
  check('DECISION-2 40km-out telemetry → OTP BLOCKED 409', r.statusCode === 409, `(got ${r.statusCode})`)
  check('and an otp_gate_block audit line was written', store.pod_audit_log.some(a => a.action === 'otp_gate_block'))

  // Near band + a drop-enter event → PASS (dock-scale GPS drift, corroborated).
  seed()
  store.trip_telemetry.push({ booking_id: B1, last_lat: DEST_LAT + 0.012, last_lng: DEST_LNG, last_fix_at: '2026-08-06T10:00:00Z' })
  store.geofence_events.push({ id: randomUUID(), booking_id: B1, kind: 'drop', event: 'enter', lat: DEST_LAT, lng: DEST_LNG, occurred_at: '2026-08-06T09:00:00Z' })
  r = await podCtx()
  check('DECISION-2 near-band + drop-enter event → pass 200', r.statusCode === 200 && r.json().data?.geofence?.gated === true, `(got ${r.statusCode})`)

  // Near band with NO corroborating enter event → BLOCK.
  seed()
  store.trip_telemetry.push({ booking_id: B1, last_lat: DEST_LAT + 0.012, last_lng: DEST_LNG, last_fix_at: '2026-08-06T10:00:00Z' })
  r = await podCtx()
  check('near-band WITHOUT a drop-enter event → block 409', r.statusCode === 409, `(got ${r.statusCode})`)

  // No live fix but a recorded drop-enter → PASS (arrived; no live fix to lean on).
  seed()
  store.geofence_events.push({ id: randomUUID(), booking_id: B1, kind: 'drop', event: 'enter', lat: DEST_LAT, lng: DEST_LNG, occurred_at: '2026-08-06T09:00:00Z' })
  r = await podCtx()
  check('no telemetry but a drop-enter on record → pass 200', r.statusCode === 200 && r.json().data?.geofence?.source === 'geofence_event', JSON.stringify(r.json().data?.geofence))

  // No signal at all → DEGRADE, not a hard block (a legitimate delivery where tracking
  // never ran must still be able to close).
  seed()
  r = await podCtx()
  check('DECISION-2 no geofence signal → DEGRADE, not blocked (200)', r.statusCode === 200, `(got ${r.statusCode})`)
  check('geofence gated=false, verdict unknown (documented weaker path)', r.json().data?.geofence?.gated === false && r.json().data?.geofence?.verdict === 'unknown', JSON.stringify(r.json().data?.geofence))
  check('and an otp_gate_degraded audit line was written', store.pod_audit_log.some(a => a.action === 'otp_gate_degraded'))

  // ═══ DECISION 3 — STRUCTURED DISCREPANCY (§5.7) ═════════════════════════════
  console.log('\n── discrepancy: server-held expected, driver cannot edit it')
  seed({ pod_expected_quantity: 100, pod_quantity_unit: 'boxes' })
  const capRes = await capture(validCapture)
  const capId = capRes.json().data?.evidence_id

  // A client-sent expected_quantity is REFUSED — the driver cannot supply the baseline.
  r = await discrepancy({ actual_quantity: 90, reason: 'shortage', expected_quantity: 90, evidence_id: capId })
  check('DECISION-3 driver-supplied expected_quantity refused 400', r.statusCode === 400, `(got ${r.statusCode})`)
  check('nothing logged on the refused attempt', store.pod_discrepancies.length === 0)

  r = await discrepancy({ actual_quantity: 90, reason: 'shortage', evidence_id: capId })
  check('discrepancy logged 201', r.statusCode === 201, `(got ${r.statusCode}) ${r.body.slice(0, 160)}`)
  check('DECISION-3 expected is the SERVER-HELD 100, not anything the driver sent', r.json().data?.expected_quantity === 100, String(r.json().data?.expected_quantity))
  check('delta computed server-side (90 - 100 = -10)', r.json().data?.delta === -10, String(r.json().data?.delta))
  check('driver is on record (driver_ack_at set)', typeof r.json().data?.driver_ack_at === 'string')
  check('consignee has NOT yet acknowledged', r.json().data?.consignee_ack_at === null)

  console.log('\n── discrepancy: mandatory photo, typed reason, claim clocks')
  seed({ pod_expected_quantity: 100 })
  // Non-zero delta with no photo → refused.
  r = await discrepancy({ actual_quantity: 80, reason: 'shortage' })
  check('DECISION-3 non-zero delta without a photo refused 400', r.statusCode === 400, `(got ${r.statusCode})`)
  // Invalid typed reason → refused.
  r = await discrepancy({ actual_quantity: 80, reason: 'stolen' })
  check('an untyped reason is refused 400', r.statusCode === 400, `(got ${r.statusCode})`)
  // With a valid captured photo → accepted, and the claim clocks are surfaced.
  const cap2 = await capture(validCapture)
  r = await discrepancy({ actual_quantity: 80, reason: 'damage', evidence_id: cap2.json().data?.evidence_id })
  check('discrepancy with a photo 201', r.statusCode === 201, `(got ${r.statusCode})`)
  const clocks = r.json().data?.claim_clocks
  const days = (a: string, b: string) => Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000)
  check('DECISION-3 180-day pre-suit clock runs from BOOKING date', clocks && days(clocks.claim_notice_deadline, clocks.booking_date) === 180, JSON.stringify(clocks))
  check('7-day insurance clock runs from DELIVERY date', clocks && days(clocks.insurance_intimation_deadline, clocks.delivery_date) === 7, JSON.stringify(clocks))
  check('booking-date anchor is the booking created_at (2026-08-01)', clocks?.booking_date?.startsWith('2026-08-01'))
  // Idempotent resubmit.
  const before = store.pod_discrepancies.length
  r = await discrepancy({ actual_quantity: 80, reason: 'damage', evidence_id: cap2.json().data?.evidence_id })
  check('DECISION resubmit discrepancy is idempotent (no second row)', store.pod_discrepancies.length === before && r.json().data?.created === false, `(len ${store.pod_discrepancies.length})`)

  console.log('\n── expected-quantity: shipper/ops set it, the DRIVER never can')
  seed()
  const setQty = (hdr: any) => app.inject({ method: 'PATCH', url: `/bookings/${B1}/expected-quantity`, headers: hdr, payload: { expected_quantity: 100, unit: 'boxes' } })
  r = await setQty(driverHdr)
  check('DECISION-3 driver cannot set expected quantity 403', r.statusCode === 403, `(got ${r.statusCode})`)
  check('booking untouched by the driver attempt', store.bookings[0].pod_expected_quantity === null)
  r = await setQty({ authorization: `Bearer ${tok(S1, 'shipper')}` })
  check('owning shipper sets expected quantity 200', r.statusCode === 200, `(got ${r.statusCode})`)
  check('persisted server-side', store.bookings[0].pod_expected_quantity === 100)
  r = await setQty({ authorization: `Bearer ${tok(U_ADMIN, 'admin')}` })
  check('ops can set it too 200', r.statusCode === 200, `(got ${r.statusCode})`)

  // ═══ DECISION 4 — delivery_asserted vs completed; confirmed vs asserted ══════
  console.log('\n── assert-delivery: evidence required, → delivery_asserted (NOT completed)')
  seed()
  // Cannot assert with nothing captured.
  r = await assertDel({ assert_reason: 'no_smartphone' })
  check('DECISION-4 assert with no evidence refused 400', r.statusCode === 400, `(got ${r.statusCode})`)
  check('and the trip is still in_transit', store.bookings[0].status === 'in_transit')

  await capture(validCapture)
  r = await assertDel({ assert_reason: 'no_smartphone' })
  check('assert-delivery after capture 201', r.statusCode === 201, `(got ${r.statusCode}) ${r.body.slice(0, 160)}`)
  check('DECISION-4 trip → delivery_asserted, NOT completed', store.bookings[0].status === 'delivery_asserted', store.bookings[0].status)
  check('pod_strength recorded as asserted', store.pod_state.find(s => s.booking_id === B1)?.pod_strength === 'asserted')
  check('and a delivery_asserted audit line was written', store.pod_audit_log.some(a => a.action === 'delivery_asserted'))
  // Idempotent re-assert.
  r = await assertDel({ assert_reason: 'no_smartphone' })
  check('DECISION re-asserting is an idempotent no-op', r.statusCode === 200 && r.json().data?.created === false, `(got ${r.statusCode})`)
  check('still exactly one pod_state row', store.pod_state.filter(s => s.booking_id === B1).length === 1)

  console.log('\n── ops closes an asserted delivery; strength stays asserted (never upgraded)')
  r = await app.inject({ method: 'POST', url: `/bookings/${B1}/force-complete`, headers: { authorization: `Bearer ${tok(U_ADMIN, 'admin')}` } })
  check('ops force-completes the asserted trip 200', r.statusCode === 200 && store.bookings[0].status === 'completed', `(got ${r.statusCode}/${store.bookings[0].status})`)
  check('DECISION-4 pod_strength STAYS asserted after ops close (not silently upgraded)', store.pod_state.find(s => s.booking_id === B1)?.pod_strength === 'asserted')
  check('and the ops close is stamped', typeof store.pod_state.find(s => s.booking_id === B1)?.closed_by_ops_at === 'string')

  console.log('\n── confirmed tier: receiver OTP → pod_strength confirmed + dual ack')
  seed({ pod_expected_quantity: 100 })
  const cap3 = await capture(validCapture)
  await discrepancy({ actual_quantity: 95, reason: 'shortage', evidence_id: cap3.json().data?.evidence_id })
  check('a discrepancy sits with only the driver ack', store.pod_discrepancies[0].consignee_ack_at === null)
  // The receiver-OTP path closes the trip (zero app install — the mainstream path).
  r = await app.inject({ method: 'POST', url: `/internal/bookings/${B1}/complete-pod`, headers: { 'x-internal-secret': SECRET } })
  check('DECISION-4 receiver-OTP complete-pod 200', r.statusCode === 200 && store.bookings[0].status === 'completed', `(got ${r.statusCode})`)
  check('pod_strength recorded as confirmed', store.pod_state.find(s => s.booking_id === B1)?.pod_strength === 'confirmed')
  check('DECISION-3 dual ack completed — consignee_ack stamped by the OTP', store.pod_discrepancies[0].consignee_ack_at !== null)
  check('confirmed and asserted are distinguishable strengths', store.pod_state.find(s => s.booking_id === B1)?.pod_strength === 'confirmed')

  await app.close()
  console.log(`\n${failures.length ? 'RESULT: FAIL' : 'RESULT: PASS'} — ${passed} checks passed, ${failures.length} failed`)
  if (failures.length) { failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1) }
}
main().catch(err => { console.error(err); process.exit(1) })
