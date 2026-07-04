// Aadhaar eKYC via Surepass — two-step: initiate OTP to registered mobile, then verify OTP and receive masked Aadhaar data

import { surepass } from '../../../lib/surepass.js'
import { KYCLevel, KYCStatus, type KYCRequest, type KYCResult } from '../types.js'

/**
 * Aadhaar eKYC — two-step via Surepass:
 *   Step 1 (initiate): POST /aadhaar-v2/generate-otp  { id_number: aadhaar_number }
 *                      Returns client_id — store in Redis under `kyc:aadhaar:<userId>` with 10 min TTL
 *   Step 2 (verify):   POST /aadhaar-v2/submit-otp   { client_id, otp }
 *                      Returns masked Aadhaar, name, dob, address — store encrypted
 *
 * metadata expected:
 *   { aadhaar_number?: string, otp?: string }
 *   - aadhaar_number present, otp absent → initiate
 *   - otp present → verify (client_id fetched from Redis)
 *
 * TODO: Step 1 — call surepass.post('/aadhaar-v2/generate-otp', { id_number }), store client_id in Redis
 * TODO: Step 2 — fetch client_id from Redis, call surepass.post('/aadhaar-v2/submit-otp', { client_id, otp })
 * TODO: on success — encrypt raw PII with encryption.encrypt(), hash aadhaar_number for fraud check
 * TODO: check fraud.checkDuplicateAadhaar() before persisting
 */
export async function verifyAadhaar(request: KYCRequest): Promise<KYCResult> {
  void surepass

  const { user_id, metadata } = request
  void user_id
  void metadata

  // TODO: implement Aadhaar eKYC initiate / verify logic
  return {
    status:       KYCStatus.Pending,
    kyc_level:    KYCLevel.L0,
    provider_ref: '',
    raw_response: null,
    verified_at:  null,
  }
}
