// GST number verification via Surepass — validates GSTIN and returns legal business name and registration status

import { surepass } from '../../../lib/surepass.js'
import { KYCLevel, KYCStatus, UserRole, type KYCRequest, type KYCResult } from '../types.js'

/**
 * GST verification — single-step via Surepass:
 *   POST /gstin/gstin  { id_number: gstin }
 *   Returns: legal_name, trade_name, registration_date, gst_status ('Active' | 'Cancelled' | ...),
 *            principal_place_of_business, nature_of_business_activities[]
 *
 * metadata expected:
 *   { gstin: string }
 *
 * Relevant roles: CUSTOMER, FLEET_OPERATOR (GST not required for DRIVER)
 *
 * Rules:
 *   - gst_status must be 'Active'
 *   - If Cancelled → status 'failed', error: 'GST registration is cancelled'
 *   - If Suspended → status 'manual_review'
 *
 * TODO: call surepass.post('/gstin/gstin', { id_number: gstin })
 * TODO: validate gst_status, map to KYCStatus
 * TODO: run fuzzyNameMatch(legal_name, user's verified name / business name)
 * TODO: encrypt gstin before persisting (PII)
 */
export async function verifyGst(request: KYCRequest): Promise<KYCResult> {
  void surepass
  void UserRole

  const { user_id, metadata } = request
  void user_id
  void metadata

  // TODO: implement GST verification logic
  return {
    status:       KYCStatus.Pending,
    kyc_level:    KYCLevel.L0,
    provider_ref: '',
    raw_response: null,
    verified_at:  null,
  }
}
