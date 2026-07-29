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

  const forceMock = typeof window !== 'undefined' && (localStorage.getItem('MOCK_API') === 'true' || !process.env.NEXT_PUBLIC_API_URL);

  if (forceMock) {
    return handleMockRequest<T>(path, options);
  }

  try {
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
  } catch (err) {
    console.warn(`[API] Connection to ${API_BASE}/api${path} failed. Falling back to mock data.`, err);
    return handleMockRequest<T>(path, options);
  }
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

  const forceMock = typeof window !== 'undefined' && (localStorage.getItem('MOCK_API') === 'true' || !process.env.NEXT_PUBLIC_API_URL);

  if (forceMock) {
    return handleMockRequest<T>(path, options);
  }

  try {
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
  } catch (err) {
    console.warn(`[API] Auth connection to ${API_BASE}/api${path} failed. Falling back to mock data.`, err);
    return handleMockRequest<T>(path, options);
  }
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

// ── Mock Database & Interceptor ───────────────────────────────

const getMockDb = () => {
  if (typeof window === 'undefined') return { bookings: [], quotes: [] } as any;
  const stored = localStorage.getItem('BT_MOCK_DB');
  if (stored) {
    try { return JSON.parse(stored); } catch {}
  }
  const defaultDb = {
    bookings: [
      {
        id: 'b1-delhi-mumbai',
        shipper_id: 's1',
        driver_id: null,
        shipper_name: 'Adani Logistics',
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
        pickup_time_slot: '09:00 - 14:00',
        status: 'pending',
        special_instructions: 'Flatbed truck required. Handle with care.',
        booking_type: 'auction',
        target_driver_id: null,
        auction_deadline: new Date(Date.now() + 7200000).toISOString(),
        awarded_quote_id: null,
        in_transit_at: null,
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
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
        pickup_time_slot: 'Immediate',
        status: 'accepted',
        special_instructions: 'Waterproof tarpaulin cover mandatory.',
        booking_type: 'direct',
        target_driver_id: 'd1',
        auction_deadline: null,
        awarded_quote_id: null,
        in_transit_at: null,
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
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
        pickup_time_slot: '08:00 - 12:00',
        status: 'in_transit',
        special_instructions: 'Express delivery required.',
        booking_type: 'auction',
        target_driver_id: null,
        auction_deadline: null,
        awarded_quote_id: 'q1',
        in_transit_at: new Date(Date.now() - 3600000).toISOString(),
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    ],
    quotes: [
      {
        id: 'q1',
        booking_id: 'b1-delhi-mumbai',
        driver_id: 'd1',
        amount: 62000,
        message: 'Can do this tomorrow morning. Flatbed vehicle ready.',
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        expires_at: null,
        updated_at: new Date().toISOString()
      }
    ],
    onboarding: {
      kyc_status: 'verified',
      dl_number: 'DL-MH1220261234567',
      dl_status: 'verified',
      vehicle_classes: ['HCV', 'MCV'],
      expiry_date: '2036-07-28',
      vehicles: [
        {
          id: 'v1',
          rc_number: 'MH-12-PQ-9999',
          maker_model: 'Tata Signa 2823.K',
          capacity_tons: 16,
          body_type: 'open_flatbed',
          fuel_type: 'diesel'
        }
      ],
      bank_accounts: [
        {
          id: 'ba1',
          account_number: '987654321098',
          ifsc: 'SBIN0001234',
          bank_name: 'State Bank of India',
          account_holder_name: 'Harpreet Singh',
          is_primary: true
        }
      ]
    }
  };
  localStorage.setItem('BT_MOCK_DB', JSON.stringify(defaultDb));
  return defaultDb;
};

const saveMockDb = (db: any) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('BT_MOCK_DB', JSON.stringify(db));
  }
};

async function handleMockRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const db = getMockDb();
  const method = options.method || 'GET';

  // Auth requests
  if (path.startsWith('/auth/')) {
    if (path.includes('/send-otp') || path.includes('/resend-otp') || path.includes('/magic-link/send')) {
      return { message: 'OTP sent successfully', expires_in: 60 } as any;
    }
    if (path.includes('/verify-otp') || path.includes('/email/login') || path.includes('/email/verify') || path.includes('/google') || path.includes('/register') || path.includes('/magic-link/verify')) {
      // Set mock token in localStorage
      if (typeof window !== 'undefined') {
        localStorage.setItem('bt_driver_token', 'mock-jwt-driver-token');
        localStorage.setItem('bt_driver_refresh_token', 'mock-refresh-driver-token');
      }
      return {
        access_token: 'mock-jwt-driver-token',
        refresh_token: 'mock-refresh-driver-token',
        is_new_user: false,
        user: {
          id: 'u1',
          phone: '9876543210',
          email: 'driver@bharattruck.com',
          full_name: 'Harpreet Singh',
          avatar_url: null,
          role: 'driver'
        }
      } as any;
    }
    if (path.includes('/me')) {
      return {
        user: {
          id: 'u1',
          phone: '9876543210',
          email: 'driver@bharattruck.com',
          full_name: 'Harpreet Singh',
          avatar_url: null,
          role: 'driver'
        }
      } as any;
    }
    if (path.includes('/logout')) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('bt_driver_token');
        localStorage.removeItem('bt_driver_refresh_token');
      }
      return { message: 'Logged out' } as any;
    }
  }

  // Onboarding status
  if (path === '/onboarding/status') {
    return {
      kyc_status: db.onboarding.kyc_status,
      documents_status: db.onboarding.dl_status,
      has_vehicle: db.onboarding.vehicles.length > 0,
      has_bank: db.onboarding.bank_accounts.length > 0
    } as any;
  }

  // Onboarding profile
  if (path === '/onboarding/profile') {
    if (method === 'PUT') {
      const body = JSON.parse(options.body as string);
      db.onboarding.kyc_status = 'verified';
      saveMockDb(db);
      return {
        driver: {
          id: 'd1',
          user_id: 'u1',
          photo_url: null,
          languages: body.languages || ['en', 'hi'],
          home_base_city: body.home_base_city || 'Mumbai',
          home_base_lat: body.home_base_lat || 18.96,
          home_base_lng: body.home_base_lng || 72.84,
          verification_badge: 'verified',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      } as any;
    }
    return {
      user: {
        id: 'u1',
        full_name: 'Harpreet Singh',
        phone_number: '9876543210',
        email: 'driver@bharattruck.com',
        avatar_url: null,
        city: 'Mumbai',
        state: 'Maharashtra',
        kyc_status: 'verified'
      },
      driver: {
        id: 'd1',
        user_id: 'u1',
        photo_url: null,
        languages: ['en', 'hi'],
        home_base_city: 'Mumbai',
        home_base_lat: 18.96,
        home_base_lng: 72.84,
        verification_badge: 'verified',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    } as any;
  }

  // Onboarding vehicles
  if (path === '/onboarding/vehicles') {
    return { vehicles: db.onboarding.vehicles } as any;
  }
  if (path === '/onboarding/vehicle') {
    const body = JSON.parse(options.body as string);
    const newVehicle = {
      id: 'v' + (db.onboarding.vehicles.length + 1),
      rc_number: body.rc_number,
      maker_model: body.maker_model || 'Tata Prima 2830.K',
      capacity_tons: body.capacity_tons || 12,
      body_type: body.body_type || 'open_flatbed',
      fuel_type: body.fuel_type || 'diesel'
    };
    db.onboarding.vehicles.push(newVehicle);
    saveMockDb(db);
    return { vehicle: newVehicle } as any;
  }

  // Onboarding license
  if (path === '/onboarding/license') {
    const body = JSON.parse(options.body as string);
    db.onboarding.dl_number = body.dl_number;
    db.onboarding.dl_status = 'verified';
    saveMockDb(db);
    return {
      license: {
        id: 'l1',
        driver_id: 'd1',
        dl_number: body.dl_number,
        dl_storage_path: null,
        vehicle_classes: body.vehicle_classes || ['HCV'],
        expiry_date: body.expiry_date || '2036-07-28',
        status: 'verified'
      }
    } as any;
  }

  // Onboarding bank
  if (path === '/onboarding/bank-accounts') {
    return { bank_accounts: db.onboarding.bank_accounts } as any;
  }
  if (path === '/onboarding/bank-account') {
    const body = JSON.parse(options.body as string);
    const newBank = {
      id: 'ba' + (db.onboarding.bank_accounts.length + 1),
      account_number: body.account_number,
      ifsc: body.ifsc,
      bank_name: body.bank_name || 'State Bank of India',
      account_holder_name: body.account_holder_name,
      is_primary: db.onboarding.bank_accounts.length === 0
    };
    db.onboarding.bank_accounts.push(newBank);
    saveMockDb(db);
    return { bank_account: newBank } as any;
  }

  if (path.startsWith('/onboarding/bank-account/') && method === 'DELETE') {
    const parts = path.split('/');
    const bankId = parts[parts.length - 1];
    db.onboarding.bank_accounts = db.onboarding.bank_accounts.filter((b: any) => b.id !== bankId);
    saveMockDb(db);
    return { message: 'Bank account deleted successfully' } as any;
  }

  // Bookings list
  if (path === '/bookings/') {
    return db.bookings as any;
  }

  // Single booking details
  if (path.startsWith('/bookings/')) {
    const parts = path.split('/');
    const bookingId = parts[2];
    const quoteIndex = path.indexOf('/quotes');

    // /bookings/:id/quotes
    if (quoteIndex !== -1) {
      if (method === 'POST') {
        const body = JSON.parse(options.body as string);
        const newQuote = {
          id: 'q' + (db.quotes.length + 1),
          booking_id: bookingId,
          driver_id: 'd1',
          amount: body.amount,
          message: body.message || '',
          status: 'submitted',
          submitted_at: new Date().toISOString(),
          expires_at: null,
          updated_at: new Date().toISOString()
        };
        db.quotes.push(newQuote);
        
        // Also update booking status if needed
        const booking = db.bookings.find((b: any) => b.id === bookingId);
        if (booking && booking.status === 'pending') {
          booking.status = 'negotiating';
        }
        
        saveMockDb(db);
        return newQuote as any;
      }
      return db.quotes.filter((q: any) => q.booking_id === bookingId) as any;
    }

    // Single booking GET
    const booking = db.bookings.find((b: any) => b.id === bookingId);
    if (!booking) {
      throw new ApiError('Booking not found', 'NOT_FOUND');
    }
    return booking as any;
  }

  return {} as any;
}
