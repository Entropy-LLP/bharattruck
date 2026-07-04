// PAN card verification via Surepass — validates PAN number, returns name and status from Income Tax database

import { surepass } from '../../../lib/surepass.js'
import { KYCLevel, KYCStatus, type KYCRequest, type KYCResult } from '../types.js'

/**
 * PAN verification — single-step via Surepass:
 *   POST /pan/pan  { id_number: pan_number }
 *   Returns: name_on_pan, pan_type, last_updated, valid (boolean)
 *
 * metadata expected:
 *   { pan_number: string, name: string }  — name used for fuzzy match against name_on_pan
 *
 * TODO: call surepass.post('/pan/pan', { id_number: pan_number })
 * TODO: run fraud.fuzzyNameMatch(metadata.name, response.data.name_on_pan) — fail if no match
 * TODO: hash pan_number, call fraud.checkDuplicatePAN() before persisting
 * TODO: encrypt pan_number before storing in verifications JSONB
 */
export async function verifyPan(request: KYCRequest): Promise<KYCResult> {
  void surepass

  const { user_id, metadata } = request
  void user_id
  void metadata

  // TODO: implement PAN verification logic
  return {
    status:       KYCStatus.Pending,
    kyc_level:    KYCLevel.L0,
    provider_ref: '',
    raw_response: null,
    verified_at:  null,
  }
}
