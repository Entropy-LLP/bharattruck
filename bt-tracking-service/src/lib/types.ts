// -----------------------------------------------------------
// Auth
// -----------------------------------------------------------
export type UserRole = 'shipper' | 'driver' | 'admin'

export type AuthenticatedUser = {
  userId: string // public.users.id (from JWT userId claim)
  role: UserRole
}

// -----------------------------------------------------------
// Geometry
// -----------------------------------------------------------
export type LatLng = { lat: number; lng: number }

export type Bounds = {
  ne_lat: number
  ne_lng: number
  sw_lat: number
  sw_lng: number
}

// -----------------------------------------------------------
// LiveLocation — shape written by bt-booking-service into
// loc:driver:{driverId} (READ-ONLY here, never written).
// -----------------------------------------------------------
export type LiveLocation = {
  driver_id: string
  lat: number
  lng: number
  heading: number | null
  speed_kmh: number | null
  accuracy_m: number | null
  booking_id: string | null
  updated_at: string
}

// -----------------------------------------------------------
// TrackingBooking — the booking fields this service needs
// (read from the bookings table owned by bt-booking-service).
// -----------------------------------------------------------
export type TrackingBooking = {
  id: string
  shipper_id: string
  driver_id: string | null
  status: string
  source_lat: number
  source_lng: number
  dest_lat: number
  dest_lng: number
}

// -----------------------------------------------------------
// TrackingError — domain error with HTTP status attached
// -----------------------------------------------------------
export type TrackingErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'UPSTREAM_ERROR'
  | 'NO_LOCATION'

export class TrackingError extends Error {
  public readonly code: TrackingErrorCode
  public readonly httpStatus: number

  constructor(message: string, code: TrackingErrorCode, httpStatus = 400) {
    super(message)
    this.name = 'TrackingError'
    this.code = code
    this.httpStatus = httpStatus
  }
}
