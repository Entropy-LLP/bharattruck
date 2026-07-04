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
