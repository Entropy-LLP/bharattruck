// API client for the fleet console.
//
// Same shape as driver/src/lib/api.ts and shipper/src/lib/api.ts: every call goes
// through the gateway origin, paths are written WITHOUT the /api prefix, and a
// 401 triggers exactly one refresh attempt before bouncing to /login.
//
// Token keys are namespaced per app (driver uses bt_driver_token, shipper uses
// bt_token) so all three can be open in one browser without clobbering each
// other's session. This app owns bt_fleet_*.

import type {
  AuthUser, FleetOwner, Vehicle, VehicleFinance, VehiclePermit, VehicleLane,
  FleetDriver, FleetSummary, VehicleAnalytics, DriverAnalytics, FuelComparison,
  LivePosition, FleetBooking, ModelCategory, Period,
} from './types'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'
const TOKEN_KEY = 'bt_fleet_token'
const REFRESH_KEY = 'bt_fleet_refresh_token'

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

export function getMe() {
  return authRequest<{ user: AuthUser }>('/auth/me')
}

export function refreshAccessToken(refresh_token: string) {
  return authRequest<{ access_token: string }>(
    '/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token }) })
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
