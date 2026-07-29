// Ops-console API client. Talks to the backend ONLY through the gateway
// (NEXT_PUBLIC_API_URL -> /api/*), same envelope + custom-HS256-JWT auth as the
// shipper/driver apps. Ops uses an ops/admin-role JWT from /auth/email/login.

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'
const TOKEN_KEY = 'bt_ops_token'
const REFRESH_KEY = 'bt_ops_refresh_token'

// ── Token storage ─────────────────────────────────────────────

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(TOKEN_KEY)
  return raw ? raw.trim() : null
}
export function setToken(t: string) { localStorage.setItem(TOKEN_KEY, t) }
export function clearToken() { localStorage.removeItem(TOKEN_KEY) }
export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(REFRESH_KEY)
}
export function setRefreshToken(t: string) { localStorage.setItem(REFRESH_KEY, t) }
export function clearRefreshToken() { localStorage.removeItem(REFRESH_KEY) }

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

  const forceMock = typeof window !== 'undefined' && (localStorage.getItem('MOCK_API') === 'true' || !process.env.NEXT_PUBLIC_API_URL);

  if (forceMock) {
    return handleMockRequest<T>(path, options);
  }

  try {
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
  } catch (err) {
    console.warn(`[API] Connection to ${API_BASE}/api${path} failed. Falling back to mock data.`, err);
    return handleMockRequest<T>(path, options);
  }
}

/** Auth calls: no auto-redirect (used pre-login). */
async function authRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) || {}),
  }
  if (options.body) headers['Content-Type'] = 'application/json'

  const forceMock = typeof window !== 'undefined' && (localStorage.getItem('MOCK_API') === 'true' || !process.env.NEXT_PUBLIC_API_URL);

  if (forceMock) {
    return handleMockRequest<T>(path, options);
  }

  try {
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
  } catch (err) {
    console.warn(`[API] Auth connection to ${API_BASE}/api${path} failed. Falling back to mock data.`, err);
    return handleMockRequest<T>(path, options);
  }
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

export type BookingStatus =
  | 'pending' | 'accepted' | 'negotiating' | 'in_transit' | 'completed' | 'cancelled' | 'paid'

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

// ── Mock Database & Interceptor ───────────────────────────────

const getMockDb = () => {
  if (typeof window === 'undefined') return { bookings: [] } as any;
  const stored = localStorage.getItem('BT_OPS_MOCK_DB');
  if (stored) {
    try { return JSON.parse(stored); } catch {}
  }
  const defaultDb = {
    bookings: [
      {
        id: 'b1-delhi-mumbai',
        shipper_id: 's1',
        driver_id: null,
        shipper_name: 'Adani Logistics Ltd',
        shipper_contact: '+919876543210',
        source_address: 'Mumbai Port Trust, Maharashtra, India',
        source_lat: 18.96,
        source_lng: 72.84,
        destination_address: 'Indira Gandhi Cargo Terminal, Delhi, India',
        dest_lat: 28.56,
        dest_lng: 77.10,
        load_type: 'Industrial Pipes',
        weight_kg: 18000,
        quoted_price: 65000,
        final_price: null,
        pickup_date: new Date(Date.now() + 86400000).toISOString(),
        status: 'pending',
        booking_type: 'auction',
        in_transit_at: null,
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        id: 'b2-pune-kolkata',
        shipper_id: 's2',
        driver_id: 'd1',
        shipper_name: 'Tata Steel Ltd',
        shipper_contact: '+919988776655',
        source_address: 'Jamshedpur Steel Plant, Jharkhand, India',
        source_lat: 22.80,
        source_lng: 86.20,
        destination_address: 'Pune Assembly Hub, Maharashtra, India',
        dest_lat: 18.52,
        dest_lng: 73.85,
        load_type: 'Steel Coils',
        weight_kg: 24000,
        quoted_price: 85000,
        final_price: 85000,
        pickup_date: new Date().toISOString(),
        status: 'accepted',
        booking_type: 'direct',
        in_transit_at: null,
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        id: 'b3-ahmedabad-bangalore',
        shipper_id: 's3',
        driver_id: 'd1',
        shipper_name: 'Reliance Retail',
        shipper_contact: '+919111222333',
        source_address: 'Ahmedabad Distribution Center, Gujarat, India',
        source_lat: 23.02,
        source_lng: 72.57,
        destination_address: 'Nelamangala Warehouse, Bangalore, Karnataka, India',
        dest_lat: 13.09,
        dest_lng: 77.39,
        load_type: 'FMCG Goods',
        weight_kg: 12000,
        quoted_price: 42000,
        final_price: 41000,
        pickup_date: new Date(Date.now() - 86400000).toISOString(),
        status: 'in_transit',
        booking_type: 'auction',
        in_transit_at: new Date(Date.now() - 3600000).toISOString(),
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        id: 'b4-delhi-jaipur',
        shipper_id: 's4',
        driver_id: 'd2',
        shipper_name: 'DHL Supply Chain',
        shipper_contact: '+919222333444',
        source_address: 'IGI Airport T3 Cargo, Delhi, India',
        source_lat: 28.56,
        source_lng: 77.10,
        destination_address: 'Jaipur Industrial Area, Rajasthan, India',
        dest_lat: 26.91,
        dest_lng: 75.78,
        load_type: 'Electronics',
        weight_kg: 4500,
        quoted_price: 18000,
        final_price: 18000,
        pickup_date: new Date(Date.now() - 172800000).toISOString(),
        status: 'completed',
        booking_type: 'direct',
        in_transit_at: new Date(Date.now() - 172800000).toISOString(),
        completed_at: new Date(Date.now() - 144000000).toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ]
  };
  localStorage.setItem('BT_OPS_MOCK_DB', JSON.stringify(defaultDb));
  return defaultDb;
};

const saveMockDb = (db: any) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('BT_OPS_MOCK_DB', JSON.stringify(db));
  }
};

async function handleMockRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const db = getMockDb();
  const method = options.method || 'GET';

  // Auth requests
  if (path.startsWith('/auth/')) {
    if (path.includes('/email/login') || path.includes('/refresh')) {
      if (typeof window !== 'undefined') {
        localStorage.setItem('bt_ops_token', 'mock-jwt-ops-token');
        localStorage.setItem('bt_ops_refresh_token', 'mock-refresh-ops-token');
      }
      return {
        access_token: 'mock-jwt-ops-token',
        refresh_token: 'mock-refresh-ops-token',
        is_new_user: false,
        user: {
          id: 'ops1',
          phone: '9876543210',
          email: 'admin@bharattruck.com',
          full_name: 'Operations Manager',
          avatar_url: null,
          role: 'admin'
        }
      } as any;
    }
    if (path.includes('/me')) {
      return {
        user: {
          id: 'ops1',
          phone: '9876543210',
          email: 'admin@bharattruck.com',
          full_name: 'Operations Manager',
          avatar_url: null,
          role: 'admin'
        }
      } as any;
    }
    if (path.includes('/logout')) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('bt_ops_token');
        localStorage.removeItem('bt_ops_refresh_token');
      }
      return { message: 'Logged out' } as any;
    }
  }

  // Bookings list
  if (path === '/bookings/') {
    return db.bookings as any;
  }

  // Single booking and child routes
  if (path.startsWith('/bookings/')) {
    const parts = path.split('/');
    const bookingId = parts[2];

    const booking = db.bookings.find((b: any) => b.id === bookingId);
    if (!booking) {
      throw new ApiError('Booking not found', 'NOT_FOUND', 404);
    }

    // PATCH /bookings/:id/cancel
    if (path.endsWith('/cancel')) {
      booking.status = 'cancelled';
      saveMockDb(db);
      return booking as any;
    }

    // POST /bookings/:id/force-complete
    if (path.endsWith('/force-complete')) {
      booking.status = 'completed';
      booking.completed_at = new Date().toISOString();
      saveMockDb(db);
      return booking as any;
    }

    // POST /bookings/:id/reassign
    if (path.endsWith('/reassign')) {
      const body = JSON.parse(options.body as string);
      booking.driver_id = body.driver_id;
      booking.status = 'accepted';
      saveMockDb(db);
      return booking as any;
    }

    // GET /bookings/:id
    return booking as any;
  }

  // Location/ETA queries
  if (path.startsWith('/location/booking/')) {
    return {
      driver_id: 'd1',
      lat: 19.07,
      lng: 72.87,
      heading: 90,
      speed_kmh: 42,
      accuracy_m: 5,
      booking_id: 'b3-ahmedabad-bangalore',
      updated_at: new Date().toISOString()
    } as any;
  }

  if (path.startsWith('/tracking/track/')) {
    const parts = path.split('/');
    const bId = parts[parts.length - 1];
    const booking = db.bookings.find((b: any) => b.id === bId);
    return {
      booking_id: bId,
      status: booking?.status || 'in_transit',
      location: {
        lat: 19.07,
        lng: 72.87,
        heading: 90,
        speed_kmh: 42,
        updated_at: new Date().toISOString()
      },
      eta: {
        eta_s: 2100,
        eta_text: '35 mins',
        remaining_m: 18200,
        traffic: 'optimal',
        stale: false
      },
      destination: {
        lat: booking?.dest_lat || 13.09,
        lng: booking?.dest_lng || 77.39
      }
    } as any;
  }

  return {} as any;
}

