import { getSupabase } from './supabase.js'

// -----------------------------------------------------------
// PaymentStore — durable money records (payments + payouts, migration
// 011). Injected as a dependency so it is faked in tests. Unlike the
// best-effort breadcrumb/POD writes, money writes are HARD: a failure
// must surface (never silently "succeed"), so settle() lets store
// errors propagate. Idempotency is anchored on the payouts uniqueness
// constraint — UNIQUE(booking_id, payee_type) since migration 0023,
// because a fleet booking with a D-7 revenue split pays TWO parties.
// -----------------------------------------------------------

export type PaymentMode = 'cash' | 'upi' | 'direct'

// status MUST be a value the live payments_status_check allows
// (pending|captured|settled|failed|refunded). A cash settlement is terminal, so
// 'settled'. It is NOT 'recorded' — that violated the constraint and 500'd every
// settlement (payouts use a separate, laxer status vocabulary; see payment-service.ts).
export const PAYMENT_STATUS_SETTLED = 'settled' as const

export type PaymentRecord = {
  booking_id: string
  amount: number
  mode: PaymentMode
  reference: string | null
  recorded_by: string
  status: 'settled'
}

// The payout goes to WHOEVER MADE THE WINNING BID (founder Q15): a solo
// driver, or the fleet owner who bid on their fleet's behalf. Migration 016
// enforces the pairing with a CHECK (payee_type='driver' ⇒ driver_id NOT NULL,
// 'fleet_owner' ⇒ fleet_owner_id NOT NULL), so the two fields are never set
// independently — always build this via resolvePayees().
export type PayoutPayee =
  | { payee_type: 'driver'; driver_id: string; fleet_owner_id: null }
  | { payee_type: 'fleet_owner'; driver_id: null; fleet_owner_id: string }

export type PayoutRecord = PayoutPayee & {
  booking_id: string
  amount: number
  mode: PaymentMode | null
  status: 'pending' | 'recorded'
  recorded_by: string | null
}

// The conflict target every payout write arbitrates on. Named once so the
// upsert path and migration 0023 cannot drift apart silently — the whole
// no-double-payout guarantee is this string agreeing with that constraint.
const PAYOUT_CONFLICT_TARGET = 'booking_id,payee_type'

// Postgres/PostgREST codes that mean "this schema predates the column/table",
// as opposed to "the query failed". Only the former may be swallowed: a
// pre-0022 database has no revenue_share_pct and must keep behaving exactly as
// it does today (share 0 = salaried), whereas a transport or permission failure
// that we silently read as 0 would quietly pay a split driver nothing.
const SCHEMA_ABSENT_CODES = new Set(['42703', '42P01', 'PGRST204', 'PGRST205'])

export interface PaymentStore {
  getPayment(bookingId: string): Promise<PaymentRecord | null>
  insertPayment(row: PaymentRecord): Promise<void>
  /** Every payee on this booking. 0..2 rows: the bidder, plus the D-7 split driver. */
  getPayouts(bookingId: string): Promise<PayoutRecord[]>
  /** settle path — upsert to a 'recorded' payout (on conflict booking_id, payee_type). */
  upsertPayout(row: PayoutRecord): Promise<void>
  /** saga path — create a 'pending' payout only if none exists yet. */
  insertPendingPayoutIfAbsent(row: PayoutRecord): Promise<void>
  /** D-7 — the driver's cut of a fleet-won trip, 0..100. 0 (salaried) when unset. */
  getDriverRevenueSharePct(fleetOwnerId: string, driverId: string): Promise<number>
}

// wirePayout — the row as it goes over the wire to PostgREST.
//
// A DRIVER payout writes the EXACT pre-fleet column set. `payee_type` and
// `fleet_owner_id` arrive in migration 0016, and 0016 is NOT a prerequisite for a
// solo-driver settlement — which is 100% of settlements today. PostgREST rejects
// the entire write when the payload names a column the table does not have
// (PGRST204 / 42703), so sending them unconditionally would break the only
// settlement path that currently exists. `payouts.payee_type` defaults to
// 'driver' once 0016 lands, so omitting it is correct on both schemas.
//
// A FLEET payout necessarily runs on a post-0016 database — a fleet booking
// cannot exist without that migration — so it sends both columns.
//
// The D-7 split's DRIVER row rides the same branch and stays correct there:
// `payouts.payee_type` defaults to 'driver', so the omitted column arrives as
// exactly the value ON CONFLICT (booking_id, payee_type) needs to arbitrate on.
export function wirePayout(row: PayoutRecord): Record<string, unknown> {
  const { payee_type, fleet_owner_id, ...base } = row
  return payee_type === 'fleet_owner' ? { ...base, payee_type, fleet_owner_id } : base
}

export class SupabasePaymentStore implements PaymentStore {
  async getPayment(bookingId: string): Promise<PaymentRecord | null> {
    const { data, error } = await getSupabase().from('payments').select('*').eq('booking_id', bookingId).maybeSingle()
    if (error) throw new Error(`payments read failed: ${error.message}`)
    return (data as PaymentRecord) ?? null
  }

  async insertPayment(row: PaymentRecord): Promise<void> {
    const { error } = await getSupabase().from('payments').insert(row)
    if (error) throw new Error(`payments insert failed: ${error.message}`)
  }

  // NOT maybeSingle(). A split booking has two payout rows and maybeSingle()
  // fails outright (PGRST116) rather than returning either of them, so keeping
  // it would turn the first split settlement into a 500 on the read-back.
  async getPayouts(bookingId: string): Promise<PayoutRecord[]> {
    const { data, error } = await getSupabase().from('payouts').select('*').eq('booking_id', bookingId)
    if (error) throw new Error(`payouts read failed: ${error.message}`)
    return (data as PayoutRecord[]) ?? []
  }

  async upsertPayout(row: PayoutRecord): Promise<void> {
    const { error } = await getSupabase().from('payouts').upsert(wirePayout(row), { onConflict: PAYOUT_CONFLICT_TARGET })
    if (error) throw new Error(`payouts upsert failed: ${error.message}`)
  }

  async insertPendingPayoutIfAbsent(row: PayoutRecord): Promise<void> {
    const { error } = await getSupabase()
      .from('payouts')
      .upsert(wirePayout(row), { onConflict: PAYOUT_CONFLICT_TARGET, ignoreDuplicates: true })
    if (error) throw new Error(`payouts pending-insert failed: ${error.message}`)
  }

  // D-7 — the driver's share of a fleet-won trip, read off the AFFILIATION
  // (fleet_drivers), which is where the standing employment term lives; it is
  // deliberately not per-trip and not per-truck.
  //
  // Row choice matters because affiliations accumulate history: a driver holds
  // at most one live row but any number of closed ones. An 'active' row is the
  // governing agreement and wins outright. Otherwise the newest row for the
  // pair is used, which is what pays a driver who completed the trip and then
  // left the fleet before settlement — the alternative silently hands their cut
  // to the owner. 'pending'/'rejected' are excluded: an invite that was never
  // accepted agreed no terms.
  async getDriverRevenueSharePct(fleetOwnerId: string, driverId: string): Promise<number> {
    const { data, error } = await getSupabase()
      .from('fleet_drivers')
      .select('status, revenue_share_pct')
      .eq('fleet_owner_id', fleetOwnerId)
      .eq('driver_id', driverId)
      .in('status', ['active', 'suspended', 'left'])
      .order('updated_at', { ascending: false })

    if (error) {
      // A database that predates migration 0022 has no revenue_share_pct at
      // all, and on it EVERY booking is salaried — which is today's behaviour
      // and must stay reachable. Anything else is a real failure and propagates
      // (the payout write is the first write, so settle() leaves no trace and
      // the retry replays cleanly).
      if (SCHEMA_ABSENT_CODES.has((error as { code?: string }).code ?? '')) return 0
      throw new Error(`fleet_drivers read failed: ${error.message}`)
    }

    const rows = (data as Array<{ status: string; revenue_share_pct: number | null }>) ?? []
    const governing = rows.find((r) => r.status === 'active') ?? rows[0]
    const pct = Number(governing?.revenue_share_pct ?? 0)
    return Number.isFinite(pct) ? pct : 0
  }
}

export function defaultPaymentStore(): PaymentStore {
  return new SupabasePaymentStore()
}
