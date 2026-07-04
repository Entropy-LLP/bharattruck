# bt-auth-service

Authentication and KYC service for BharatTruck — an Indian B2B freight booking platform.

**Port:** `3001`  
**Stack:** Node.js · TypeScript · Fastify · Supabase · Redis · MSG91 · SurePass

---

## Quickstart

```bash
cp .env.example .env        # fill in secrets
npm install
npm run dev                 # tsx watch — hot reload
```

Or from the repo root:

```bash
./bt start auth             # foreground
make restart-auth           # background restart
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Defaults to `3001` |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key (bypasses RLS) |
| `REDIS_URL` | Yes | OTP store + refresh token cache |
| `JWT_SECRET` | Yes | Access token signing key (min 32 chars) |
| `JWT_REFRESH_SECRET` | Yes | Refresh token signing key (min 32 chars) |
| `ENCRYPTION_KEY` | Yes | 32-byte hex key for AES-256-GCM PII encryption |
| `SUREPASS_API_KEY` | Prod | SurePass KYC API key |
| `MSG91_AUTH_KEY` | Prod | SMS gateway for OTP delivery |
| `MSG91_TEMPLATE_ID` | Prod | MSG91 DLT-registered template |
| `OTP_DEV_MODE` | Dev | `true` → OTP logged to console, not sent via SMS |

---

## API

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/send-otp` | None | Send 6-digit OTP to an Indian mobile number |
| `POST` | `/auth/verify-otp` | None | Verify OTP → returns access + refresh tokens |
| `POST` | `/auth/refresh` | None | Exchange refresh token for a new access token |
| `POST` | `/auth/register` | Bearer | Complete profile after first login |
| `GET`  | `/auth/me` | Bearer | Get current user's full profile |
| `POST` | `/auth/logout` | Bearer | Revoke refresh token from Redis |
| `GET`  | `/health` | None | Service health check |

#### Request examples

```bash
# Step 1 — send OTP
curl -X POST http://localhost:3001/auth/send-otp \
  -H 'Content-Type: application/json' \
  -d '{"phone":"9876543210"}'
# → {"success":true,"data":{"message":"OTP sent","expires_in":300}}

# Step 2 — verify OTP  (OTP_DEV_MODE=true: check server console for the code)
curl -X POST http://localhost:3001/auth/verify-otp \
  -H 'Content-Type: application/json' \
  -d '{"phone":"9876543210","otp":"123456"}'
# → {"success":true,"data":{"access_token":"...","refresh_token":"...","is_new_user":true}}

# Step 3 — register profile
curl -X POST http://localhost:3001/auth/register \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <access_token>' \
  -d '{"name":"Rajan Mehta","role":"shipper","company_name":"Mehta Traders"}'
```

#### Roles

| Role | Profile table | Extra registration fields |
|------|---------------|--------------------------|
| `shipper` | `shipper_profiles` | `email`, `company_name`, `gst_number` |
| `fleet_owner` | `shipper_profiles` | same as shipper |
| `driver` | `driver_profiles` | `vehicle_type`, `vehicle_number` |

---

### KYC

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/kyc/verify/:type` | Bearer | Run a verification check |
| `GET`  | `/kyc/status/:userId` | Bearer | Get current KYC level for a user |

#### Verification types (`:type`)

| Type | Required by | Provider |
|------|-------------|----------|
| `phone` | All | OTP verified at login |
| `email` | All | OTP to email |
| `aadhaar` | Drivers, fleet owners | SurePass |
| `pan` | All | SurePass |
| `dl` | Drivers | SurePass (driving licence) |
| `rc` | Drivers, fleet owners | SurePass (vehicle RC) |
| `gst` | Shippers, fleet owners | SurePass |
| `face_match` | Drivers | SurePass (selfie vs Aadhaar photo) |
| `bank` | All (for payouts) | SurePass penny drop |

#### KYC Levels

| Level | Requirements | Unlocks |
|-------|-------------|---------|
| L0 | None | Read-only access |
| L1 | Phone + Email | Booking creation |
| L2 | L1 + Aadhaar + PAN | Full platform access |
| L3 | L2 + DL/RC/GST + Face-match + Bank | Driver payouts |

> KYC route handlers are scaffolded; full implementation is in progress (Sprint 4).

---

## Auth Flow

```
Mobile app
  → POST /auth/send-otp        OTP stored in Redis (5min TTL, rate-limited 5/hr per phone)
  → POST /auth/verify-otp      Compare → issue access_token (15min) + refresh_token (7 days)
  → POST /auth/register        Attach name/role/profile — required for booking
  → GET  /auth/me              Load profile on app launch
  → POST /auth/refresh         Silent token refresh before expiry
  → POST /auth/logout          Delete refresh key from Redis (revoke)
```

---

## Project Structure

```
src/
├── index.ts                    # Fastify bootstrap + plugin registration
├── routes/
│   ├── auth.ts                 # OTP, JWT, register, me, logout
│   └── kyc.ts                  # KYC verify + status endpoints
├── lib/
│   ├── jwt.ts                  # signAccessToken, signRefreshToken, verify*
│   ├── otp.ts                  # generateOtp, sendOtp (MSG91 / dev console)
│   ├── encryption.ts           # AES-256-GCM for PII fields at rest
│   └── surepass.ts             # SurePass API client
├── plugins/
│   ├── supabase.ts             # Fastify plugin — decorates app.supabase
│   └── redis.ts                # Fastify plugin — decorates app.redis
└── modules/
    └── kyc/
        ├── types.ts            # KYCStatus, KYCLevel, UserRole enums + interfaces
        ├── repository.ts       # Supabase read/write for kyc_verifications table
        ├── fraud.ts            # Duplicate hash checks, fuzzy name match
        └── verifications/      # One file per check (phone, email, aadhaar, …)
```

---

## Scripts

```bash
npm run dev      # tsx watch — hot reload
npm run build    # tsc compile → dist/
npm run start    # run compiled output (production)
```

---

## Development Notes

- `OTP_DEV_MODE=true` logs the OTP to stdout instead of calling MSG91. All `./bt` and `make` targets set this automatically in local dev.
- Access tokens expire in **15 minutes**. Refresh tokens expire in **7 days** and are stored per-user in Redis — revocable at logout.
- OTP attempts are rate-limited to **5 per hour** per phone number (Redis counter with 1hr TTL).
- Supabase RLS is bypassed by the service role key; row-level policies are enforced at the schema level, not by this service.
- PII fields (Aadhaar number, bank account) are AES-256-GCM encrypted before writing to Supabase. The `ENCRYPTION_KEY` must be exactly 32 bytes (64 hex chars).
