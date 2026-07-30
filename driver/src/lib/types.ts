export type BookingStatus = 'pending' | 'accepted' | 'negotiating' | 'in_transit' | 'completed' | 'cancelled' | 'paid'
export type BookingType = 'direct' | 'auction'
export type QuoteStatus = 'submitted' | 'countered' | 'accepted' | 'rejected' | 'withdrawn' | 'expired'

export interface Booking {
  id: string
  shipper_id: string
  driver_id: string | null
  shipper_name: string
  shipper_contact: string
  source_address: string
  source_lat: number
  source_lng: number
  destination_address: string
  dest_lat: number
  dest_lng: number
  load_type: string
  weight_kg: number
  /**
   * Money fields. bt-booking-service STRIPS these keys (not nulls them) for a
   * fleet-affiliated driver — their owner bid and their owner is paid, so an
   * employed driver never sees the commercials (founder Q14/Q16; see
   * `stripCommercialFields` in bt-booking-service/src/lib/fleet.ts). Optional
   * here so the compiler forces every read to handle the masked payload.
   */
  quoted_price?: number
  final_price?: number | null
  pickup_date: string
  pickup_time_slot: string | null
  status: BookingStatus
  special_instructions: string | null
  booking_type: BookingType
  target_driver_id: string | null
  auction_deadline: string | null
  awarded_quote_id: string | null
  in_transit_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface Quote {
  id: string
  booking_id: string
  driver_id: string
  amount: number
  message: string | null
  status: QuoteStatus
  submitted_at: string
  expires_at: string | null
  updated_at: string
}

export interface NegotiationEntry {
  id: string
  quote_id: string
  booking_id: string
  actor_id: string
  actor_role: 'shipper' | 'driver'
  amount: number
  message: string | null
  created_at: string
}

// ── Driver onboarding ─────────────────────────────────────────
// Shapes mirror bt-auth-service `/onboarding/*` responses
// (src/routes/onboarding.ts). Verification-flow rows carry a
// `pending | verified | rejected` review status set by ops.

export type VerificationStatus = 'pending' | 'verified' | 'rejected'
export type VerificationBadge = 'pending' | 'verified' | 'premium'

/** A `drivers` row (returned from `select('*')`). */
export interface DriverProfile {
  id: string
  user_id: string
  photo_url: string | null
  languages: string[] | null
  home_base_city: string | null
  home_base_lat: number | null
  home_base_lng: number | null
  verification_badge: VerificationBadge
  created_at: string
  updated_at: string
}

/** The `users` fields returned by `GET /onboarding/profile`. */
export interface OnboardingUser {
  id: string
  full_name: string | null
  phone_number: string | null
  email: string | null
  avatar_url: string | null
  city: string | null
  state: string | null
  kyc_status: string
}

/** A `driver_licenses` row. */
export interface License {
  id: string
  driver_id: string
  dl_number: string
  dl_storage_path: string | null
  vehicle_classes: string[] | null
  expiry_date: string | null
  status: VerificationStatus
  created_at: string
  updated_at: string
}

/** A `driver_insurance` row. */
export interface Insurance {
  id: string
  driver_id: string
  vehicle_id: string
  policy_number: string
  provider: string | null
  storage_path: string | null
  expiry_date: string | null
  status: VerificationStatus
  created_at: string
}

export type VehicleBodyType =
  | 'open' | 'closed' | 'container' | 'flatbed' | 'tanker' | 'refrigerated'
export type VehicleAxleConfig = '4x2' | '6x2' | '6x4' | '8x4' | '10x2'

/** A `vehicles` row, with its joined `driver_insurance` rows. */
export interface Vehicle {
  id: string
  driver_id: string
  rc_number: string
  rc_storage_path: string | null
  vehicle_photos: string[] | null
  capacity_tons: number | null
  body_type: VehicleBodyType | null
  axle_config: VehicleAxleConfig | null
  maker_model: string | null
  fuel_type: string | null
  rc_expiry: string | null
  rc_status: VerificationStatus
  created_at: string
  driver_insurance?: Insurance[]
}

/** A `bank_accounts` row — only the non-secret fields the API returns. */
export interface BankAccount {
  id: string
  account_number_last4: string
  ifsc: string
  bank_name: string | null
  account_holder_name: string
  is_primary: boolean
  verification_status: VerificationStatus
  created_at?: string
}

/** Aggregate returned by `GET /onboarding/profile`. */
export interface OnboardingProfile {
  user: OnboardingUser
  driver: DriverProfile | null
  license: License | null
  vehicles: Vehicle[]
  bank_accounts: BankAccount[]
}

export interface OnboardingChecklist {
  profile_complete: boolean
  license_submitted: boolean
  license_verified: boolean
  vehicle_registered: boolean
  vehicle_verified: boolean
  insurance_uploaded: boolean
  bank_linked: boolean
}

/** Aggregate returned by `GET /onboarding/status`. */
export interface OnboardingStatus {
  verification_badge: VerificationBadge
  checklist: OnboardingChecklist
}
