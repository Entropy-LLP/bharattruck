import { z } from 'zod'

// -----------------------------------------------------------
// BookingStatus — mirrors the DB enum booking_status exactly
// -----------------------------------------------------------

export type BookingStatus = 'pending' | 'accepted' | 'in_transit' | 'completed' | 'cancelled' | 'negotiating'

// -----------------------------------------------------------
// BookingType — direct (1:1) or auction (1:many quotes)
// -----------------------------------------------------------

export type BookingType = 'direct' | 'auction'

// -----------------------------------------------------------
// QuoteStatus — lifecycle of a driver's quote on a booking
// -----------------------------------------------------------

export type QuoteStatus = 'submitted' | 'countered' | 'accepted' | 'rejected' | 'withdrawn' | 'expired'

// -----------------------------------------------------------
// DbBooking — raw row shape from the `bookings` table
// -----------------------------------------------------------

export type DbBooking = {
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
  min_acceptable: number | null
  awarded_quote_id: string | null
  dimensions_json: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

// -----------------------------------------------------------
// DbQuote — raw row shape from the `quotes` table
// -----------------------------------------------------------

export type DbQuote = {
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

// -----------------------------------------------------------
// DbNegotiation — append-only log of price offers/counters
// -----------------------------------------------------------

export type DbNegotiation = {
  id: string
  quote_id: string
  booking_id: string
  actor_id: string
  actor_role: 'shipper' | 'driver'
  amount: number
  message: string | null
  created_at: string
}

// -----------------------------------------------------------
// DriverProfile — joined from drivers + users
// -----------------------------------------------------------

export type DriverProfile = {
  id: string
  truck_number: string
  truck_type: string
  truck_capacity_kg: number | null
  average_rating: number
  total_trips: number
  user: {
    id: string
    full_name: string | null
    phone_number: string
  }
}

// -----------------------------------------------------------
// BookingWithProfiles — booking row with optional driver join
// -----------------------------------------------------------

export type BookingWithProfiles = DbBooking & {
  driver?: DriverProfile | null
}

// -----------------------------------------------------------
// Auth types
// -----------------------------------------------------------

export type UserRole = 'shipper' | 'driver' | 'admin'

export type AuthenticatedUser = {
  userId: string      // public.users.id (from JWT userId claim)
  role: UserRole
}

// -----------------------------------------------------------
// CreateBookingBodySchema — request body for POST /bookings
// Shipper info (shipper_id, shipper_name, shipper_contact)
// is filled server-side from the JWT — not accepted from client.
// -----------------------------------------------------------

const latitude  = z.number().min(-90).max(90)
const longitude = z.number().min(-180).max(180)

export const CreateBookingBodySchema = z.object({
  source_address:       z.string().min(1),
  source_lat:           latitude,
  source_lng:           longitude,
  destination_address:  z.string().min(1),
  dest_lat:             latitude,
  dest_lng:             longitude,
  load_type:            z.string().min(1),
  weight_kg:            z.number().positive(),
  quoted_price:         z.number().positive(),
  pickup_date:          z.string()
                          .regex(/^\d{4}-\d{2}-\d{2}$/, 'pickup_date must be YYYY-MM-DD')
                          .refine(d => {
                            const today = new Date(); today.setUTCHours(0, 0, 0, 0)
                            return new Date(d + 'T00:00:00Z') >= today
                          }, 'pickup_date cannot be in the past'),
  pickup_time_slot:     z.string().optional(),
  special_instructions: z.string().optional(),
  booking_type:         z.enum(['direct', 'auction']).default('direct'),
  target_driver_id:     z.string().uuid().optional(),
  auction_deadline:     z.string().datetime().optional(),
  dimensions_json:      z.record(z.unknown()).optional(),
})

export type CreateBookingBody = z.infer<typeof CreateBookingBodySchema>

// -----------------------------------------------------------
// SubmitQuoteBodySchema — request body for POST /quotes
// -----------------------------------------------------------

export const SubmitQuoteBodySchema = z.object({
  amount:  z.number().positive(),
  message: z.string().optional(),
})

export type SubmitQuoteBody = z.infer<typeof SubmitQuoteBodySchema>

// -----------------------------------------------------------
// CounterQuoteBodySchema — request body for PATCH /quotes/:id/counter
// -----------------------------------------------------------

export const CounterQuoteBodySchema = z.object({
  amount:  z.number().positive(),
  message: z.string().optional(),
})

export type CounterQuoteBody = z.infer<typeof CounterQuoteBodySchema>

// -----------------------------------------------------------
// BookingError — domain error with HTTP status attached
// -----------------------------------------------------------

export type BookingErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVALID_TRANSITION'
  | 'VALIDATION_ERROR'
  | 'AUCTION_CLOSED'
  | 'DUPLICATE_QUOTE'
  | 'QUOTE_NOT_FOUND'
  | 'ALREADY_AWARDED'

export class BookingError extends Error {
  public readonly code: BookingErrorCode
  public readonly httpStatus: number

  constructor(
    message: string,
    code: BookingErrorCode,
    httpStatus = 400,
  ) {
    super(message)
    this.name = 'BookingError'
    this.code = code
    this.httpStatus = httpStatus
  }
}
