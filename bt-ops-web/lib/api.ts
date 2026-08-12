import { storageKey } from './session-keys'
// Ops-console API client. Talks to the backend ONLY through the gateway
// (NEXT_PUBLIC_API_URL -> /api/*), same envelope + custom-HS256-JWT auth as the
// shipper/driver apps. Ops uses an ops/admin-role JWT from /auth/email/login.

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'
// FB-10: pass ?profile=<slug> to partition tokens for multi-account QA.
const TOKEN_KEY_BASE = 'bt_ops_token'
const REFRESH_KEY_BASE = 'bt_ops_refresh_token'
const TOKEN_KEY = () => storageKey(TOKEN_KEY_BASE)
const REFRESH_KEY = () => storageKey(REFRESH_KEY_BASE)

// ── Token storage ─────────────────────────────────────────────

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(TOKEN_KEY())
  return raw ? raw.trim() : null
}
export function setToken(t: string) { localStorage.setItem(TOKEN_KEY(), t) }
export function clearToken() { localStorage.removeItem(TOKEN_KEY()) }
export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(REFRESH_KEY())
}
export function setRefreshToken(t: string) { localStorage.setItem(REFRESH_KEY(), t) }
export function clearRefreshToken() { localStorage.removeItem(REFRESH_KEY()) }

export function clearSession() {
  clearToken()
  clearRefreshToken()
}

// ── JWT helpers (decode only — the gateway/services verify) ────

export interface JwtClaims {
  userId: string
  role: string
  exp?: number
}

/** Decode a JWT payload client-side to read role/exp. NOT verification. */
export function decodeJwt(token: string): JwtClaims | null {
  try {
    const payload = token.split('.')[1]
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(json) as JwtClaims
  } catch {
    return null
  }
}

export const OPS_ROLES = ['ops', 'admin'] as const
export function isOpsRole(role: string | undefined | null): boolean {
  return !!role && (OPS_ROLES as readonly string[]).includes(role)
}

// ── Errors ────────────────────────────────────────────────────

export class ApiError extends Error {
  code: string
  status: number
  constructor(message: string, code: string, status = 0) {
    super(message)
    this.code = code
    this.status = status
  }
}

// ── Request wrappers ──────────────────────────────────────────

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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) || {}),
  }
  if (options.body) headers['Content-Type'] = 'application/json'

  let res = await fetch(`${API_BASE}/api${path}`, { ...options, headers })

  if (res.status === 401) {
    try {
      const newToken = await tryRefresh()
      headers['Authorization'] = `Bearer ${newToken}`
      res = await fetch(`${API_BASE}/api${path}`, { ...options, headers })
    } catch {
      clearSession()
      if (typeof window !== 'undefined') window.location.href = '/login'
      throw new ApiError('Session expired', 'UNAUTHORIZED', 401)
    }
  }

  let json: { success?: boolean; data?: T; error?: string; message?: string; code?: string }
  try {
    json = await res.json()
  } catch {
    throw new ApiError('Server error — please try again', 'NETWORK_ERROR', res.status)
  }
  if (!json.success) {
    throw new ApiError(
      json.message || json.error || 'Something went wrong',
      json.code || 'UNKNOWN',
      res.status,
    )
  }
  return json.data as T
}

/** Auth calls: no auto-redirect (used pre-login). */
async function authRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) || {}),
  }
  if (options.body) headers['Content-Type'] = 'application/json'

  const res = await fetch(`${API_BASE}/api${path}`, { ...options, headers })
  let json: { success?: boolean; data?: T; error?: string; message?: string; code?: string }
  try {
    json = await res.json()
  } catch {
    throw new ApiError('Server error — please try again', 'NETWORK_ERROR', res.status)
  }
  if (!json.success) {
    throw new ApiError(
      json.message || json.error || 'Invalid credentials',
      json.code || 'UNKNOWN',
      res.status,
    )
  }
  return json.data as T
}

// ── Types ─────────────────────────────────────────────────────

export interface AuthUser {
  id: string
  phone: string | null
  email: string | null
  full_name: string | null
  avatar_url: string | null
  role: string
}

export interface AuthResponse {
  access_token: string
  refresh_token: string
  is_new_user: boolean
  user: AuthUser
}

// 'delivery_asserted' (migration 0025) is the no-confirmation POD branch: the driver
// captured evidence but the receiver could not confirm, so the trip parks here until
// OPS closes it to 'completed' — which makes it this console's state above all others.
// Listed so it is REPRESENTABLE; the surface that acts on it is a later PR.
export type BookingStatus =
  | 'pending' | 'accepted' | 'negotiating' | 'in_transit' | 'delivery_asserted' | 'completed' | 'cancelled' | 'paid'

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
  status: BookingStatus
  booking_type: string
  in_transit_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

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

export interface TrackEta {
  eta_s: number
  eta_text: string
  remaining_m: number
  traffic: string
  stale: boolean
}

export interface TrackData {
  booking_id: string
  status: string
  location: { lat: number; lng: number; heading: number | null; speed_kmh: number | null; updated_at: string } | null
  eta: TrackEta | null
  destination: { lat: number; lng: number }
}

// ── Auth API ──────────────────────────────────────────────────

export function emailLogin(email: string, password: string): Promise<AuthResponse> {
  return authRequest<AuthResponse>('/auth/email/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export function refreshAccessToken(refreshToken: string): Promise<{ access_token: string }> {
  return authRequest<{ access_token: string }>('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
}

export function getMe(): Promise<{ user: AuthUser }> {
  return request<{ user: AuthUser }>('/auth/me')
}

export function authLogout(): Promise<{ message: string }> {
  return authRequest<{ message: string }>('/auth/logout', { method: 'POST' })
}

// ── Ops data API ──────────────────────────────────────────────

/** All bookings (admin/ops role -> every trip). */
export function listBookings(): Promise<Booking[]> {
  return request<Booking[]>('/bookings/')
}

export function getBooking(id: string): Promise<Booking> {
  return request<Booking>(`/bookings/${id}`)
}

/** Latest live GPS fix for a booking's driver (Redis-backed, may be null). */
export function getBookingLocation(bookingId: string): Promise<DriverLocation | null> {
  return request<DriverLocation | null>(`/location/booking/${bookingId}`)
}

/** Tracking read-through aggregate (status + location + live ETA). */
export function getTrack(bookingId: string): Promise<TrackData> {
  return request<TrackData>(`/tracking/track/${bookingId}`)
}

// ── Ops overrides ─────────────────────────────────────────────
// All ops/admin-gated on the gateway (the JWT role is enforced server-side).

/** Abort a trip before pickup (pending / negotiating / accepted). */
export function cancelBooking(id: string): Promise<Booking> {
  return request<Booking>(`/bookings/${id}/cancel`, { method: 'PATCH' })
}

/**
 * Force a stuck trip to completed (T-BE-6). Ops-only; valid source is
 * accepted | in_transit (409 otherwise). Bypasses the assigned-driver guard
 * and triggers the same payout saga as a normal completion.
 */
export function forceCompleteBooking(id: string): Promise<Booking> {
  return request<Booking>(`/bookings/${id}/force-complete`, { method: 'POST' })
}

/** Reassign a trip to a different driver (T-BE-6). Ops-only; status kept. */
export function reassignBooking(id: string, driverId: string): Promise<Booking> {
  return request<Booking>(`/bookings/${id}/reassign`, {
    method: 'POST',
    body: JSON.stringify({ driver_id: driverId }),
  })
}
