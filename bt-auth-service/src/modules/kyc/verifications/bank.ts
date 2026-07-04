// Penny drop bank account verification via Surepass — transfers ₹1, confirms name match, returns account validity as KYCResult

import { surepass } from '../../../lib/surepass.js'
import { KYCLevel, KYCStatus, type KYCRequest, type KYCResult } from '../types.js'

/**
 * Bank account verification (penny drop) — single-step via Surepass:
 *   POST /bank-verification/bank-verification
 *   Body: { id_number: account_number, ifsc: ifsc_code, ifsc_details: true, name: account_holder_name }
 *   Returns: account_exists, name_at_bank, transaction_id, utr, amount_transferred
 *
 * metadata expected:
 *   { account_number: string, ifsc: string, name: string }
 *
 * Rules:
 *   - account_exists must be true
 *   - Run fuzzyNameMatch(name_at_bank, metadata.name) — fail if no match
 *     (catches cases where account belongs to a different person)
 *   - On success → store encrypted account_number + ifsc (not the transaction)
 *   - Never log or store the UTR / transaction_id beyond the raw_response audit field
 *
 * TODO: call surepass.post('/bank-verification/bank-verification', payload)
 * TODO: check account_exists, run fuzzyNameMatch, map to KYCStatus
 * TODO: encrypt account_number before persisting
 * TODO: idempotency — if bank already verified for this user, return existing result without a new penny drop
 */
export async function verifyBank(request: KYCRequest): Promise<KYCResult> {
  void surepass

  const { user_id, metadata } = request
  void user_id
  void metadata

  // TODO: implement penny drop bank verification logic
  return {
    status:       KYCStatus.Pending,
    kyc_level:    KYCLevel.L0,
    provider_ref: '',
    raw_response: null,
    verified_at:  null,
  }
}
