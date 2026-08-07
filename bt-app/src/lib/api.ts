// API client for bt-app — the unified BharatTruck front door (forked from the fleet
// console's client, which stays live as bt-fleet-console).
//
// Same shape as driver/src/lib/api.ts and shipper/src/lib/api.ts: every call goes
// through the gateway origin, paths are written WITHOUT the /api prefix, and a
// 401 triggers exactly one refresh attempt before bouncing to /login.
//
// Token keys are namespaced per app (driver uses bt_driver_token, shipper uses
// bt_token, the fleet console uses bt_fleet_*) so every BharatTruck front-end can be
// open in one browser without clobbering another's session. This app owns bt_app_*.

import type {
  AuthUser, MeResponse, FeedPage, FleetOwner, Vehicle, VehicleFinance, VehiclePermit, VehicleLane,
  FleetDriver, FleetSummary, VehicleAnalytics, DriverAnalytics, FuelComparison,
  LivePosition, FleetBooking, ModelCategory, Period,
  FleetOverview, Geofence,
  OpenAuction, FleetBid, Quote, NegotiationEntry, QuoteStatus,
  Booking, BookingType, ConsigneeInput,
  PriceQuote, PriceQuoteInput, PriceQuoteVehicleType,
  TrackData, DriverLocation,
} from './types'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'
const TOKEN_KEY = 'bt_app_token'
const REFRESH_KEY = 'bt_app_refresh_token'

// ── Token storage ─────────────────────────────────────────────

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(TOKEN_KEY)
  // Tokens are sometimes pasted by hand during QA; strip stray newlines the way
  // the shipper client does, otherwise the Authorization header is malformed.
  return raw ? raw.trim().replace(/[\r\n]+/g, '') : null
}

export function setToken(token: string) { localStorage.setItem(TOKEN_KEY, token) }
export function clearToken() { localStorage.removeItem(TOKEN_KEY) }

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(REFRESH_KEY)
}
export function setRefreshToken(token: string) { localStorage.setItem(REFRESH_KEY, token) }
export function clearRefreshToken() { localStorage.removeItem(REFRESH_KEY) }

// ── Errors ────────────────────────────────────────────────────

export class ApiError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN: 'That asset belongs to another fleet',
  NOT_FOUND: 'Not found',
  CONFLICT: 'That truck or driver is already on a live trip',
  INVALID_TRANSITION: 'That step is not allowed from the current status',
  NOT_IMPLEMENTED: 'Not available yet',
  MISCONFIGURED: 'Service is misconfigured — check with the team',
  UNAUTHORIZED: 'Session expired',
}

// ── Refresh (single-flight) ───────────────────────────────────

let refreshPromise: Promise<string> | null = null

async function tryRefresh(): Promise<string> {
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    const rt = getRefreshToken()
    if (!rt) throw new ApiError('Session expired', 'UNAUTHORIZED')
    const res = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new ApiError('Session expired', 'UNAUTHORIZED')
    setToken(json.data.access_token)
    return json.data.access_token as string
  })()
  try { return await refreshPromise } finally { refreshPromise = null }
}

function bounceToLogin(): never {
  clearToken()
  clearRefreshToken()
  if (typeof window !== 'undefined') window.location.href = '/login'
  throw new ApiError('Session expired', 'UNAUTHORIZED')
}

async function parse<T>(res: Response): Promise<T> {
  let json
  try { json = await res.json() } catch {
    throw new ApiError('Server error — please try again', 'NETWORK_ERROR')
  }

  if (!json.success) {
    // The gateway answers an UNROUTED path with its own nginx-shaped body,
    // {"error":"not_found","message":"No route matched this path"} — no `success`,
    // no `code`. Falling through to json.error there puts the literal string
    // "not_found" on screen, which tells the owner nothing. That is the exact state
    // when bt-fleet-service is not deployed or FLEET_SERVICE_URL is unset on the
    // gateway, so it is worth naming precisely rather than papering over.
    if (json.code === undefined && json.error === 'not_found') {
      throw new ApiError(
        'The fleet service is not reachable. It may not be deployed yet, or the gateway is not routing /api/fleet.',
        'SERVICE_UNAVAILABLE',
      )
    }
    if (res.status >= 500 && json.code === undefined) {
      throw new ApiError('The service is temporarily unavailable — please retry.', 'SERVICE_UNAVAILABLE')
    }

    const code = json.code || 'UNKNOWN'
    throw new ApiError(ERROR_MESSAGES[code] || json.error || json.message || 'Something went wrong', code)
  }

  return json.data
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) || {}),
  }

  let res = await fetch(`${API_BASE}/api${path}`, { ...options, headers })

  if (res.status === 401) {
    try {
      headers['Authorization'] = `Bearer ${await tryRefresh()}`
      res = await fetch(`${API_BASE}/api${path}`, { ...options, headers })
    } catch { bounceToLogin() }
    if (res.status === 401) bounceToLogin()
  }

  return parse<T>(res)
}

/** Auth calls: no auto-redirect, so a bad password shows an error instead of a bounce. */
async function authRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  return parse<T>(await fetch(`${API_BASE}/api${path}`, { ...options, headers }))
}

// ── Auth ──────────────────────────────────────────────────────

/**
 * NOTE the path: bt-auth-service mounts email auth at `/auth/email/login`, not
 * `/auth/login` — verified against the live gateway, which 404s the shorter form.
 * The response also carries `is_new_user`, which this console ignores.
 */
export function loginWithEmail(email: string, password: string) {
  return authRequest<{ access_token: string; refresh_token: string; user: AuthUser }>(
    '/auth/email/login', { method: 'POST', body: JSON.stringify({ email, password }) })
}

/**
 * The whole point of /auth/me for this app: it returns `personas.capabilities`,
 * which the shell gates every surface on. `personas` is null when the server could
 * not resolve them — the caller (lib/auth.tsx) falls back rather than blanking the UI.
 */
export function getMe() {
  return authRequest<MeResponse>('/auth/me')
}

export function refreshAccessToken(refresh_token: string) {
  return authRequest<{ access_token: string }>(
    '/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token }) })
}

// ── Home action feed (D-38) ───────────────────────────────────
//
// GET /api/me/feed → bt-booking-service. ONE ranked, capability-aware list of typed
// items — the server already resolves the caller's capabilities and queries only the
// sources they touch, so the client renders whatever comes back without re-deriving
// persona logic (exactly what the capability model moved off the client). Authorized
// purely by the caller's JWT; the feed only ever contains the caller's own items.
export function getMyFeed(opts?: { limit?: number; offset?: number }) {
  const qs = new URLSearchParams()
  if (opts?.limit != null) qs.set('limit', String(opts.limit))
  if (opts?.offset != null) qs.set('offset', String(opts.offset))
  const suffix = qs.toString() ? `?${qs}` : ''
  return request<FeedPage>(`/me/feed${suffix}`)
}

// ── Owner profile ─────────────────────────────────────────────

export function getMyFleet() { return request<FleetOwner>('/fleet/owners/me') }

export function updateMyFleet(body: Partial<FleetOwner>) {
  return request<FleetOwner>('/fleet/owners/me', { method: 'PATCH', body: JSON.stringify(body) })
}

export function registerFleet(body: { company_name: string; gstin?: string; pan?: string; city?: string; state?: string }) {
  return request<FleetOwner>('/fleet/owners', { method: 'POST', body: JSON.stringify(body) })
}

// ── Drivers ───────────────────────────────────────────────────

export function listFleetDrivers() { return request<FleetDriver[]>('/fleet/drivers') }

/** Invites an EXISTING driver account. We never create driver identities. */
export function inviteDriver(driver_phone: string) {
  return request<FleetDriver>('/fleet/drivers/invite', {
    method: 'POST', body: JSON.stringify({ driver_phone }),
  })
}

export function updateFleetDriver(id: string, body: { monthly_salary_inr?: number; status?: 'suspended' | 'active' }) {
  return request<FleetDriver>(`/fleet/drivers/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function removeFleetDriver(id: string) {
  return request<{ id: string }>(`/fleet/drivers/${id}`, { method: 'DELETE' })
}

// ── Vehicles ──────────────────────────────────────────────────

export function listVehicles() { return request<Vehicle[]>('/fleet/vehicles') }

export function getVehicle(id: string) {
  return request<{
    vehicle: Vehicle
    finance: VehicleFinance | null
    permits: VehiclePermit[]
    lanes: VehicleLane[]
  }>(`/fleet/vehicles/${id}`)
}

export function createVehicle(body: Partial<Vehicle>) {
  return request<Vehicle>('/fleet/vehicles', { method: 'POST', body: JSON.stringify(body) })
}

export function updateVehicle(id: string, body: Partial<Vehicle>) {
  return request<Vehicle>(`/fleet/vehicles/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export type BulkImportFormat = 'csv' | 'xlsx' | 'pdf' | 'image'

export type BulkImportError = { row: number; rc_number: string | null; message: string }

/** Field names copied verbatim from bt-fleet-service/src/lib/bulk-import.ts:28-32. */
export type BulkImportResult = {
  imported: number
  skipped: number
  errors: BulkImportError[]
}

/**
 * Bulk truck onboarding. Only `csv` actually parses today — xlsx/pdf/image return
 * 501 NOT_IMPLEMENTED because the OCR step is stubbed. The UI must say so rather
 * than implying a scanned RC book will be read.
 *
 * Partial success is normal: rows that fail validation are counted in `skipped`
 * with a per-row reason, and the request still returns 200.
 */
export function bulkImportVehicles(format: BulkImportFormat, content: string) {
  return request<BulkImportResult>('/fleet/vehicles/bulk', {
    method: 'POST', body: JSON.stringify({ format, content }),
  })
}

export function setVehicleFinance(id: string, body: Partial<VehicleFinance>) {
  return request<VehicleFinance>(`/fleet/vehicles/${id}/finance`, { method: 'PUT', body: JSON.stringify(body) })
}

export function setVehiclePermits(id: string, permits: Partial<VehiclePermit>[]) {
  return request<VehiclePermit[]>(`/fleet/vehicles/${id}/permits`, { method: 'PUT', body: JSON.stringify({ permits }) })
}

export function setVehicleLanes(id: string, lanes: Partial<VehicleLane>[]) {
  return request<VehicleLane[]>(`/fleet/vehicles/${id}/lanes`, { method: 'PUT', body: JSON.stringify({ lanes }) })
}

export function listModelCategories() {
  return request<ModelCategory[]>('/fleet/vehicles/model-categories')
}

// ── Bookings + the assign step ────────────────────────────────

export function listFleetBookings(status?: string) {
  return request<FleetBooking[]>(`/fleet/bookings${status ? `?status=${encodeURIComponent(status)}` : ''}`)
}

/** The pairing step. Until this exists, accepted -> in_transit is blocked. */
export function assignToBooking(bookingId: string, driver_id: string, vehicle_id: string) {
  return request<{ id: string; booking_id: string; driver_id: string; vehicle_id: string }>(
    `/fleet/bookings/${bookingId}/assign`, { method: 'POST', body: JSON.stringify({ driver_id, vehicle_id }) })
}

// ── Live map ──────────────────────────────────────────────────

/**
 * All vehicle positions in ONE call. The service serves this from a single Redis
 * SMEMBERS + MGET — never poll per-vehicle endpoints from here, that is 100 req/s
 * at 1000 trucks on a 10s interval.
 */
export function getLivePositions() { return request<LivePosition[]>('/fleet/live') }

// ── Analytics ─────────────────────────────────────────────────

function periodQS(p?: Partial<Period>) {
  if (!p?.from && !p?.to) return ''
  const qs = new URLSearchParams()
  if (p.from) qs.set('from', p.from)
  if (p.to) qs.set('to', p.to)
  return `?${qs}`
}

export function getFleetSummary(p?: Partial<Period>) {
  return request<FleetSummary>(`/fleet/analytics/summary${periodQS(p)}`)
}

export function getVehicleAnalytics(p?: Partial<Period>) {
  return request<{ period: Period; vehicles: VehicleAnalytics[] }>(
    `/fleet/analytics/vehicles${periodQS(p)}`)
}

export function getOneVehicleAnalytics(id: string, p?: Partial<Period>) {
  return request<{ period: Period } & VehicleAnalytics>(
    `/fleet/analytics/vehicles/${id}${periodQS(p)}`)
}

export function getDriverAnalytics(p?: Partial<Period>) {
  return request<{ period: Period; drivers: DriverAnalytics[] }>(
    `/fleet/analytics/drivers${periodQS(p)}`)
}

export function getFuelComparison(p?: Partial<Period>) {
  return request<FuelComparison>(`/fleet/analytics/fuel${periodQS(p)}`)
}

// ── Live fleet tracking (bt-tracking-service, via the gateway) ────────────────

/**
 * Every truck in the fleet with position, trip, telemetry, fuel and open alerts —
 * in ONE call.
 *
 * Note the service: this is bt-tracking-service (`/api/tracking/...`), not
 * bt-fleet-service's `/fleet/live`. The two are deliberately different shapes —
 * `/fleet/live` iterates DRIVERS and so omits any truck without one, which is
 * exactly the blind spot an owner's board must not have. Use this for the board;
 * `/fleet/live` remains the cheap position-only feed.
 *
 * Cost: the service answers from one Redis MGET plus bounded Postgres reads and
 * makes NO Google call, so a 10s poll is safe. Route and ETA stay lazy — fetch
 * them for one selected truck, never for the whole list.
 */
export function getFleetOverview() {
  return request<FleetOverview>('/tracking/fleet/overview')
}

export function listGeofences() {
  return request<Geofence[]>('/tracking/fleet/geofences')
}

export function createGeofence(body: {
  name: string
  kind: Geofence['kind']
  lat: number
  lng: number
  radius_m: number
}) {
  return request<Geofence>('/tracking/fleet/geofences', {
    method: 'POST', body: JSON.stringify(body),
  })
}

export function deleteGeofence(id: string) {
  return request<{ id: string; deleted: boolean }>(`/tracking/fleet/geofences/${id}`, {
    method: 'DELETE',
  })
}

/** One trip's full analytics record — planned vs driven, dwell, geofence events. */
export function getTripSummary(bookingId: string) {
  return request<Record<string, unknown>>(`/tracking/summary/${bookingId}`)
}

/** Traveled breadcrumb trail for the replay/trail layer. */
export function getTripHistory(bookingId: string) {
  return request<{
    booking_id: string
    point_count: number
    points: { lat: number; lng: number; speed_kmh: number | null; heading: number | null; recorded_at: string }[]
  }>(`/tracking/history/${bookingId}`)
}

// ── Auction bidding ───────────────────────────────────────────
//
// READS come from bt-fleet-service, WRITES from bt-booking-service, and the split is
// deliberate. `/fleet/auctions` and `/fleet/bids` are tenant-scoped list queries, which
// is what the fleet service owns. Bid writes reuse `/bookings/:id/quotes*`, which
// already accept a fleet owner as a bidder and already enforce the auction-deadline,
// duplicate-bid and fleet-affiliated-driver rules. Re-implementing those writes here —
// or proxying them through the fleet service — would fork the auction rules across two
// services and let them drift.
//
// Note what /fleet/bookings could NOT do: `bookings.fleet_owner_id` is written only when
// a shipper ACCEPTS a quote, so it can only ever return auctions already won. Live,
// countered and lost bids live on `quotes.fleet_owner_id`, which is what /fleet/bids reads.

/** Open loads this fleet may bid on, each annotated with its own bid if it has one. */
export function listOpenAuctions(opts?: { include_expired?: boolean }) {
  const qs = opts?.include_expired ? '?include_expired=true' : ''
  return request<{ fleet_owner_id: string; count: number; auctions: OpenAuction[] }>(
    `/fleet/auctions${qs}`,
  )
}

/** Every bid this fleet has placed, newest first, with its load attached. */
export function listMyBids(status?: QuoteStatus) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : ''
  return request<{ fleet_owner_id: string; count: number; bids: FleetBid[] }>(`/fleet/bids${qs}`)
}

/**
 * Place a bid. 409 CONFLICT means this fleet already has a live quote on the load
 * (the DB enforces one per bidder), and 409 AUCTION_CLOSED means the deadline passed
 * or the booking left pending/negotiating.
 */
export function placeBid(bookingId: string, amount: number, message?: string) {
  return request<Quote>(`/bookings/${bookingId}/quotes`, {
    method: 'POST',
    body: JSON.stringify({ amount, ...(message ? { message } : {}) }),
  })
}

/** Counter the shipper's counter-offer. Only legal while the quote is `countered`. */
export function counterBid(bookingId: string, quoteId: string, amount: number, message?: string) {
  return request<Quote>(`/bookings/${bookingId}/quotes/${quoteId}/counter`, {
    method: 'PATCH',
    body: JSON.stringify({ amount, ...(message ? { message } : {}) }),
  })
}

/** Pull a live bid. Frees the fleet to re-bid, since the unique index only covers live rows. */
export function withdrawBid(bookingId: string, quoteId: string) {
  return request<Quote>(`/bookings/${bookingId}/quotes/${quoteId}/withdraw`, { method: 'PATCH' })
}

/** The full price thread for one bid — every offer and counter, oldest first. */
export function getBidHistory(bookingId: string, quoteId: string) {
  return request<NegotiationEntry[]>(`/bookings/${bookingId}/quotes/${quoteId}/history`)
}

// ── Ship surfaces (Post a Load / My Loads / load detail — Phase 2) ─────────────
//
// The shipper flow, ported from shipper/src/lib/api.ts into this client's style:
// every call goes through `request` (gateway origin, `/api` prefix added here,
// snake_case JSON, {success,data} envelope, one refresh on 401). bt-app talks to
// bt-booking-service (`/bookings`, `/quotes`), bt-pricing-service (`/pricing`) and
// bt-tracking-service (`/tracking`, `/location`) — all through the gateway.

/** The caller's bookings. A shipper gets the loads THEY posted; each row carries a
 *  `viewer` block naming the caller's relations so My Loads can keep only its own. */
export function listBookings() {
  return request<Booking[]>('/bookings/')
}

export function getBooking(id: string) {
  return request<Booking>(`/bookings/${id}`)
}

/**
 * The booking-create payload. The shipper sends the price-lock HANDLE (`quote_id`),
 * never a raw price — the server resolves quoted_price from the locked price_quotes
 * row (price SHOWN == price CHARGED). D-29: a load must name a reachable consignee,
 * so `consignee` (name + phone) is required here; `receiver_email` is the optional
 * legacy POD inbox. The same coords + vehicle_type that were priced must be sent so
 * the booking binds to the locked quote (the server rejects a mismatch).
 */
export type CreateBookingPayload = {
  quote_id: string
  source_address: string
  source_lat: number
  source_lng: number
  destination_address: string
  dest_lat: number
  dest_lng: number
  load_type: string
  weight_kg: number
  vehicle_type: PriceQuoteVehicleType
  pickup_date: string
  pickup_time_slot?: string
  special_instructions?: string
  consignee: ConsigneeInput
  receiver_email?: string
  booking_type: BookingType
  target_driver_id?: string
  auction_deadline?: string
}

export function createBooking(payload: CreateBookingPayload) {
  // Strip empties so an optional field never reaches the server as '' — the
  // consignee's own optional fields (email/gstin/…) are pruned the same way,
  // because an empty string there fails validation rather than being ignored.
  const consignee = Object.fromEntries(
    Object.entries(payload.consignee).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  )
  const clean = Object.fromEntries(
    Object.entries({ ...payload, consignee }).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  )
  return request<Booking>('/bookings/', { method: 'POST', body: JSON.stringify(clean) })
}

export function cancelBooking(id: string) {
  return request<Booking>(`/bookings/${id}/cancel`, { method: 'PATCH' })
}

/**
 * Set (or correct) the consignee inbox the delivery code is emailed to. The only
 * field on a live booking a shipper may change mid-trip; the server rejects it once
 * the booking is completed/paid/cancelled.
 */
export function setReceiverEmail(id: string, receiverEmail: string) {
  return request<Booking>(`/bookings/${id}/receiver-email`, {
    method: 'PATCH', body: JSON.stringify({ receiver_email: receiverEmail }),
  })
}

// ── Quotes on a load (shipper side of the auction) ────────────────────────────

export function getQuotes(bookingId: string) {
  return request<Quote[]>(`/bookings/${bookingId}/quotes`)
}

/** Award the load to this bid. */
export function acceptQuote(bookingId: string, quoteId: string) {
  return request<Quote>(`/bookings/${bookingId}/quotes/${quoteId}/accept`, { method: 'PATCH' })
}

/** Counter the carrier's bid. Legal while the quote is submitted/countered. */
export function counterQuote(bookingId: string, quoteId: string, body: { amount: number; message?: string }) {
  return request<Quote>(`/bookings/${bookingId}/quotes/${quoteId}/counter`, {
    method: 'PATCH', body: JSON.stringify(body),
  })
}

export function rejectQuote(bookingId: string, quoteId: string) {
  return request<Quote>(`/bookings/${bookingId}/quotes/${quoteId}/reject`, { method: 'PATCH' })
}

// ── Advisory pricing (bt-pricing-service, D-11) ────────────────────────────────
//
// The number is a REFERENCE, not a charge, on an auction. The server classifies it
// (`quote_kind`) and authors the disclosure sentence (`basis`); these helpers show
// the server's record and fall back to the requested booking type only against a
// pricing service that predates D-11 (where an auction must never read as binding).

export function getPriceQuote(payload: PriceQuoteInput) {
  return request<PriceQuote>('/pricing/quote', { method: 'POST', body: JSON.stringify(payload) })
}

export function quoteKindOf(quote: PriceQuote, requestedFor?: BookingType): 'advisory' | 'binding' {
  if (quote.quote_kind) return quote.quote_kind
  return requestedFor === 'auction' ? 'advisory' : 'binding'
}

export function priceQuoteHeading(quote: PriceQuote, requestedFor?: BookingType): string {
  return quoteKindOf(quote, requestedFor) === 'advisory' ? 'Estimated price' : 'Locked price'
}

export function priceQuoteBasis(quote: PriceQuote, requestedFor?: BookingType): string {
  if (quote.basis) return quote.basis
  return quoteKindOf(quote, requestedFor) === 'advisory'
    ? "Reference estimate — you pay the winning carrier's bid, not this number."
    : 'This is the price charged for this booking.'
}

// ── Live tracking (bt-tracking-service, via the gateway) ──────────────────────

/**
 * One read-through call (LOCKED D-8) for the shipper live map: current location +
 * base route + live ETA + status + alerts. Poll every 10s while in transit (D-10).
 */
export function getTrack(bookingId: string) {
  return request<TrackData>(`/tracking/track/${bookingId}`)
}

/** The latest raw driver fix for a booking; null until the driver shares location. */
export function getBookingLocation(bookingId: string) {
  return request<DriverLocation | null>(`/location/booking/${bookingId}`)
}
