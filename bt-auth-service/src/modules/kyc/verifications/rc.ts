// Vehicle RC verification via Vahan API — fetches registration details and stores permit/fitness/insurance expiry dates

import { surepass } from '../../../lib/surepass.js'
import { KYCLevel, KYCStatus, type KYCRequest, type KYCResult } from '../types.js'

/**
 * Vehicle RC (Registration Certificate) verification via Surepass → Vahan API:
 *   POST /rc/rc  { id_number: vehicle_registration_number }
 *   Returns: owner_name, rc_status, fitness_upto, insurance_upto, permit_validity_upto,
 *            vehicle_class, maker_model, fuel_type
 *
 * metadata expected:
 *   { rc_number: string }
 *
 * Expiry dates to store (ISO strings):
 *   - fitness_upto
 *   - insurance_upto
 *   - permit_validity_upto
 *
 * Rules:
 *   - rc_status must be 'ACTIVE'
 *   - fitness_upto must be in the future (warn within 30 days)
 *   - insurance_upto must be in the future (warn within 30 days)
 *   - If any expiry is in the past → return status 'failed' with specific error
 *   - If within 30 days → return status 'manual_review' with warning
 *
 * TODO: call surepass.post('/rc/rc', { id_number: rc_number })
 * TODO: parse and validate all three expiry dates against Date.now()
 * TODO: run fuzzyNameMatch(owner_name, user's verified name)
 * TODO: persist expiry dates in verifications JSONB for downstream reminders service
 */
export async function verifyRc(request: KYCRequest): Promise<KYCResult> {
  void surepass

  const { user_id, metadata } = request
  void user_id
  void metadata

  // TODO: implement RC verification logic
  return {
    status:       KYCStatus.Pending,
    kyc_level:    KYCLevel.L0,
    provider_ref: '',
    raw_response: null,
    verified_at:  null,
  }
}
