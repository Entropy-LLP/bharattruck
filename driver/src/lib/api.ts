import type { Booking, Quote, NegotiationEntry } from './types'

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

export function completeTrip(bookingId: string): Promise<Booking> {
  return request<Booking>(`/bookings/${bookingId}/complete`, {
    method: 'PATCH',
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
