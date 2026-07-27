// Shapes returned by bt-fleet-service (and, for auth, bt-auth-service).
//
// These mirror bt-fleet-service/src/lib/types.ts and src/lib/analytics.ts. The
// service speaks snake_case over the wire and these types keep that verbatim —
// no camelCase mapping layer — so a field rename in the service is a compile
// error here rather than a silent `undefined` in a stat tile.

export type EmissionNorm = 'BS4' | 'BS6' | 'BS6_PH2'
export type FleetDriverStatus = 'pending' | 'active' | 'rejected' | 'suspended' | 'left'

// Both enums are the LIVE database values, confirmed by introspection rather than
// read off a migration file — booking_status in particular has no 'expired' member,
// because migration 0004 was never applied.
export type BookingStatus =
  | 'pending' | 'negotiating' | 'accepted' | 'in_transit' | 'completed' | 'cancelled' | 'paid'
export type QuoteStatus =
  | 'submitted' | 'countered' | 'accepted' | 'rejected' | 'withdrawn' | 'expired'

export type AuthUser = {
  id: string
  phone: string | null
  email: string | null
  full_name: string | null
  avatar_url: string | null
  role: 'shipper' | 'driver' | 'admin' | 'fleet_owner'
  email_verified: boolean
  created_at: string
}

export type FleetOwner = {
  id: string
  user_id: string
  company_name: string
  gstin: string | null
  pan: string | null
  contact_phone: string | null
  billing_address: string | null
  city: string | null
  state: string | null
  monthly_overhead_inr: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export type Vehicle = {
  id: string
  driver_id: string | null
  fleet_owner_id: string | null
  rc_number: string
  capacity_tons: number | null
  body_type: string | null
  axle_config: string | null
  maker_model: string | null
  fuel_type: string | null
  rc_expiry: string | null
  model_category: string | null
  emission_norm: EmissionNorm | null
  manufacture_year: number | null
  volume_cuft: number | null
  current_odometer_km: number | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type VehicleFinance = {
  vehicle_id: string
  lender: string | null
  loan_account_no: string | null
  principal_inr: number | null
  emi_amount_inr: number
  emi_day_of_month: number | null
  tenure_months: number | null
  interest_rate_pct: number | null
  start_date: string | null
  end_date: string | null
  outstanding_inr: number | null
  insurance_annual_inr: number
  permit_annual_inr: number
  fitness_annual_inr: number
}

export type VehiclePermit = {
  id: string
  vehicle_id: string
  permit_type: 'national' | 'state' | 'contract_carriage' | 'goods'
  allowed_states: string[]
  permit_number: string | null
  issued_on: string | null
  expiry_date: string | null
  is_active: boolean
}

export type VehicleLane = {
  id: string
  vehicle_id: string
  origin_city: string
  destination_city: string
  origin_lat: number | null
  origin_lng: number | null
  dest_lat: number | null
  dest_lng: number | null
  typical_distance_km: number | null
  is_primary: boolean
  trips_observed: number
}

export type FleetDriver = {
  id: string
  fleet_owner_id: string
  driver_id: string
  status: FleetDriverStatus
  monthly_salary_inr: number | null
  invited_at: string
  responded_at: string | null
  left_at: string | null
  full_name?: string | null
  phone_number?: string | null
  home_base_city?: string | null
  average_rating?: number | null
  total_trips?: number | null
  verification_badge?: string | null
}

// ── Analytics (bt-fleet-service/src/lib/analytics.ts) ─────────

export type Period = { from: string; to: string }

export type Utilization = {
  tonnage_pct: number | null
  volume_pct: number | null
  distance_pct: number | null
  laden_weight_kg: number
  capacity_kg: number
  volume_used_cuft: number
  capacity_cuft: number
  distance_km: number
  expected_distance_km: number | null
}

/** The headline: did this asset cover its own running cost + EMI + fixed share? */
export type RunningCostScore = {
  revenue_inr: number
  running_cost_inr: number
  gross_margin_inr: number
  fixed_cost_inr: number
  emi_inr: number
  surplus_inr: number
  covered: boolean
}

export type CostBreakdown = {
  fuel_inr: number
  def_inr: number
  engine_oil_inr: number
  gear_oil_inr: number
  service_inr: number
  tyre_inr: number
  driver_wage_inr: number
  toll_inr: number
  other_inr: number
}

export type VehicleAnalytics = {
  vehicle_id: string
  rc_number: string
  model_category: string | null
  emission_norm: string | null
  trips: number
  utilization: Utilization
  score: RunningCostScore
  cost_breakdown_inr: CostBreakdown
  net_profit_inr: number
  cost_per_km_inr: number | null
  revenue_per_km_inr: number | null
}

export type FleetSummary = {
  period: Period
  trips: number
  active_vehicles: number
  utilization: Utilization
  score: RunningCostScore
  cost_breakdown_inr: CostBreakdown
  net_profit_inr: number
  monthly_overhead_inr: number
  vehicles_covering_emi: number
}

export type DriverAnalytics = {
  driver_id: string
  full_name: string | null
  phone_number: string | null
  trips: number
  distance_km: number
  revenue_inr: number
  running_cost_inr: number
  net_profit_inr: number
  wage_allocated_inr: number
  net_profit_per_km_inr: number | null
}

export type FuelComparison = {
  period: Period
  estimated_inr: number
  actual_inr: number
  variance_inr: number
  variance_pct: number | null
  trips_with_actuals: number
  trips: number
  by_vehicle: {
    vehicle_id: string
    rc_number: string
    estimated_inr: number
    actual_inr: number
    variance_inr: number
    variance_pct: number | null
    trips_with_actuals: number
  }[]
}

// ── Live map ─────────────────────────────────────────────────

export type LivePosition = {
  driver_id: string
  vehicle_id: string | null
  rc_number: string | null
  driver_name: string | null
  booking_id: string | null
  lat: number
  lng: number
  heading: number | null
  speed_kmh: number | null
  recorded_at: string
  stale: boolean
}

// ── Bookings / assignment ────────────────────────────────────

export type FleetBooking = {
  id: string
  status: BookingStatus
  shipper_name: string
  source_address: string
  destination_address: string
  source_lat: number
  source_lng: number
  dest_lat: number
  dest_lng: number
  load_type: string
  weight_kg: number
  quoted_price: number
  final_price: number | null
  pickup_date: string
  booking_type: string
  vehicle_id: string | null
  driver_id: string | null
  created_at: string
  vehicle?: { rc_number: string } | null
  driver?: { full_name: string | null } | null
}

export type ModelCategory = {
  model_category: string
  super_category: string
  vehicle_class: 'SCV' | 'LCV' | 'MCV' | 'HCV'
  kms_per_year: number
  payload_tons_typical: number | null
  volume_cuft_typical: number | null
}
