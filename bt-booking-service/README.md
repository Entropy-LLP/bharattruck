# bt-booking-service

Core booking engine for BharatTruck. Manages the full lifecycle of a freight booking — creation, driver matching, live GPS tracking, OTP-gated pickup confirmation, ePOD delivery, and payment release trigger.

**Port:** `3002`  
**Stack:** Node.js · TypeScript · Fastify · WebSocket · Supabase · Redis

---

## Quickstart

```bash
cp .env.example .env        # fill in secrets
npm install
npm run dev                 # tsx watch — hot reload
```

Or from the repo root:

```bash
./bt start booking          # foreground
make restart-booking        # background restart
```

Booking service calls two other services at runtime — make sure they're up:

```bash
./bt start all              # easiest: start everything
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Defaults to `3002` |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key |
| `REDIS_URL` | Yes | Driver location cache + pickup OTP store |
| `JWT_SECRET` | Yes | Validates tokens issued by bt-auth-service |
| `PRICING_SERVICE_URL` | Yes | `http://localhost:3003` in local dev |
| `CARGO_LEDGER_URL` | Yes | `http://localhost:3005` in local dev |
| `MSG91_AUTH_KEY` | Prod | SMS notifications (booking confirmed, driver assigned) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Prod | FCM push notifications |
| `GOOGLE_MAPS_API_KEY` | Prod | Distance matrix for route validation |

---

## API

### Bookings

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/bookings` | Create a new booking (calls pricing-service for quote) |
| `GET`  | `/bookings` | List bookings for the current user |
| `GET`  | `/bookings/:id` | Get a single booking with all details |
| `PATCH` | `/bookings/:id/cancel` | Cancel (allowed up to 2 hrs before scheduled pickup) |
| `POST` | `/bookings/:id/confirm-pickup` | Driver submits OTP to confirm cargo pickup → status: `in_transit` |
| `POST` | `/bookings/:id/deliver` | Driver marks delivery + ePOD photo → triggers payment release |

#### Create booking — request body

```json
{
  "pickup_address": "Dharavi, Mumbai",
  "pickup_lat": 19.0422,
  "pickup_lng": 72.8525,
  "drop_address": "Navi Mumbai Warehouse",
  "drop_lat": 19.0330,
  "drop_lng": 73.0297,
  "vehicle_type": "hcv",
  "load_type": "general",
  "weight_kg": 5000,
  "scheduled_at": "2026-04-10T08:00:00.000Z",
  "notes": "Fragile crates — handle with care"
}
```

Vehicle types: `mini_truck` · `lcv` · `hcv` · `trailer`  
Load types: `general` · `fragile` · `perishable` · `hazardous` · `heavy_machinery`

---

### Location (Driver GPS)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/location/update` | Driver sends GPS ping (every ~5s while trip active) |
| `GET`  | `/location/driver/:driver_id` | Get last known driver position (shipper polling / WebSocket fallback) |

#### Location update — request body

```json
{
  "driver_id": "uuid",
  "lat": 19.0422,
  "lng": 72.8525,
  "booking_id": "uuid"
}
```

Location is cached in Redis with a 30s TTL. Active bookings push updates to the shipper via WebSocket.

---

## Booking Status Flow

```
pending
  → confirmed      (driver accepts, payment escrow captured)
  → in_transit     (driver submits pickup OTP)
  → delivered      (driver submits ePOD → payment-service releases escrow)
  → cancelled      (shipper cancels within 2hr window)
```

---

## Service Dependencies

```
bt-booking-service (3002)
  ├── calls  → bt-pricing-service (3003)   POST /quote  on booking create
  ├── calls  → bt-cargo-ledger   (3005)   POST /shipments  on booking create
  └── calls  → bt-payment-service (3004)  POST /payments/release  on delivery
```

All calls are internal HTTP. In Docker Compose, the service names resolve via the compose network. Locally, use the `*_URL` env vars.

---

## Project Structure

```
src/
├── index.ts                    # Fastify bootstrap — registers routes + plugins
├── routes/
│   ├── bookings.ts             # CRUD + lifecycle endpoints
│   └── location.ts             # GPS update + last-known-location endpoints
└── lib/
    ├── types.ts                # BookingStatus, VehicleType, LoadType — shared enums
    ├── state.ts                # Booking state machine — valid transitions
    ├── repository.ts           # Supabase read/write helpers
    ├── service.ts              # Business logic — driver matching, notifications
    └── jobs.ts                 # Background jobs — booking expiry, location TTL
```

---

## Development Notes

- Most route handlers are scaffolded with `// TODO` stubs — business logic is being wired in Sprint 3–5.
- The WebSocket connection for live tracking requires `@fastify/websocket` (already installed). The upgrade path is `GET /bookings/:id/track`.
- Driver matching uses a Redis geo-index (Sprint 4): `GEOADD drivers:available <lng> <lat> <driver_id>`, then `GEORADIUS` to find the nearest available driver.
- ePOD photos upload to Cloudflare R2; the `deliver` endpoint receives a pre-signed URL or multipart form (Sprint 5).
- Notifications (SMS via MSG91, push via FCM) are fired directly from this service — there is no separate notification service.
