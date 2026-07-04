// Selfie vs Aadhaar photo face-match via Surepass — accepts base64 images, enforces ≥70% similarity threshold

import { surepass } from '../../../lib/surepass.js'
import { KYCLevel, KYCStatus, type KYCRequest, type KYCResult } from '../types.js'

const FACE_MATCH_THRESHOLD = 70 // percent

/**
 * Face match — single-step via Surepass:
 *   POST /face/face-match  { file1: <base64_selfie>, file2: <base64_aadhaar_photo> }
 *   Returns: confidence (0–100), is_face_detected_in_1, is_face_detected_in_2, result ('match' | 'no_match')
 *
 * metadata expected:
 *   { selfie_base64: string, aadhaar_photo_base64: string }
 *   Note: aadhaar_photo_base64 is retrieved from the stored (encrypted) Aadhaar eKYC result —
 *         the caller should pass it after decrypting; this function does not access the DB directly.
 *
 * Rules:
 *   - confidence >= FACE_MATCH_THRESHOLD (70) → 'success'
 *   - confidence < 70 but >= 50 → 'manual_review' (human agent reviews selfie)
 *   - confidence < 50 → 'failed'
 *   - is_face_detected_in_1 or is_face_detected_in_2 is false → 'failed' with descriptive error
 *
 * TODO: validate that Aadhaar verification (status='success') exists before running face match
 * TODO: call surepass.post('/face/face-match', { file1: selfie_base64, file2: aadhaar_photo_base64 })
 * TODO: map confidence score to KYCStatus using thresholds above
 * TODO: do NOT store the base64 images — store only the confidence score and result
 */
export async function verifyFaceMatch(request: KYCRequest): Promise<KYCResult> {
  void surepass
  void FACE_MATCH_THRESHOLD

  const { user_id, metadata } = request
  void user_id
  void metadata

  // TODO: implement face match logic
  return {
    status:       KYCStatus.Pending,
    kyc_level:    KYCLevel.L0,
    provider_ref: '',
    raw_response: null,
    verified_at:  null,
  }
}
