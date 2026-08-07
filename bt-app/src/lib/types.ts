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
// 'delivery_asserted' (migration 0025) is the no-confirmation POD branch: the driver
// captured evidence but the receiver could not confirm, so the trip parks here until
// ops closes it to 'completed'. Listed so the state is REPRESENTABLE — the API can
// return it, and a union that cannot hold it turns a real status into a type lie.
export type BookingStatus =
  | 'pending' | 'negotiating' | 'accepted' | 'in_transit' | 'delivery_asserted' | 'completed' | 'cancelled' | 'paid'
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

// ── Capabilities & personas (the unified-app shell reads these) ────────────────
//
// Mirrors @bharattruck/shared/personas as served by GET /auth/me. This app is a
// standalone Next project with no @bharattruck/shared dependency (same as fleet/),
// so the wire shape is restated here — a field rename in the resolver becomes a
// compile error here rather than a silent `undefined` gate.
//
// A "persona" is NOT a role string. It is a VIEW over what a human owns and who
// they are connected to, computed server-side. The shell gates every surface on a
// CAPABILITY (never on `role`) — D-27/D-36. `ship` is unconditional (everyone may
// post a load, D-5); the other three emerge from assets: `drive` = has a driver
// profile, `carry` = owns >=1 truck, `operate` = owns >=2 trucks or holds >=1 driver.
export type Capability = 'ship' | 'drive' | 'carry' | 'operate'

export type PersonaSnapshot = {
  user_id: string
  primary_persona: AuthUser['role']
  capabilities: Capability[]
  driver_id: string | null
  fleet_owner_id: string | null
  owned_vehicle_count: number
  held_driver_count: number
  affiliated_fleet_owner_ids: string[]
  sees_commercials: boolean
}

// The full GET /auth/me payload. `personas` is null when the server could not
// resolve capabilities (e.g. the 0022 columns are not applied yet on the database
// this build talks to); `personas_error` then names the reason. The client must
// treat null as "no answer yet", never as "this human may do nothing" — see the
// fallback in lib/auth.tsx.
export type MeResponse = {
  user: AuthUser
  personas: PersonaSnapshot | null
  personas_error: 'PERSONA_RESOLUTION_FAILED' | null
}

// ── Home action feed (GET /me/feed, D-38) ─────────────────────────────────────
//
// One ranked, time-ordered list of TYPED items, each carrying the PERSONA TAG it
// belongs to — mirrors bt-booking-service/src/lib/feed/types.ts. The tag is the
// whole point: a row tagged 'shipper' renders in the shipper idiom and a 'driver'
// row in the driver idiom, interleaved on one surface. For a single-capability
// human the list holds one kind of thing and reads like today's single-purpose home.
export type FeedPersonaTag = 'shipper' | 'carrier' | 'driver' | 'fleet' | 'consignee'

export type FeedItemType =
  | 'bids_received' | 'delivery_action' | 'open_work' | 'bid_countered'
  | 'trip_starting' | 'trip_delivery' | 'fleet_driver_joined' | 'truck_assignment'

export type FeedPriority = 'urgent' | 'high' | 'normal' | 'low'

/** Where tapping a row goes. The app already routes on booking/quote ids. */
export type FeedTarget = {
  booking_id?: string
  quote_id?: string
  fleet_driver_id?: string
}

export type FeedItem = {
  id: string
  type: FeedItemType
  tag: FeedPersonaTag
  title: string
  subtitle: string
  timestamp: string
  target: FeedTarget
  priority: FeedPriority
}

/**
 * One page of the merged feed. `degraded_sources` names any source that ERRORED
 * and was skipped — the feed returns the rest rather than 500ing, so the home page
 * always renders. The client surfaces that partial state rather than hiding it.
 */
export type FeedPage = {
  items: FeedItem[]
  total: number
  limit: number
  offset: number
  next_offset: number | null
  degraded_sources: string[]
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

// ── Live fleet tracking (bt-tracking-service /tracking/fleet/overview) ────────
//
// VEHICLE-centric, unlike LivePosition above, which is driver-centric and comes from
// bt-fleet-service's /fleet/live. That distinction is the whole point: /fleet/live starts
// from the driver set, so a truck with no driver assigned never appears. This board starts
// from the vehicle list, so every asset the owner has is always a row — and when a truck has
// no position, the row explains WHY rather than vanishing.

/** Why a truck looks the way it does. Drives both the pin colour and the row's copy. */
export type VehicleStatus =
  | 'moving'                // reporting and rolling
  | 'idle'                  // reporting, stopped
  | 'no_signal'             // should be reporting, is not
  | 'assigned_not_started'  // has a trip, trip not live yet
  | 'parked'                // no trip
  | 'inactive'              // deactivated in the fleet

export type DataHealth = {
  level: 'ok' | 'degraded' | 'missing'
  /** Plain-language cause, written for the owner. Always safe to render directly. */
  reason: string
}

export type TrackedAlert = {
  id: string
  type: string
  message: string | null
  severity: 'info' | 'warning' | 'critical'
  lat: number | null
  lng: number | null
  acknowledged: boolean
  resolved_at: string | null
  created_at: string
  meta: Record<string, unknown>
}

export type TrackedVehicle = {
  vehicle_id: string
  rc_number: string | null
  maker_model: string | null
  model_category: string | null
  emission_norm: string | null
  body_type: string | null
  capacity_tons: number | null
  is_active: boolean
  current_odometer_km: number | null
  rc_expiry: string | null

  status: VehicleStatus
  status_label: string
  data_health: DataHealth

  driver: { driver_id: string; name: string | null; phone: string | null } | null

  booking: {
    booking_id: string
    status: string
    source_address: string | null
    dest_address: string | null
    pickup_date: string | null
    destination: { lat: number; lng: number }
  } | null

  position: {
    lat: number
    lng: number
    heading: number | null
    speed_kmh: number | null
    updated_at: string
    age_seconds: number | null
  } | null

  trip: {
    driven_km: number
    moving_hours: number
    idle_hours: number
    night_hours: number
    avg_moving_speed_kmh: number | null
    max_speed_kmh: number
    stop_count: number
    speeding_fixes: number
    max_deviation_m: number
    point_count: number
    last_fix_at: string | null
  } | null

  fuel: {
    /** The truck's rated economy — present even when parked. */
    mileage_kmpl: number
    basis: 'vehicle_norms' | 'vehicle_class' | 'default'
    basis_note: string
    /** Null until the truck has actually driven some of this trip. */
    trip: {
      distance_km: number
      litres: number
      diesel_cost_inr: number
      def_cost_inr: number
      total_cost_inr: number
    } | null
  }

  alerts: TrackedAlert[]
}

export type FleetOverview = {
  fleet_owner_id: string
  company_name: string
  generated_at: string
  summary: {
    vehicle_count: number
    moving: number
    idle: number
    no_signal: number
    assigned_not_started: number
    parked: number
    inactive: number
    on_trip: number
    alert_count: number
    trip_fuel_cost_inr: number
    driven_km: number
  }
  vehicles: TrackedVehicle[]
}

export type Geofence = {
  id: string
  fleet_owner_id: string | null
  name: string
  kind: 'depot' | 'warehouse' | 'checkpoint' | 'custom'
  lat: number
  lng: number
  radius_m: number
  active: boolean
  created_at: string
  updated_at: string
}
// ── Auction bidding ───────────────────────────────────────────
//
// Reads come from bt-fleet-service (`/fleet/auctions`, `/fleet/bids`) because they are
// tenant-scoped list queries. Writes go straight to bt-booking-service's existing
// `/bookings/:id/quotes*` routes, which already accept a fleet owner as a bidder and
// already own the auction-deadline and duplicate-bid rules.

export type Quote = {
  id: string
  booking_id: string
  driver_id: string | null
  /** Set instead of driver_id when the bidder is a fleet (migration 0016). */
  fleet_owner_id: string | null
  amount: number
  message: string | null
  status: QuoteStatus
  submitted_at: string
  expires_at: string | null
  updated_at: string
  /**
   * The party behind the bid, resolved server-side for display (D-27). Present on
   * a booking's quote list (GET /bookings/:id/quotes, bt-booking-service) so the
   * shipper can tell a solo driver from a fleet; ABSENT on the tenant-scoped fleet
   * bid reads (/fleet/auctions, /fleet/bids), which never carry it. Optional for
   * exactly that reason — read `carrier` when it is there, fall back to the id
   * columns when it is not (see the load-detail page's carrierKind()).
   */
  carrier?: QuoteCarrier | null
}

/**
 * Who is behind a bid, resolved server-side (mirrors bt-booking-service's
 * QuoteCarrier). A quote row names its bidder only by id, and which id — a
 * `drivers.id` XOR a `fleet_owners.id` — is not resolvable by this app, so the
 * server projects the party down to what a shipper may see and render.
 */
export type QuoteCarrier = {
  kind: 'driver' | 'fleet'
  id: string
  /** Null when the party has no name on file — render a fallback, never assume. */
  name: string | null
  /** Driver-only; a fleet names its truck at assignment, not at bid time. */
  truck_number: string | null
  average_rating: number | null
  total_trips: number | null
}

/** The load behind a bid or an open auction. */
export type AuctionBooking = {
  id: string
  shipper_id: string
  shipper_name: string | null
  source_address: string
  destination_address: string
  source_lat: number
  source_lng: number
  dest_lat: number
  dest_lng: number
  load_type: string
  weight_kg: number
  /** What the shipper posted as their ask. */
  quoted_price: number
  pickup_date: string
  pickup_time_slot: string | null
  status: BookingStatus
  booking_type: string
  auction_deadline: string | null
  target_driver_id: string | null
  special_instructions: string | null
  created_at: string
}

export type OpenAuction = AuctionBooking & {
  /** This fleet's live bid on this load, or null if it has not bid yet. */
  my_bid: Quote | null
  /**
   * Total live bids on the load. Deliberately the ONLY competitive signal the
   * service exposes — rival amounts and identities are never sent.
   */
  bid_count: number
}

export type FleetBid = Quote & {
  /** Null only if the load became unreadable; the bid row still shows. */
  booking: AuctionBooking | null
}

/**
 * One entry in a bid's price thread.
 *
 * `actor_role` includes `fleet_owner` — bt-booking-service writes that value
 * (quote-service.ts recordNegotiation), and the driver app's copy of this type
 * omits it, which would mis-render a fleet's own counter.
 */
export type NegotiationEntry = {
  id: string
  quote_id: string
  booking_id: string
  actor_id: string
  actor_role: 'shipper' | 'driver' | 'fleet_owner'
  amount: number
  message: string | null
  created_at: string
}

// ── Ship surfaces (Post a Load / My Loads / load detail — Phase 2) ─────────────
//
// The shapes bt-booking-service, bt-pricing-service and bt-tracking-service speak
// for the shipper flow. Ported from shipper/src/lib (types.ts + api.ts) and kept
// snake_case verbatim — a field rename in a service is a compile error here rather
// than a silent `undefined`. bt-app is a standalone Next project with no
// @bharattruck/shared dep (same as fleet/ and shipper/), so the wire shapes are
// restated rather than imported.

/** A load is taken to the marketplace (`auction`) or handed to one driver (`direct`). */
export type BookingType = 'direct' | 'auction'

/**
 * The caller's relations to a booking, resolved server-side (D-27). Every booking
 * read carries a `viewer` block naming these — it is how "loads I posted" is told
 * from "loads I could bid on" in one list, without the client re-deriving persona
 * logic. Mirrors @bharattruck/shared BookingRelation.
 */
export type BookingRelation = 'shipper' | 'carrier' | 'driver' | 'consignee' | 'observer'

export type BookingViewer = {
  relations: BookingRelation[]
  sees_commercials: boolean
}

/**
 * The receiving party, projected down to what a booking read may disclose (D-22).
 * Name/phone/city only — email, GSTIN and street address are deliberately withheld
 * from a general booking read (they appear on the LR/invoice instead). Attached by
 * the server; ABSENT (not null) for a viewer with no relation, or on a pre-0026
 * database, which is why every read of it is guarded.
 */
export type ConsigneeParty = {
  name: string | null
  phone: string | null
  city: string | null
}

/** The receiving party named at posting time (D-22/D-29). Name + phone required. */
export type ConsigneeInput = {
  name: string
  /** A 10-digit Indian mobile; the server normalises and dedups on it. */
  phone: string
  email?: string
  gstin?: string
  address?: string
  city?: string
  state?: string
  pincode?: string
}

export type Booking = {
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
  quoted_price: number
  final_price: number | null
  pickup_date: string
  pickup_time_slot: string | null
  status: BookingStatus
  special_instructions: string | null
  /** Consignee inbox the one-time delivery code is emailed to. Nullable. */
  receiver_email: string | null
  /** The consignee as a first-class (possibly unclaimed) party (D-22). */
  consignee_user_id: string | null
  booking_type: BookingType
  /**
   * Set when a FLEET won the auction rather than a solo driver. `driver_id` then
   * stays NULL until the owner pairs a truck+driver in bt-fleet-service — so an
   * `accepted` fleet booking means "carrier locked in", NOT "driver assigned".
   */
  fleet_owner_id: string | null
  vehicle_id: string | null
  target_driver_id: string | null
  auction_deadline: string | null
  awarded_quote_id: string | null
  in_transit_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  /** The receiving party (server-attached; absent for a viewer with no relation). */
  consignee?: ConsigneeParty | null
  /** The caller's relations to this booking + whether they may see money. */
  viewer?: BookingViewer
}

// ── Advisory pricing (bt-pricing-service, D-11) ────────────────────────────────

export type PriceQuoteVehicleType = 'mini_truck' | 'lcv' | 'hcv' | 'trailer'
export type PriceQuoteLoadType =
  | 'general' | 'fragile' | 'perishable' | 'hazardous' | 'heavy_machinery'

export type PriceQuoteInput = {
  source_lat: number
  source_lng: number
  dest_lat: number
  dest_lng: number
  vehicle_type: PriceQuoteVehicleType
  load_type: PriceQuoteLoadType
  weight_kg: number
  /**
   * What the quote is for. On an auction the platform sets no price, so the quote
   * is `advisory`; sending this is what makes the server persist it that way. The
   * omitted wire default is `binding` — the wrong answer for an auction — so the
   * form always sends it.
   */
  booking_type?: BookingType
}

export type PriceQuoteBreakdown = {
  vehicle_class: string
  distance_km: number
  mileage_kmpl: number
  diesel_price_inr: number
  fuel_cost: number
  driver_wage: number
  per_km_operating_cost: number
  handling: number
  operating_cost_total: number
}

export type PriceQuote = {
  quote_id: string
  quoted_price: number
  currency: string
  expires_at: string
  breakdown: PriceQuoteBreakdown
  base_price: number
  weight_surcharge: number
  handling_fee: number
  rate_per_km: number
  total_price: number
  platform_fee: number
  shipper_pays: number
  driver_receives: number
  version: string
  /** Whether `quoted_price` is the charge (`binding`) or a benchmark (`advisory`). */
  quote_kind?: 'advisory' | 'binding'
  /** Server-authored sentence explaining where the number came from. */
  basis?: string
}

// ── Live tracking (bt-tracking-service read-through aggregate, LOCKED D-8) ──────

export type RouteBounds = {
  ne_lat: number
  ne_lng: number
  sw_lat: number
  sw_lng: number
}

export type TrackLocation = {
  lat: number
  lng: number
  heading: number | null
  speed_kmh: number | null
  updated_at: string
}

export type TrackEta = {
  eta_s: number
  eta_text: string
  remaining_m: number
  traffic: string
  computed_at: string
  stale: boolean
}

export type TrackAlert = {
  id: string
  type: string
  message: string | null
  lat: number | null
  lng: number | null
  acknowledged: boolean
  created_at: string
}

export type TrackData = {
  booking_id: string
  status: string
  /** Latest live fix; null until the driver starts sharing location. */
  location: TrackLocation | null
  route: {
    polyline: string
    distance_m: number
    bounds: RouteBounds
  }
  /** Live traffic ETA; null when there's no location and nothing cached. */
  eta: TrackEta | null
  destination: { lat: number; lng: number }
  alerts: TrackAlert[]
}

/** A single driver fix (GET /location/booking/:id). Trip-scoped (D-25). */
export type DriverLocation = {
  driver_id: string
  lat: number
  lng: number
  heading: number | null
  speed_kmh: number | null
  accuracy_m: number | null
  booking_id: string | null
  updated_at: string
}

// ── Drive surfaces (My Trips / Navigate / POD capture — Phase 3) ────────────────
//
// The driver-side wire shapes bt-booking-service, bt-tracking-service and
// bt-cargo-ledger speak for a trip being DRIVEN. Ported from driver/src/lib (api.ts
// interfaces) and kept snake_case verbatim — a field rename in a service is a compile
// error here rather than a silent `undefined`. bt-app is a standalone Next project
// with no @bharattruck/shared dep (same as fleet/ and driver/), so the wire shapes are
// restated rather than imported.

/** A single GPS fix the driver pushes while in transit (POST /location/update). */
export type LocationUpdate = {
  lat: number
  lng: number
  heading?: number
  speed_kmh?: number
  accuracy_m?: number
  booking_id?: string
}

/**
 * What the driver needs to trigger the delivery code (GET /bookings/:id/pod-context).
 * `receiver_email` is the inbox the one-time code is sent to — null when the shipper
 * never set one, which the UI must surface rather than let the driver tap into a
 * dead end.
 */
export type PodContext = {
  booking_id: string
  status: string
  receiver_email: string | null
}

/** Result of asking for the delivery OTP (POST /cargo/pod/request-otp). */
export type RequestOtpResult = {
  booking_id: string
  /** MASKED receiver email (e.g. j****@x.com) — show the full address from
   *  PodContext instead. */
  sent_to: string
  expires_in_seconds: number
}

/** Cached base polyline for the lane (GET /tracking/route/:id). One call per trip. */
export type RouteData = {
  polyline: string
  distance_m: number
  static_duration_s: number
  bounds: { ne_lat: number; ne_lng: number; sw_lat: number; sw_lng: number }
  cached: boolean
}

export type PetrolPump = {
  place_id: string
  name: string
  lat: number
  lng: number
  distance_m: number
  address: string | null
  brand: string | null
}

export type PumpsData = {
  booking_id: string
  origin: { lat: number; lng: number }
  /** Which position the search was anchored at, so the UI can say so honestly. */
  origin_source: 'live_position' | 'last_breadcrumb' | 'pickup_point'
  limit: number
  radius_m: number
  pump_count: number
  pumps: PetrolPump[]
  cached: boolean
}

export type FuelData = {
  booking_id: string
  vehicle_id: string | null
  distance_basis: 'override' | 'driven' | 'planned' | 'unknown'
  distance_note: string
  distance_km: number
  mileage_kmpl: number
  diesel_price_inr: number
  litres_required: number
  diesel_cost_inr: number
  def_cost_inr: number
  estimated_fuel_cost_inr: number
  vehicle_class: string | null
  basis: 'vehicle_norms' | 'vehicle_class' | 'default'
  /** Plain-language provenance — render it, never present an estimate as measured. */
  basis_note: string
  inputs_overridden: string[]
}

export type TripAlert = {
  id: string
  type: string
  message: string | null
  severity: 'info' | 'warning' | 'critical'
  acknowledged: boolean
  resolved_at: string | null
  created_at: string
}

export type AlertsData = {
  booking_id: string
  evaluated_at: string
  thresholds: { off_route_m: number; idle_seconds: number; near_drop_m: number; speeding_kmh: number }
  current_location: { deviation_m: number | null; off_route: boolean | null; distance_to_drop_m: number } | null
  open_count: number
  alerts: TripAlert[]
}
