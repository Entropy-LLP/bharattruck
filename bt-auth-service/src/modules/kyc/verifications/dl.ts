// Driving License verification via Surepass — validates DL number and enforces HMV/HTV vehicle class for truck drivers

import { surepass } from '../../../lib/surepass.js'
import { KYCLevel, KYCStatus, UserRole, type KYCRequest, type KYCResult } from '../types.js'

// Vehicle classes that qualify for freight operations on BharatTruck
const ALLOWED_VEHICLE_CLASSES = ['HMV', 'HTV', 'HGMV', 'HPMV', 'TRANS'] as const

/**
 * Driving License verification — single-step via Surepass:
 *   POST /driving-license/driving-license  { id_number: dl_number, dob: YYYY-MM-DD }
 *   Returns: name, dob, vehicle_classes[], validity, state
 *
 * metadata expected:
 *   { dl_number: string, dob: string }
 *
 * Rules:
 *   - For UserRole.Driver: at least one entry in vehicle_classes must be in ALLOWED_VEHICLE_CLASSES
 *     If not → return status 'failed' with error: 'DL does not hold HMV/HTV class'
 *   - For other roles: any valid DL accepted
 *   - If DL is expired → return status 'failed' with error: 'DL expired'
 *
 * TODO: call surepass.post('/driving-license/driving-license', { id_number, dob })
 * TODO: check response.data.validity expiry date
 * TODO: if role === Driver, assert ALLOWED_VEHICLE_CLASSES intersection with response.data.vehicle_classes
 * TODO: run fuzzyNameMatch against user's previously verified name (from Aadhaar or PAN)
 */
export async function verifyDl(request: KYCRequest): Promise<KYCResult> {
  void surepass
  void ALLOWED_VEHICLE_CLASSES
  void UserRole

  const { user_id, metadata } = request
  void user_id
  void metadata

  // TODO: implement DL verification logic
  return {
    status:       KYCStatus.Pending,
    kyc_level:    KYCLevel.L0,
    provider_ref: '',
    raw_response: null,
    verified_at:  null,
  }
}
