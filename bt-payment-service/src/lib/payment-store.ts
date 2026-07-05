import { getSupabase } from './supabase.js'

// -----------------------------------------------------------
// PaymentStore — durable money records (payments + payouts, migration
// 011). Injected as a dependency so it is faked in tests. Unlike the
// best-effort breadcrumb/POD writes, money writes are HARD: a failure
// must surface (never silently "succeed"), so settle() lets store
// errors propagate. Idempotency is anchored on UNIQUE(booking_id).
// -----------------------------------------------------------

export type PaymentMode = 'cash' | 'upi' | 'direct'

export type PaymentRecord = {
  booking_id: string
  amount: number
  mode: PaymentMode
  reference: string | null
  recorded_by: string
  status: 'recorded'
}

export type PayoutRecord = {
  booking_id: string
  driver_id: string | null
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
    const { error } = await getSupabase().from('payouts').upsert(row, { onConflict: 'booking_id' })
    if (error) throw new Error(`payouts upsert failed: ${error.message}`)
  }

  async insertPendingPayoutIfAbsent(row: PayoutRecord): Promise<void> {
    const { error } = await getSupabase().from('payouts').upsert(row, { onConflict: 'booking_id', ignoreDuplicates: true })
    if (error) throw new Error(`payouts pending-insert failed: ${error.message}`)
  }
}

export function defaultPaymentStore(): PaymentStore {
  return new SupabasePaymentStore()
}
