import type { Booking, BookingType, Quote, NegotiationEntry } from './types'
import { storageKey } from './session-keys'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'
// FB-10: pass ?profile=<slug> to partition tokens for multi-account QA.
const TOKEN_KEY_BASE = 'bt_token'
const REFRESH_KEY_BASE = 'bt_refresh_token'
const TOKEN_KEY = () => storageKey(TOKEN_KEY_BASE)
const REFRESH_KEY = () => storageKey(REFRESH_KEY_BASE)

// ── Token storage ─────────────────────────────────────────────

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(TOKEN_KEY())
  return raw ? raw.trim().replace(/[\r\n]+/g, '') : null
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY(), token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY())
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(REFRESH_KEY())
}

export function setRefreshToken(token: string) {
  localStorage.setItem(REFRESH_KEY(), token)
}

export function clearRefreshToken() {
  localStorage.removeItem(REFRESH_KEY())
}

// ── Error handling ────────────────────────────────────────────

export class ApiError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  AUCTION_CLOSED: 'This booking is no longer accepting quotes',
  DUPLICATE_QUOTE: "You've already submitted a quote for this booking",
  QUOTE_NOT_FOUND: 'Quote not found — it may have been removed',
  ALREADY_AWARDED: 'This booking has already been awarded',
  NOT_FOUND: 'Booking not found',
  DRIVER_PROFILE_NOT_FOUND: 'Driver profile not found for this user',
  FORBIDDEN: 'You do not have permission for this action',
}

// ── Token refresh mutex ──────────────────────────────────────

let refreshPromise: Promise<string> | null = null

async function tryRefresh(): Promise<string> {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    const rt = getRefreshToken()
    if (!rt) throw new Error('No refresh token')

    const { access_token } = await refreshAccessToken(rt)
    setToken(access_token)
    return access_token
  })()

  try {
    return await refreshPromise
  } finally {
    refreshPromise = null
  }
}

// ── Authenticated request (booking/quote APIs) ────────────────

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()

  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> || {}),
  }
  if (options.body) {
    headers['Content-Type'] = 'application/json'
  }

  let res = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    headers,
  })

  if (res.status === 401) {
    try {
      const newToken = await tryRefresh()
      headers['Authorization'] = `Bearer ${newToken}`
      res = await fetch(`${API_BASE}/api${path}`, { ...options, headers })
    } catch {
      clearToken()
      clearRefreshToken()
      if (typeof window !== 'undefined') {
        window.location.href = '/login'
      }
      throw new ApiError('Session expired', 'UNAUTHORIZED')
    }

    if (res.status === 401) {
      clearToken()
      clearRefreshToken()
      if (typeof window !== 'undefined') {
        window.location.href = '/login'
      }
      throw new ApiError('Session expired', 'UNAUTHORIZED')
    }
  }

  let json
  try {
    json = await res.json()
  } catch {
    throw new ApiError('Server error — please try again', 'NETWORK_ERROR')
  }

  if (!json.success) {
    const code = json.code || 'UNKNOWN'
    const message = ERROR_MESSAGES[code] || json.message || json.error || 'Something went wrong'
    throw new ApiError(message, code)
  }

  return json.data
}

// ── Auth request (no auto-redirect, returns parsed data) ──────

async function authRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()

  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> || {}),
  }
  if (options.body) {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(`${API_BASE}/api${path}`, { ...options, headers })

  let json
  try {
    json = await res.json()
  } catch {
    throw new ApiError('Server error — please try again', 'NETWORK_ERROR')
  }

  if (!json.success) {
    const code = json.code || 'UNKNOWN'
    const message = json.message || json.error || 'Something went wrong'
    throw new ApiError(message, code)
  }

  return json.data
}

// ── Bookings ──────────────────────────────────────────────────

export function listBookings(): Promise<Booking[]> {
  return request<Booking[]>('/bookings/')
}

export function getBooking(id: string): Promise<Booking> {
  return request<Booking>(`/bookings/${id}`)
}

// ── Payments (cash-recorded settlement — NO escrow/Razorpay) ──
// Real bt-payment-service wiring, reached through the gateway at
// `/api/payments/*`. JWT-gated (shipper|admin) + booking-ownership.
// Snake_case JSON, {success,data} envelope. Mirrors payment-service.ts.

export type PaymentMode = 'cash' | 'upi' | 'direct'

export interface PaymentRecord {
  booking_id: string
  amount: number
  mode: PaymentMode
  reference: string | null
  recorded_by: string
  status: 'recorded'
}

export interface PayoutRecord {
  booking_id: string
  driver_id: string | null
  amount: number
  mode: PaymentMode | null
  status: 'pending' | 'recorded'
  recorded_by: string | null
}

export interface PaymentStatus {
  booking_id: string
  payment: PaymentRecord | null
  payout: PayoutRecord | null
}

export interface SettleResult extends PaymentStatus {
  status: string
  already_settled: boolean
}

export function settlePayment(
  bookingId: string,
  body: { amount: number; mode: PaymentMode; reference?: string },
): Promise<SettleResult> {
  return request<SettleResult>('/payments/settle', {
    method: 'POST',
    body: JSON.stringify({
      booking_id: bookingId,
      amount: body.amount,
      mode: body.mode,
      reference: body.reference,
    }),
  })
}

export function getPaymentStatus(bookingId: string): Promise<PaymentStatus> {
  return request<PaymentStatus>(`/payments/status/${bookingId}`)
}

// ── Quotes ────────────────────────────────────────────────────

export function getQuotes(bookingId: string): Promise<Quote[]> {
  return request<Quote[]>(`/bookings/${bookingId}/quotes`)
}

export function submitQuote(
  bookingId: string,
  body: { amount: number; message?: string }
): Promise<Quote> {
  return request<Quote>(`/bookings/${bookingId}/quotes`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function counterQuote(
  bookingId: string,
  quoteId: string,
  body: { amount: number; message?: string }
): Promise<Quote> {
  return request<Quote>(`/bookings/${bookingId}/quotes/${quoteId}/counter`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function acceptQuote(bookingId: string, quoteId: string): Promise<Quote> {
  return request<Quote>(`/bookings/${bookingId}/quotes/${quoteId}/accept`, {
    method: 'PATCH',
  })
}

export function rejectQuote(bookingId: string, quoteId: string): Promise<Quote> {
  return request<Quote>(`/bookings/${bookingId}/quotes/${quoteId}/reject`, {
    method: 'PATCH',
  })
}

export function withdrawQuote(bookingId: string, quoteId: string): Promise<Quote> {
  return request<Quote>(`/bookings/${bookingId}/quotes/${quoteId}/withdraw`, {
    method: 'PATCH',
  })
}

export interface CreateBookingPayload {
  source_address: string
  source_lat: number
  source_lng: number
  destination_address: string
  dest_lat: number
  dest_lng: number
  load_type: string
  weight_kg: number
  // Same truck class that was priced; the server binds it to the locked quote
  // (mismatch → 4xx). Must be the exact vehicle_type sent to POST /pricing/quote.
  vehicle_type: PriceQuoteVehicleType
  // The price-lock handle from POST /pricing/quote — NOT a raw price. The server
  // resolves quoted_price from the locked price_quotes row (price SHOWN == charged).
  quote_id: string
  pickup_date: string
  pickup_time_slot?: string
  special_instructions?: string
  // Consignee inbox the delivery-confirmation code is emailed to. Required —
  // a booking without it can never be confirmed as delivered by the receiver.
  receiver_email: string
  // The shared union, not a re-typed literal. This field and PriceQuoteInput's
  // must be the SAME type: they are two halves of one booking, and the quote is
  // only labelled correctly if it was priced for the booking that is then created.
  booking_type: BookingType
  target_driver_id?: string
  auction_deadline?: string
}

export function createBooking(payload: CreateBookingPayload): Promise<Booking> {
  const clean = Object.fromEntries(
    Object.entries(payload).filter(([, v]) => v !== undefined && v !== null && v !== '')
  )
  return request<Booking>('/bookings/', {
    method: 'POST',
    body: JSON.stringify(clean),
  })
}

export function cancelBooking(id: string): Promise<Booking> {
  return request<Booking>(`/bookings/${id}/cancel`, {
    method: 'PATCH',
  })
}

/**
 * Set (or correct) the consignee inbox the delivery code is emailed to.
 *
 * `receiver_email` is required when creating a booking, but the column is
 * nullable and most existing bookings predate that rule — and without an address
 * the driver's proof-of-delivery request has nowhere to send the code, so the
 * trip can never be confirmed delivered. This is the only field on a live booking
 * a shipper may change mid-trip; everything else is price-locked or driven by the
 * trip state machine.
 *
 * Server rejects it once the booking is completed/paid/cancelled.
 */
export function setReceiverEmail(id: string, receiverEmail: string): Promise<Booking> {
  return request<Booking>(`/bookings/${id}/receiver-email`, {
    method: 'PATCH',
    body: JSON.stringify({ receiver_email: receiverEmail }),
  })
}

// ── Price quote-lock (bt-pricing-service) ─────────────────────
// POST /api/pricing/quote → the gateway rewrites to /pricing/quote. Returns a
// locked quote: the price SHOWN here is the price CHARGED at booking (PRD 5.4).
// The shipper captures `quote_id` and sends it (not a raw price) on create.

export type PriceQuoteVehicleType = 'mini_truck' | 'lcv' | 'hcv' | 'trailer'
export type PriceQuoteLoadType =
  | 'general'
  | 'fragile'
  | 'perishable'
  | 'hazardous'
  | 'heavy_machinery'

export interface PriceQuoteInput {
  // The booking's route; the server DERIVES distance_km from these coords (never
  // client-supplied) and prices from it. Send the SAME coords on booking-create so
  // the booking binds to the priced trip.
  source_lat: number
  source_lng: number
  dest_lat: number
  dest_lng: number
  vehicle_type: PriceQuoteVehicleType
  load_type: PriceQuoteLoadType
  weight_kg: number
  /**
   * What the quote is for — the SAME union as CreateBookingPayload.booking_type,
   * imported rather than re-spelled. Two literal unions describing one field is
   * how they drift, and a drifted value here would be silently classified as
   * binding by the server rather than rejected.
   *
   * Optional on the wire so a caller written before D-11 still works, but always
   * send it: on an auction the platform has no price of its own, and the omitted
   * default is `binding` — the wrong answer for most bookings, written into the
   * persisted quote (see PriceQuote.quote_kind).
   */
  booking_type?: BookingType
}

export interface PriceQuoteBreakdown {
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

export interface PriceQuote {
  quote_id: string
  quoted_price: number
  currency: string
  expires_at: string
  breakdown: PriceQuoteBreakdown
  // Commercial split (superset of what pricing returns today; the UI renders these).
  base_price: number
  weight_surcharge: number
  /**
   * Fixed per-trip loading/handling cost, passed through at cost. Billed on top
   * of the per-km base — a purely distance-based price left it uncovered, and
   * the shorter the trip the bigger the hole.
   *
   * The cost-side twin of this number is already rendered from
   * `breakdown.handling`, so the UI needs no change to show it.
   */
  handling_fee: number
  /** The rate actually applied, derived from the cost model. Lets the UI show its working. */
  rate_per_km: number
  total_price: number
  platform_fee: number
  shipper_pays: number
  driver_receives: number
  version: string
  /**
   * Whether `quoted_price` is the charge (`binding`) or a benchmark (`advisory`).
   *
   * On an auction it is advisory: the shipper pays the winning carrier's bid,
   * and this number is a reference. Optional because a server that predates
   * D-11 does not send it — resolve a missing value through quoteKindOf(), which
   * needs the booking type the quote was requested for.
   */
  quote_kind?: 'advisory' | 'binding'
  /** Server-authored sentence explaining where the number came from. */
  basis?: string
}

/**
 * What this quote IS, for display.
 *
 * Prefer the server's classification: it is the one that was persisted, and the
 * panel should show the record rather than the caller's intention.
 *
 * `requestedFor` is the booking type the quote was fetched for, and it is what
 * makes the missing-field case safe. The services deploy independently, so the
 * app can be live against a pricing service that predates D-11 and returns no
 * quote_kind at all. Defaulting that to `binding` — mirroring the SERVER's wire
 * default — would put "Locked Price ... this is the price charged" over an
 * auction estimate, which is the platform asserting it charges a freight rate it
 * does not set (INDIA_FREIGHT_COMPLIANCE.md §1.3 red line 3). The wire default
 * exists to protect old CALLERS from a behaviour change; it is not a safe
 * display default, and the two must not be conflated. The form always knows
 * which it asked for, so fall back to that.
 */
export function quoteKindOf(quote: PriceQuote, requestedFor?: BookingType): 'advisory' | 'binding' {
  if (quote.quote_kind) return quote.quote_kind
  return requestedFor === 'auction' ? 'advisory' : 'binding'
}

/**
 * Heading for the quote panel.
 *
 * "Locked Price" over an auction estimate is a claim the platform is charging
 * that number, which it is not — the charge is the winning carrier's bid.
 */
export function priceQuoteHeading(quote: PriceQuote, requestedFor?: BookingType): string {
  return quoteKindOf(quote, requestedFor) === 'advisory' ? 'Estimated Price' : 'Locked Price'
}

/**
 * The sentence shown under the quote.
 *
 * Prefers the server's `basis` so the disclosure travels with the number it
 * describes and cannot drift from the arithmetic. The local copy is the fallback
 * for a pre-D-11 server, and is resolved through quoteKindOf() for the reason
 * given there — an auction must never fall back to the binding sentence.
 */
export function priceQuoteBasis(quote: PriceQuote, requestedFor?: BookingType): string {
  if (quote.basis) return quote.basis
  return quoteKindOf(quote, requestedFor) === 'advisory'
    ? "Reference estimate — you pay the winning carrier's bid, not this number."
    : 'This is the price charged for this booking.'
}

export function getPriceQuote(payload: PriceQuoteInput): Promise<PriceQuote> {
  return request<PriceQuote>('/pricing/quote', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getQuoteHistory(
  bookingId: string,
  quoteId: string
): Promise<NegotiationEntry[]> {
  return request<NegotiationEntry[]>(`/bookings/${bookingId}/quotes/${quoteId}/history`)
}

// ── Location tracking ────────────────────────────────────────

export interface DriverLocation {
  driver_id: string
  lat: number
  lng: number
  heading: number | null
  speed_kmh: number | null
  accuracy_m: number | null
  booking_id: string | null
  updated_at: string
}

export function getBookingLocation(bookingId: string): Promise<DriverLocation | null> {
  return request<DriverLocation | null>(`/location/booking/${bookingId}`)
}

// ── Route (Maps & Tracking) ──────────────────────────────────
// Cached base polyline from bt-tracking-service (Routes Essentials),
// reached through the gateway at `/api/tracking/route/:bookingId`.
// Snake_case JSON per the frozen Maps/Tracking contract. Static per
// booking → fetch once; the server caches it (long Redis TTL).

export interface RouteBounds {
  ne_lat: number
  ne_lng: number
  sw_lat: number
  sw_lng: number
}

export interface RouteData {
  polyline: string
  distance_m: number
  static_duration_s: number
  bounds: RouteBounds
  cached: boolean
}

export function getRoute(bookingId: string): Promise<RouteData> {
  return request<RouteData>(`/tracking/route/${bookingId}`)
}

// ── Live tracking read-through aggregate (LOCKED D-#8) ───────
// GET /api/tracking/track/:bookingId — ONE call for the shipper live map:
// current location + base route + live ETA + status + alerts. Poll every 10s
// (D-010). Snake_case, {success,data} envelope. Mirrors bt-tracking-service
// src/routes/tracking.ts `/track/:bookingId`.

export interface TrackLocation {
  lat: number
  lng: number
  heading: number | null
  speed_kmh: number | null
  updated_at: string
}

export interface TrackEta {
  eta_s: number
  eta_text: string
  remaining_m: number
  traffic: string
  computed_at: string
  stale: boolean
}

export interface TrackAlert {
  id: string
  type: string
  message: string | null
  lat: number | null
  lng: number | null
  acknowledged: boolean
  created_at: string
}

export interface TrackData {
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
  destination: {
    lat: number
    lng: number
  }
  alerts: TrackAlert[]
}

export function getTrack(bookingId: string): Promise<TrackData> {
  return request<TrackData>(`/tracking/track/${bookingId}`)
}

// ── Auth types ────────────────────────────────────────────────

export interface AuthUser {
  id: string
  phone: string | null
  email: string | null
  full_name: string | null
  avatar_url: string | null
  role: string
  email_verified?: boolean
  google_sub?: string | null
  created_at?: string
}

export interface AuthResponse {
  access_token: string
  refresh_token: string
  is_new_user: boolean
  user: AuthUser
}

// ── Auth API ──────────────────────────────────────────────────

export function sendPhoneOtp(phone: string) {
  return authRequest<{ message: string; expires_in: number }>('/auth/send-otp', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  })
}

export function verifyPhoneOtp(phone: string, otp: string) {
  return authRequest<AuthResponse>('/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ phone, otp }),
  })
}

export function googleSignIn(idToken: string, role: string) {
  return authRequest<AuthResponse>('/auth/google', {
    method: 'POST',
    body: JSON.stringify({ id_token: idToken, role }),
  })
}

export function emailRegister(email: string, password: string, fullName: string, role: string) {
  return authRequest<{ message: string; email_verified: boolean; user_id: string; expires_in: number }>(
    '/auth/email/register',
    { method: 'POST', body: JSON.stringify({ email, password, full_name: fullName, role }) },
  )
}

export function emailVerify(email: string, otp: string) {
  return authRequest<AuthResponse>('/auth/email/verify', {
    method: 'POST',
    body: JSON.stringify({ email, otp }),
  })
}

export function emailLogin(email: string, password: string) {
  return authRequest<AuthResponse>('/auth/email/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export function emailResendOtp(email: string) {
  return authRequest<{ message: string; expires_in: number }>('/auth/email/resend-otp', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export function refreshAccessToken(refreshToken: string) {
  return authRequest<{ access_token: string }>('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
}

export function getMe() {
  return authRequest<{ user: AuthUser }>('/auth/me')
}

export function registerProfile(body: { full_name: string; role: string; email?: string }) {
  return authRequest<{ user: AuthUser }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function authLogout() {
  return authRequest<{ message: string }>('/auth/logout', { method: 'POST' })
}

/**
 * Always resolves with the same generic message whether or not the address is
 * on file — the server refuses to confirm an account exists, and silently
 * absorbs its own rate limit. The UI must not imply an account was found.
 */
export function forgotPassword(email: string, callbackUrl?: string) {
  return authRequest<{ message: string }>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email, ...(callbackUrl ? { callback_url: callbackUrl } : {}) }),
  })
}

/** Single-use token from the emailed link; also revokes every existing session. */
export function resetPassword(token: string, password: string) {
  return authRequest<{ message: string }>('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  })
}
