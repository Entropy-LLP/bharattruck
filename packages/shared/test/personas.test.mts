// Emergent-persona tests.
//
// These pin the rules that decide what a human may DO and what money they may SEE. Getting them
// wrong is either a lockout (a real operator cannot bid) or a leak (an employee sees the fleet's
// margins), so the cases the founder decisions turn on are pinned explicitly rather than left
// implied by a happy path.
//
// The cases that matter most, and why they exist:
//   - owner-driver attached to a fleet KEEPS the marketplace          (D-6 / §1.2)
//   - assetless fleet driver does NOT get a load board                (§1.2)
//   - owner-driver on a fleet booking SEES the money                  (§1.1 — this is the change)
//   - a shipper who also owns trucks reads as 'shipper' on their own load  (D-10 direct-attach)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  capabilitiesFrom,
  relationToBooking,
  seesCommercialsOnBooking,
  resolvePersonas,
  type PersonaFacts,
  type PersonaSnapshot,
} from '../src/personas.ts'

const NOBODY: PersonaFacts = {
  driver_id: null,
  fleet_owner_id: null,
  owned_vehicle_count: 0,
  held_driver_count: 0,
  affiliated_fleet_owner_ids: [],
}

const facts = (over: Partial<PersonaFacts>): PersonaFacts => ({ ...NOBODY, ...over })

// ── capability emergence ──────────────────────────────────────────────────────

test('everyone may ship — posting a load is what emerges the persona (D-5)', () => {
  assert.deepEqual(capabilitiesFrom(NOBODY), ['ship'])
})

test('a drivers row grants drive, but not carry without a truck', () => {
  const caps = capabilitiesFrom(facts({ driver_id: 'd1' }))
  assert.ok(caps.includes('drive'))
  assert.ok(!caps.includes('carry'), 'a driver with no truck must not get a load board')
})

test('one owned truck grants carry', () => {
  const caps = capabilitiesFrom(facts({ driver_id: 'd1', owned_vehicle_count: 1 }))
  assert.ok(caps.includes('carry'))
  assert.ok(!caps.includes('operate'), 'one truck alone is not a fleet')
})

test('a SECOND truck emerges the fleet — nothing was configured', () => {
  const one = capabilitiesFrom(facts({ driver_id: 'd1', owned_vehicle_count: 1 }))
  const two = capabilitiesFrom(facts({ driver_id: 'd1', owned_vehicle_count: 2 }))
  assert.ok(!one.includes('operate'))
  assert.ok(two.includes('operate'), 'buying a truck is the only action required')
})

test('holding a driver emerges the fleet even on one truck (attached-vehicle model)', () => {
  const caps = capabilitiesFrom(facts({ fleet_owner_id: 'f1', owned_vehicle_count: 1, held_driver_count: 1 }))
  assert.ok(caps.includes('operate'), 'managing people is running a fleet even if the truck is theirs')
})

test('a fleet owner who holds drivers but owns no truck still operates', () => {
  const caps = capabilitiesFrom(facts({ fleet_owner_id: 'f1', held_driver_count: 3 }))
  assert.ok(caps.includes('operate'))
  assert.ok(!caps.includes('carry'), 'owning no asset means no self-selected work')
})

// ── the rule that changes behaviour ───────────────────────────────────────────

test('OWNER-DRIVER attached to a fleet keeps the marketplace (D-6)', () => {
  // Affiliation ADDS a source of work; it does not replace self-selection. This is the case the
  // old is_fleet_affiliated split got wrong — it hid the load board from anyone with a fleet tie.
  const caps = capabilitiesFrom(
    facts({ driver_id: 'd1', owned_vehicle_count: 1, affiliated_fleet_owner_ids: ['f1'] }),
  )
  assert.ok(caps.includes('carry'), 'owning a truck grants carry regardless of affiliation')
  assert.ok(caps.includes('drive'))
})

test('ASSETLESS fleet driver gets no marketplace — their owner bids for them', () => {
  const caps = capabilitiesFrom(facts({ driver_id: 'd2', affiliated_fleet_owner_ids: ['f1'] }))
  assert.ok(!caps.includes('carry'))
  assert.ok(caps.includes('drive'))
})

test('multi-fleet affiliation is allowed and does not change capability (D-8)', () => {
  const caps = capabilitiesFrom(facts({ driver_id: 'd3', affiliated_fleet_owner_ids: ['f1', 'f2'] }))
  assert.deepEqual(caps.sort(), ['drive', 'ship'])
})

// ── relation to a booking: the "one app, no mode switch" primitive ────────────

const snapshot = (over: Partial<PersonaSnapshot>): PersonaSnapshot => ({
  user_id: 'u1',
  primary_persona: 'driver',
  capabilities: ['ship'],
  driver_id: null,
  fleet_owner_id: null,
  owned_vehicle_count: 0,
  held_driver_count: 0,
  affiliated_fleet_owner_ids: [],
  sees_commercials: false,
  ...over,
})

test('the person who posted the load reads as shipper', () => {
  const rel = relationToBooking({ shipper_id: 'u1' }, snapshot({ user_id: 'u1' }))
  assert.equal(rel, 'shipper')
})

test('direct-attach: shipper wins over carrier on your OWN load (D-10)', () => {
  // The distributor case. They posted it AND their fleet is running it. Whoever is paying sees
  // the paying side — that is the relation with the stronger claim on the screen.
  const rel = relationToBooking(
    { shipper_id: 'u1', fleet_owner_id: 'f1' },
    snapshot({ user_id: 'u1', fleet_owner_id: 'f1' }),
  )
  assert.equal(rel, 'shipper')
})

test('a SOLO driver on their own won booking is the carrier, not staff', () => {
  const rel = relationToBooking(
    { shipper_id: 'someone-else', driver_id: 'd1', fleet_owner_id: null },
    snapshot({ user_id: 'u2', driver_id: 'd1' }),
  )
  assert.equal(rel, 'carrier', 'they bid, they won, they carry the economics')
})

test('a driver on a FLEET-owned booking is staff', () => {
  const rel = relationToBooking(
    { shipper_id: 'someone-else', driver_id: 'd1', fleet_owner_id: 'f9' },
    snapshot({ user_id: 'u2', driver_id: 'd1' }),
  )
  assert.equal(rel, 'driver')
})

test('an unrelated human is an observer', () => {
  const rel = relationToBooking({ shipper_id: 'x', driver_id: 'y' }, snapshot({ user_id: 'z' }))
  assert.equal(rel, 'observer')
})

// ── commercial visibility follows OWNERSHIP, not affiliation (§1.1) ───────────

test('shipper sees their own freight', () => {
  assert.ok(seesCommercialsOnBooking({ shipper_id: 'u1' }, snapshot({ user_id: 'u1' }), false))
})

test('assetless fleet driver is MASKED on a fleet booking (unchanged)', () => {
  const sees = seesCommercialsOnBooking(
    { shipper_id: 's', driver_id: 'd1', fleet_owner_id: 'f9' },
    snapshot({ user_id: 'u2', driver_id: 'd1' }),
    false, // does not own the truck
  )
  assert.equal(sees, false, 'an employee does not see the fleet margin')
})

test('OWNER-DRIVER on a fleet booking SEES the money — this is the behaviour change (§1.1)', () => {
  const sees = seesCommercialsOnBooking(
    { shipper_id: 's', driver_id: 'd1', fleet_owner_id: 'f9', vehicle_id: 'v1' },
    snapshot({ user_id: 'u2', driver_id: 'd1', owned_vehicle_count: 1 }),
    true, // it is THEIR truck under the fleet's booking
  )
  assert.equal(sees, true, 'they carry the cost and the risk, so they are a stakeholder')
})

test('owning SOME truck does not unmask a booking run on someone else\'s', () => {
  const sees = seesCommercialsOnBooking(
    { shipper_id: 's', driver_id: 'd1', fleet_owner_id: 'f9', vehicle_id: 'v-other' },
    snapshot({ user_id: 'u2', driver_id: 'd1', owned_vehicle_count: 4 }),
    false, // this particular trip is on the fleet's truck
  )
  assert.equal(sees, false, 'visibility is per-asset, not a global flag')
})

test('an observer never sees freight', () => {
  assert.equal(seesCommercialsOnBooking({ shipper_id: 'x' }, snapshot({ user_id: 'z' }), true), false)
})

// ── resolvePersonas against a PostgREST double ───────────────────────────────

/**
 * Minimal PostgREST double. Only the chain shapes resolvePersonas actually builds are modelled;
 * an unexpected table throws loudly rather than quietly returning undefined and passing a test
 * for the wrong reason.
 */
function makeSupabase(rows: {
  drivers?: { id: string; user_id: string }[]
  fleet_owners?: { id: string; user_id: string }[]
  vehicles?: { id: string; driver_id?: string | null; fleet_owner_id?: string | null }[]
  fleet_drivers?: { id: string; driver_id: string; fleet_owner_id: string; status: string }[]
}) {
  const tables: Record<string, Record<string, unknown>[]> = {
    drivers: rows.drivers ?? [],
    fleet_owners: rows.fleet_owners ?? [],
    vehicles: rows.vehicles ?? [],
    fleet_drivers: rows.fleet_drivers ?? [],
  }

  function from(table: string) {
    if (!(table in tables)) throw new Error(`unexpected table in query: ${table}`)
    let rowset = tables[table]
    let headMode = false
    const builder: any = {
      select: (_cols?: string, opts?: { head?: boolean }) => {
        if (opts?.head) headMode = true
        return builder
      },
      eq: (col: string, val: unknown) => {
        rowset = rowset.filter(r => r[col] === val)
        return builder
      },
      in: (col: string, vals: unknown[]) => {
        rowset = rowset.filter(r => vals.includes(r[col] as string))
        return builder
      },
      maybeSingle: () => Promise.resolve({ data: rowset[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(
          headMode
            ? { data: null, count: rowset.length, error: null }
            : { data: rowset, count: rowset.length, error: null },
        ).then(resolve),
    }
    return builder
  }
  return { from } as never
}

test('resolvePersonas: solo owner-driver', async () => {
  const db = makeSupabase({
    drivers: [{ id: 'd1', user_id: 'u1' }],
    vehicles: [{ id: 'v1', driver_id: 'd1' }],
  })
  const snap = await resolvePersonas(db, 'u1', 'driver')
  assert.equal(snap.driver_id, 'd1')
  assert.equal(snap.owned_vehicle_count, 1)
  assert.ok(snap.capabilities.includes('carry'))
  assert.equal(snap.sees_commercials, true)
})

test('resolvePersonas: the distributor — ships AND runs a fleet', async () => {
  const db = makeSupabase({
    fleet_owners: [{ id: 'f1', user_id: 'u9' }],
    vehicles: [
      { id: 'v1', fleet_owner_id: 'f1' },
      { id: 'v2', fleet_owner_id: 'f1' },
    ],
    fleet_drivers: [{ id: 'fd1', driver_id: 'd7', fleet_owner_id: 'f1', status: 'active' }],
  })
  const snap = await resolvePersonas(db, 'u9', 'shipper')
  assert.equal(snap.fleet_owner_id, 'f1')
  assert.equal(snap.owned_vehicle_count, 2)
  assert.equal(snap.held_driver_count, 1)
  assert.deepEqual(snap.capabilities.sort(), ['carry', 'operate', 'ship'])
  assert.equal(snap.primary_persona, 'shipper', 'primary decides where emailed links land, nothing else')
})

test('resolvePersonas: assetless fleet driver, affiliated to two fleets', async () => {
  const db = makeSupabase({
    drivers: [{ id: 'd5', user_id: 'u5' }],
    fleet_drivers: [
      { id: 'fd1', driver_id: 'd5', fleet_owner_id: 'f1', status: 'active' },
      { id: 'fd2', driver_id: 'd5', fleet_owner_id: 'f2', status: 'pending' },
      { id: 'fd3', driver_id: 'd5', fleet_owner_id: 'f3', status: 'left' },
    ],
  })
  const snap = await resolvePersonas(db, 'u5', 'driver')
  assert.deepEqual(snap.affiliated_fleet_owner_ids.sort(), ['f1', 'f2'], 'left affiliations are not live')
  assert.ok(!snap.capabilities.includes('carry'))
  assert.equal(snap.sees_commercials, false)
})

test('resolvePersonas: a brand-new user can still ship', async () => {
  const snap = await resolvePersonas(makeSupabase({}), 'u-new', 'shipper')
  assert.deepEqual(snap.capabilities, ['ship'])
  assert.equal(snap.driver_id, null)
  assert.equal(snap.fleet_owner_id, null)
})
