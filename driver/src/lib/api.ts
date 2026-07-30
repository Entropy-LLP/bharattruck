import type {
  Booking,
  Quote,
  NegotiationEntry,
  DriverProfile,
  License,
  Insurance,
  Vehicle,
  BankAccount,
  OnboardingProfile,
  OnboardingStatus,
  VehicleBodyType,
  VehicleAxleConfig,
  FleetInvite,
} from './types'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'
const TOKEN_KEY = 'bt_driver_token'
const REFRESH_KEY = 'bt_driver_refresh_token'

// ── Token storage ─────────────────────────────────────────────

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(REFRESH_KEY)
}

export function setRefreshToken(token: string) {
  localStorage.setItem(REFRESH_KEY, token)
}

export function clearRefreshToken() {
  localStorage.removeItem(REFRESH_KEY)
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
  DRIVER_PROFILE_NOT_FOUND: 'Complete your driver profile before submitting quotes',
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
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> || {}),
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

export function withdrawQuote(bookingId: string, quoteId: string): Promise<Quote> {
  return request<Quote>(`/bookings/${bookingId}/quotes/${quoteId}/withdraw`, {
    method: 'PATCH',
  })
}

export function getQuoteHistory(
  bookingId: string,
  quoteId: string
): Promise<NegotiationEntry[]> {
  return request<NegotiationEntry[]>(`/bookings/${bookingId}/quotes/${quoteId}/history`)
}

// ── Trip lifecycle ───────────────────────────────────────────

export function startTrip(bookingId: string): Promise<Booking> {
  return request<Booking>(`/bookings/${bookingId}/start`, {
    method: 'PATCH',
  })
}

// ── Proof-of-Delivery (receiver-OTP) ─────────────────────────
// The driver never completes a trip directly — completion is driven
// out-of-band by the receiver verifying an emailed OTP (which fires
// booking-service's internal complete-pod). The driver only fetches
// POD context and asks the receiver OTP to be sent.
//   getPodContext → booking-svc GET /bookings/:id/pod-context
//                   (driver-only, requires status === 'in_transit')
//   requestPodOtp → bt-cargo-ledger POST /cargo/pod/request-otp
//                   (driver JWT forwarded to booking-svc for authz)

export interface PodContext {
  booking_id: string
  status: string
  receiver_email: string | null
}

export interface RequestOtpResult {
  booking_id: string
  /** MASKED receiver email (e.g. j****@x.com) — display the full
   *  address from getPodContext instead. */
  sent_to: string
  expires_in_seconds: number
}

export function getPodContext(bookingId: string): Promise<PodContext> {
  return request<PodContext>(`/bookings/${bookingId}/pod-context`)
}

export function requestPodOtp(bookingId: string): Promise<RequestOtpResult> {
  return request<RequestOtpResult>('/cargo/pod/request-otp', {
    method: 'POST',
    body: JSON.stringify({ booking_id: bookingId }),
  })
}

// ── Location ─────────────────────────────────────────────────

export interface LocationUpdate {
  lat: number
  lng: number
  heading?: number
  speed_kmh?: number
  accuracy_m?: number
  booking_id?: string
}

export function pushLocation(body: LocationUpdate) {
  return request<{ driver_id: string; lat: number; lng: number; updated_at: string }>(
    '/location/update',
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  )
}

// ── Driver onboarding ─────────────────────────────────────────
// Real clients for bt-auth-service `/onboarding/*` (reached through
// the gateway at `/api/onboarding/*`). All are authenticated, so they
// use `request` (token refresh + redirect on hard 401).

export interface UpdateProfileInput {
  full_name?: string
  photo_url?: string
  languages?: string[]
  home_base_city?: string
  home_base_lat?: number
  home_base_lng?: number
}

export interface CreateVehicleInput {
  rc_number: string
  rc_storage_path?: string
  vehicle_photos?: string[]
  capacity_tons?: number
  body_type?: VehicleBodyType
  axle_config?: VehicleAxleConfig
  maker_model?: string
  fuel_type?: string
  rc_expiry?: string
}

/** Mirrors the server's `CreateVehicleBody.partial()`. */
export type UpdateVehicleInput = Partial<CreateVehicleInput>

export interface SubmitLicenseInput {
  dl_number: string
  dl_storage_path?: string
  vehicle_classes?: string[]
  expiry_date?: string
}

export type UpdateLicenseInput = Partial<SubmitLicenseInput>

export interface SubmitInsuranceInput {
  policy_number: string
  provider?: string
  storage_path?: string
  expiry_date?: string
}

export interface LinkBankAccountInput {
  account_number: string
  ifsc: string
  bank_name?: string
  account_holder_name: string
  is_primary?: boolean
}

export function getOnboardingProfile(): Promise<OnboardingProfile> {
  return request<OnboardingProfile>('/onboarding/profile')
}

export function getOnboardingStatus(): Promise<OnboardingStatus> {
  return request<OnboardingStatus>('/onboarding/status')
}

export function updateDriverProfile(
  body: UpdateProfileInput,
): Promise<{ driver: DriverProfile }> {
  return request<{ driver: DriverProfile }>('/onboarding/profile', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export function getVehicles(): Promise<{ vehicles: Vehicle[] }> {
  return request<{ vehicles: Vehicle[] }>('/onboarding/vehicles')
}

export function createVehicle(
  body: CreateVehicleInput,
): Promise<{ vehicle: Vehicle }> {
  return request<{ vehicle: Vehicle }>('/onboarding/vehicle', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * Partial update. The server rejects an empty body ('No fields to update') and
 * 409s if `rc_number` collides with another vehicle, so send only what changed.
 */
export function updateVehicle(
  vehicleId: string,
  body: UpdateVehicleInput,
): Promise<{ vehicle: Vehicle }> {
  return request<{ vehicle: Vehicle }>(`/onboarding/vehicle/${vehicleId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

/**
 * Soft delete — the server only flips `is_active` to false, so the row survives
 * and the trips it already ran keep their vehicle. Idempotent: removing an
 * already-removed vehicle still 200s. 409s with `VEHICLE_IN_USE` while the
 * truck is on a live trip.
 */
export function deleteVehicle(vehicleId: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/onboarding/vehicle/${vehicleId}`, {
    method: 'DELETE',
  })
}

export function submitLicense(
  body: SubmitLicenseInput,
): Promise<{ license: License }> {
  return request<{ license: License }>('/onboarding/license', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateLicense(
  body: UpdateLicenseInput,
): Promise<{ license: License }> {
  return request<{ license: License }>('/onboarding/license', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export function submitInsurance(
  vehicleId: string,
  body: SubmitInsuranceInput,
): Promise<{ insurance: Insurance }> {
  return request<{ insurance: Insurance }>(`/onboarding/vehicle/${vehicleId}/insurance`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function getBankAccounts(): Promise<{ bank_accounts: BankAccount[] }> {
  return request<{ bank_accounts: BankAccount[] }>('/onboarding/bank-accounts')
}

export function linkBankAccount(
  body: LinkBankAccountInput,
): Promise<{ bank_account: BankAccount }> {
  return request<{ bank_account: BankAccount }>('/onboarding/bank-account', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function deleteBankAccount(id: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/onboarding/bank-account/${id}`, {
    method: 'DELETE',
  })
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

export function sendMagicLink(email: string, role: string) {
  return authRequest<{ message: string; expires_in: number }>('/auth/magic-link/send', {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  })
}

export function verifyMagicLink(linkToken: string) {
  return authRequest<AuthResponse>(`/auth/magic-link/verify?token=${encodeURIComponent(linkToken)}`)
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

export function registerProfile(body: {
  full_name: string
  role: string
  email?: string
  truck_type?: string
  truck_number?: string
  license_number?: string
}) {
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

// ── Fleet affiliation (driver side) ───────────────────────────

/** Pending invitations only — the server filters to `status='pending'`. */
export function listMyFleetInvites(): Promise<FleetInvite[]> {
  return request<FleetInvite[]>('/fleet/drivers/invites/mine')
}

/**
 * The consent gate: only the driver can move an invitation off 'pending'. A
 * second response 409s with INVALID_TRANSITION, which the caller should treat
 * as "already handled" and refresh rather than as a failure.
 */
export function respondToFleetInvite(
  inviteId: string,
  action: 'accept' | 'reject',
): Promise<FleetInvite> {
  return request<FleetInvite>(`/fleet/drivers/invites/${inviteId}/respond`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  })
}
