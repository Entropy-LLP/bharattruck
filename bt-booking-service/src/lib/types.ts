import { z } from 'zod'
import { AppError, type ErrorCode } from '@bharattruck/shared/errors'

// -----------------------------------------------------------
// BookingStatus — mirrors the DB enum booking_status exactly
// -----------------------------------------------------------

export type BookingStatus = 'pending' | 'accepted' | 'in_transit' | 'completed' | 'paid' | 'cancelled' | 'negotiating'

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
  receiver_email: string | null   // consignee inbox for receiver-OTP POD (migration 010)
  booking_type: BookingType
  target_driver_id: string | null
  auction_deadline: string | null
  min_acceptable: number | null
  awarded_quote_id: string | null
  dimensions_json: Record<string, unknown> | null
  // Fleet persona (migration 016). Both NULL on every solo-driver booking, which
  // is what keeps the solo flow on its original code paths: fleet_owner_id is set
  // only when a FLEET quote wins the auction, and vehicle_id only when the owner
  // pairs a truck to the trip in bt-fleet-service.
  fleet_owner_id: string | null
  vehicle_id: string | null
  created_at: string
  updated_at: string
}

// -----------------------------------------------------------
// DbQuote — raw row shape from the `quotes` table
// -----------------------------------------------------------

// A bid comes from EITHER a solo driver OR a fleet owner — migration 016 made
// driver_id nullable and added fleet_owner_id under a
// `num_nonnulls(driver_id, fleet_owner_id) = 1` check. Exactly one is ever set.

export type DbQuote = {
  id: string
  booking_id: string
  driver_id: string | null
  fleet_owner_id: string | null
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
  // 'fleet_owner' is written when the carrier side of a negotiation is a fleet.
  // The live negotiations.actor_role CHECK still only allows shipper|driver, so
  // that write is best-effort until the constraint is widened (see quote-service).
  actor_role: 'shipper' | 'driver' | 'fleet_owner'
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

  /**
   * Driver-facing only: is the CALLER the driver assigned to this trip?
   *
   * Server-computed because the client cannot work it out — `driver_id` is a
   * `drivers.id`, and the app only ever holds the `users.id` from its JWT. The
   * driver app needs the answer to decide whether to show the trip lifecycle
   * (start / navigate / POD) or the marketplace bid form, and its previous
   * stand-in for it — "do I own a quote on this booking?" — was wrong for BOTH
   * personas: a fleet driver never owns a quote (their owner bids), and a solo
   * driver who took a load with PATCH /accept has no quote row either. Both
   * were shown a bid form for a trip they were already driving.
   *
   * Absent for shipper/admin callers, who are not drivers.
   */
  assigned_to_me?: boolean
}

// -----------------------------------------------------------
// Auth types — canonical in @bharattruck/shared/auth (the users.id vs
// drivers.id identity contract lives there); re-exported for existing importers.
// -----------------------------------------------------------

export type { AuthenticatedUser, UserRole } from '@bharattruck/shared/auth'

// -----------------------------------------------------------
// CreateBookingBodySchema — request body for POST /bookings
// Shipper info (shipper_id, shipper_name, shipper_contact)
// is filled server-side from the JWT — not accepted from client.
// -----------------------------------------------------------

const latitude  = z.number().min(-90).max(90)
const longitude = z.number().min(-180).max(180)

export const CreateBookingBodySchema = z.object({
  // The shipper sends the price-lock handle, NOT a raw price. quoted_price is
  // resolved server-side from the locked price_quotes row (PRD 5.4: price SHOWN
  // == price CHARGED) — the client can no longer type its own number.
  quote_id:             z.string().uuid(),
  source_address:       z.string().min(1),
  source_lat:           latitude,
  source_lng:           longitude,
  destination_address:  z.string().min(1),
  dest_lat:             latitude,
  dest_lng:             longitude,
  load_type:            z.string().min(1),
  weight_kg:            z.number().positive(),
  // The requested truck class, bound to the locked quote at create time (the
  // price scales ~2.9x across classes — mini_truck rate 12 → trailer rate 35 —
  // so it MUST match what was priced). Enum mirrors bt-pricing-service's
  // accepted vehicle_type set (single source of truth is pricing's QuoteBody).
  vehicle_type:         z.enum(['mini_truck', 'lcv', 'hcv', 'trailer']),
  pickup_date:          z.string()
                          .regex(/^\d{4}-\d{2}-\d{2}$/, 'pickup_date must be YYYY-MM-DD')
                          .refine(d => {
                            const today = new Date(); today.setUTCHours(0, 0, 0, 0)
                            return new Date(d + 'T00:00:00Z') >= today
                          }, 'pickup_date cannot be in the past'),
  pickup_time_slot:     z.string().optional(),
  special_instructions: z.string().optional(),
  // Consignee inbox the receiver-OTP POD code is emailed to. REQUIRED at
  // creation: without it a fresh booking can never reach `completed` (the
  // driver's POD request has no address to send the code to). Persisted to
  // the bookings.receiver_email column (read back by getPodContext).
  receiver_email:       z.string().email(),
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
// BookingError — domain error, now a thin subclass of the shared AppError
// (canonical error envelope in @bharattruck/shared/errors). Keeps the exact
// (message, code, httpStatus=400) signature + a `.httpStatus` getter so every
// existing call site and route handler is unchanged. Booking's domain codes
// (AUCTION_CLOSED, DUPLICATE_QUOTE, QUOTE_NOT_FOUND, ALREADY_AWARDED) were added
// to the shared ErrorCode union.
// -----------------------------------------------------------

export type BookingErrorCode = ErrorCode

export class BookingError extends AppError {
  constructor(message: string, code: ErrorCode, httpStatus = 400) {
    super(message, code, httpStatus)
    this.name = 'BookingError'
  }

  get httpStatus(): number {
    return this.statusCode
  }
}
