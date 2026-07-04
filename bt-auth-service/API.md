# bt-auth-service — API Reference

**Base URL:** `http://localhost:3001`  
**All responses:** `{ success: boolean, data?: ..., error?: string }`  
**Auth header:** `Authorization: Bearer <access_token>` (where required)

---

## Tokens

| Token | Algorithm | Expiry | Secret env var |
|-------|-----------|--------|----------------|
| Access token | HS256 JWT | 15 min | `JWT_SECRET` |
| Refresh token | HS256 JWT | 7 days | `JWT_REFRESH_SECRET` |

JWT payload shape: `{ userId: string, phone?: string, role: string }`

---

## Auth Routes (`/auth`)

### POST `/auth/send-otp`
Sends a 6-digit OTP to an Indian mobile number via MSG91.

**Body**
```json
{ "phone": "9876543210" }
```
- `phone`: 10-digit Indian number starting with 6–9.
- Rate-limited to **5 attempts per phone per hour** (Redis).

**Response 200**
```json
{ "success": true, "data": { "message": "OTP sent", "expires_in": 300 } }
```

---

### POST `/auth/verify-otp`
Verifies OTP and returns JWT tokens. Creates user row if first login.

**Body**
```json
{ "phone": "9876543210", "otp": "123456" }
```

**Response 200**
```json
{
  "success": true,
  "data": {
    "access_token": "<jwt>",
    "refresh_token": "<jwt>",
    "is_new_user": true,
    "user": { "id": "...", "phone": "...", "role": "shipper", ... }
  }
}
```
- New users get `role: "shipper"` by default. Call `/auth/register` to set role + profile.

---

### POST `/auth/register`
Sets role and profile for the authenticated user. Call after first `verify-otp`.

**Headers:** `Authorization: Bearer <access_token>`

**Body**
```json
{
  "name": "Raju Kumar",
  "role": "driver",
  "email": "raju@example.com",
  "vehicle_type": "hcv",
  "vehicle_number": "MH12AB1234"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | 2–100 chars |
| `role` | Yes | `shipper` \| `driver` \| `fleet_owner` |
| `email` | No | For shippers/fleet owners |
| `company_name` | No | Shipper/fleet owner |
| `gst_number` | No | Shipper/fleet owner |
| `vehicle_type` | No | Driver — `mini_truck` \| `lcv` \| `hcv` \| `trailer` |
| `vehicle_number` | No | Driver |

**Response 200**
```json
{ "success": true, "data": { "message": "Profile registered" } }
```

---

### POST `/auth/google`
Sign in or sign up with a Google ID token (OAuth2).

**Body**
```json
{ "id_token": "<google_id_token>", "role": "shipper" }
```
- `role` is used only if the user is new (defaults to `"shipper"` if omitted/invalid).
- Looks up by `google_sub`, falls back to `email`. Links Google to existing email account if found.

**Response 200** — same shape as `verify-otp`.

---

### POST `/auth/refresh`
Issues a new access token using a valid refresh token.

**Body**
```json
{ "refresh_token": "<jwt>" }
```

**Response 200**
```json
{ "success": true, "data": { "access_token": "<jwt>" } }
```

---

### GET `/auth/me`
Returns full profile for the authenticated user.

**Headers:** `Authorization: Bearer <access_token>`

**Response 200**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "...", "phone": "...", "role": "driver",
      "driver_profiles": [...],
      "shipper_profiles": [...]
    }
  }
}
```

---

### POST `/auth/logout`
Revokes the refresh token from Redis.

**Headers:** `Authorization: Bearer <access_token>`

**Response 200**
```json
{ "success": true, "data": { "message": "Logged out" } }
```

---

## KYC Routes (`/kyc`) — ⚠️ Not yet implemented (returns 501)

KYC routes are wired but handlers return `501 Not Implemented`. Documented here for integration planning.

### POST `/kyc/verify/:type`
Runs a specific KYC verification for a user.

**`:type` values:** `phone` | `email` | `aadhaar` | `pan` | `dl` | `rc` | `gst` | `face_match` | `bank`

**Headers:** `Authorization: Bearer <access_token>`

**Body**
```json
{
  "user_id": "uuid",
  "role": "DRIVER",
  "metadata": { }
}
```
- `role`: `CUSTOMER` | `DRIVER` | `FLEET_OPERATOR`
- `metadata`: verification-specific inputs (e.g. `aadhaar_number`, `otp`, `image_base64`)

---

### GET `/kyc/status/:userId`
Returns the current KYC level for a user.

**Headers:** `Authorization: Bearer <access_token>`

**KYC Levels:**
| Level | Requirements |
|-------|-------------|
| L0 | No verification |
| L1 | Phone + Email verified |
| L2 | L1 + Aadhaar + PAN |
| L3 | L2 + DL/RC/GST + Face match + Bank |

**Expected Response 200**
```json
{ "user_id": "uuid", "kyc_level": "L1" }
```

---

## Health Check

### GET `/health`
```json
{ "status": "ok", "service": "bt-auth-service", "ts": "2026-04-07T..." }
```

---

## Error Codes

| HTTP | Meaning |
|------|---------|
| 400 | Validation failure — check `error` field |
| 401 | Missing/invalid/expired token or wrong OTP |
| 404 | User not found |
| 429 | OTP rate limit exceeded (5/hr per phone) |
| 500 | Internal error (DB write failed, etc.) |
| 501 | KYC handler not yet implemented |

---

## Driver App Integration Notes

1. **Login flow:** `POST /auth/send-otp` → `POST /auth/verify-otp`
2. **New user?** Check `is_new_user: true` in verify-otp response → redirect to onboarding → `POST /auth/register` with `role: "driver"` + vehicle details.
3. **Token storage:** Store `access_token` (15 min) and `refresh_token` (7 days). On 401, call `POST /auth/refresh` to renew access token silently.
4. **Google Sign-In:** Pass the Google ID token from `@react-native-google-signin/google-signin` directly to `POST /auth/google`.
5. **KYC:** Not live yet. Integrate after `/kyc` handlers are implemented (see Surepass client in `src/lib/surepass.ts`).

---

## Dev Notes

- **OTP in dev mode:** Set `OTP_DEV_MODE=true` or `NODE_ENV=development` — OTP is printed to console, MSG91 is skipped.
- **Required env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `GOOGLE_CLIENT_ID`, `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`, `SUREPASS_API_KEY`
