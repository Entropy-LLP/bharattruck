// Duplicate detection via SHA-256 hashes of PII fields and fuzzy name matching to catch identity reuse across accounts

import type { SupabaseClient } from '@supabase/supabase-js'

const TABLE = 'user_kyc'

/**
 * Returns true if the given Aadhaar hash already exists on a different user's record.
 * Prevents the same Aadhaar from being linked to multiple accounts.
 *
 * TODO: query TABLE where verifications->>'aadhaar_hash' = hash AND user_id != caller's userId
 * TODO: return count > 0
 */
export async function checkDuplicateAadhaar(
  supabase: SupabaseClient,
  hash: string,
  excludeUserId: string,
): Promise<boolean> {
  void supabase
  void hash
  void excludeUserId
  // TODO: implement duplicate Aadhaar hash lookup
  throw new Error('checkDuplicateAadhaar: not implemented')
}

/**
 * Returns true if the given PAN hash already exists on a different user's record.
 *
 * TODO: same pattern as checkDuplicateAadhaar but for pan_hash column
 */
export async function checkDuplicatePAN(
  supabase: SupabaseClient,
  hash: string,
  excludeUserId: string,
): Promise<boolean> {
  void supabase
  void hash
  void excludeUserId
  // TODO: implement duplicate PAN hash lookup
  throw new Error('checkDuplicatePAN: not implemented')
}

/**
 * Returns true when the two names are considered a match.
 *
 * Algorithm: Levenshtein distance / max(len1, len2) <= 0.40
 * i.e. names are a match if they differ by at most 40% of the longer string's length.
 *
 * TODO: implement Levenshtein distance calculation (or import a small library)
 * TODO: normalise both names first — trim, lowercase, collapse whitespace, strip salutations
 * TODO: compute distance, divide by Math.max(n1.length, n2.length), return distance <= 0.40
 */
export function fuzzyNameMatch(name1: string, name2: string): boolean {
  void name1
  void name2
  // TODO: implement fuzzy name match with Levenshtein distance threshold 40%
  throw new Error('fuzzyNameMatch: not implemented')
}
