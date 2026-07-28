import { getSupabase } from './supabase.js'

// -----------------------------------------------------------
// PaymentStore — durable money records (payments + payouts, migration
// 011). Injected as a dependency so it is faked in tests. Unlike the
// best-effort breadcrumb/POD writes, money writes are HARD: a failure
// must surface (never silently "succeed"), so settle() lets store
// errors propagate. Idempotency is anchored on UNIQUE(booking_id).
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
// independently — always build this via resolvePayee().
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

export interface PaymentStore {
  getPayment(bookingId: string): Promise<PaymentRecord | null>
  insertPayment(row: PaymentRecord): Promise<void>
  getPayout(bookingId: string): Promise<PayoutRecord | null>
  /** settle path — upsert to a 'recorded' payout (on conflict booking_id). */
  upsertPayout(row: PayoutRecord): Promise<void>
  /** saga path — create a 'pending' payout only if none exists yet. */
  insertPendingPayoutIfAbsent(row: PayoutRecord): Promise<void>
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

  async getPayout(bookingId: string): Promise<PayoutRecord | null> {
    const { data, error } = await getSupabase().from('payouts').select('*').eq('booking_id', bookingId).maybeSingle()
    if (error) throw new Error(`payouts read failed: ${error.message}`)
    return (data as PayoutRecord) ?? null
  }

  async upsertPayout(row: PayoutRecord): Promise<void> {
    const { error } = await getSupabase().from('payouts').upsert(wirePayout(row), { onConflict: 'booking_id' })
    if (error) throw new Error(`payouts upsert failed: ${error.message}`)
  }

  async insertPendingPayoutIfAbsent(row: PayoutRecord): Promise<void> {
    const { error } = await getSupabase()
      .from('payouts')
      .upsert(wirePayout(row), { onConflict: 'booking_id', ignoreDuplicates: true })
    if (error) throw new Error(`payouts pending-insert failed: ${error.message}`)
  }
}

export function defaultPaymentStore(): PaymentStore {
  return new SupabasePaymentStore()
}
