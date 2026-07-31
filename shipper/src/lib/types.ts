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
  quoted_price: number
  final_price: number | null
  pickup_date: string
  pickup_time_slot: string | null
  status: BookingStatus
  special_instructions: string | null
  /**
   * Consignee inbox the one-time delivery code is emailed to.
   *
   * Nullable: required on new bookings, but the column predates that rule and most
   * existing bookings have none — and without it the driver's proof-of-delivery
   * request has nowhere to send the code, so the trip can never be confirmed
   * delivered. Settable after the fact via `setReceiverEmail`.
   */
  receiver_email: string | null
  booking_type: BookingType
  /**
   * Set when a FLEET won the auction rather than a solo driver. In that case
   * `driver_id` stays NULL until the owner pairs a truck and driver to the trip
   * in bt-fleet-service — so an `accepted` booking here means "carrier locked
   * in", NOT "driver assigned". Both NULL on every solo-driver booking.
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
}

/**
 * Who is behind a bid, resolved server-side.
 *
 * The quote row names its bidder only by id, and which id it is depends on the
 * party kind — neither `drivers.id` nor `fleet_owners.id` is resolvable from
 * this app. `carrier` is the only field here worth showing a shipper.
 */
export interface QuoteCarrier {
  kind: 'driver' | 'fleet'
  id: string
  /** Null when the party has no name on file — render a fallback, never assume. */
  name: string | null
  /** Driver-only; a fleet names its truck at assignment, not at bid time. */
  truck_number: string | null
  average_rating: number | null
  total_trips: number | null
}

export interface Quote {
  id: string
  booking_id: string
  /**
   * NULL on a fleet-owner bid. The DB holds `driver_id` XOR `fleet_owner_id`
   * (migration 016) — never dereference this without checking, and prefer
   * `carrier` for anything user-facing.
   */
  driver_id: string | null
  fleet_owner_id: string | null
  /** Null only if the bidding party row has since been deleted. */
  carrier: QuoteCarrier | null
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
  /** 'fleet_owner' is written when the carrier side of a negotiation is a fleet. */
  actor_role: 'shipper' | 'driver' | 'fleet_owner'
  amount: number
  message: string | null
  created_at: string
}
