// All Supabase reads/writes for the user_kyc table — upsert results, fetch current level, list pending reviews

import type { SupabaseClient } from '@supabase/supabase-js'
import { KYCLevel, type KYCRecord, type KYCResult } from './types.js'

const TABLE = 'user_kyc'

/**
 * Fetches the full KYC record for a user.
 * Returns null when the user has no row yet (i.e. KYC not started).
 *
 * TODO: query `${TABLE}` where user_id = userId, return single row or null
 */
export async function getKYCRecord(
  supabase: SupabaseClient,
  userId: string,
): Promise<KYCRecord | null> {
  // TODO: const { data, error } = await supabase.from(TABLE).select('*').eq('user_id', userId).maybeSingle()
  // TODO: if (error) throw error
  // TODO: return data as KYCRecord | null
  void supabase
  void userId
  throw new Error('getKYCRecord: not implemented')
}

/**
 * Inserts or updates a single verification result inside the verifications JSONB column.
 * Uses Postgres JSONB merge so concurrent verifications don't overwrite each other.
 *
 * TODO: upsert into TABLE with conflict on user_id
 * TODO: merge { verifications: { [type]: result } } using supabase's jsonb || operator
 * TODO: also bump updated_at = now()
 */
export async function upsertVerification(
  supabase: SupabaseClient,
  userId: string,
  type: string,
  result: KYCResult,
): Promise<void> {
  // TODO: build payload, call supabase.from(TABLE).upsert({ user_id: userId, verifications: { [type]: result } })
  void supabase
  void userId
  void type
  void result
  throw new Error('upsertVerification: not implemented')
}

/**
 * Derives the current KYC level from the stored verification results.
 * Level promotion logic lives here so routes stay thin.
 *
 * TODO: call getKYCRecord, inspect which verifications are status='success'
 * TODO: apply BharatTruck level rules (L0→L1: phone+email, L1→L2: aadhaar+pan, L2→L3: dl/rc/gst+face+bank)
 */
export async function getCurrentLevel(
  supabase: SupabaseClient,
  userId: string,
): Promise<KYCLevel> {
  // TODO: derive level from record.verifications
  void supabase
  void userId
  return KYCLevel.L0
}
