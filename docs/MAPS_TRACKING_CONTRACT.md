# BharatTruck — Maps & Tracking CONTRACT

> **Status: FROZEN.** This document is the single source of truth for the Maps & Tracking build.
> On ANY conflict between this CONTRACT and the PLAN narrative (or any other doc), **this CONTRACT wins.**
> Decisions confirmed **2026-06-18**. Changing anything here requires a new `D-xxx` decision (see §8 change control).
> Anything not locked on 2026-06-18 is tagged inline **(INFERRED — confirm)** and MUST NOT be treated as frozen until confirmed.

---

## 1. Purpose & Scope

BharatTruck is an India interstate/intrastate freight-booking marketplace built on the LogisticOS microservices. The MVP bar is a single proven loop: **one shipper → one driver → one tracked, proven, paid interstate trip** (North Star = Completed Paid Trips, deadline 31 Aug 2026). Today the `driver/` and `shipper/` PWAs already poll live location every 10s but render raw `lat`/`lng` as **text** — the map layer is the missing piece this feature delivers.

### 1.1 What `bt-tracking-service` OWNS (new logic only)

`bt-tracking-service` is a **server-side Google Maps proxy with Redis caching**. It owns ONLY the new derived/read logic:

- **Cached base route** polyline (Routes API, Essentials/static tier, long TTL).
- **Live traffic ETA** (Routes API, TRAFFIC_AWARE/Pro tier, short TTL).
- **Traveled breadcrumb history** read from `location_history` (migration 009 table).
- **Petrol-pump search** near the truck's current location (Places API New), top-8.
- **Fuel estimate** (mileage-by-vehicle-class × editable diesel price).
- **Route alerts** (off-route / idle / near-drop thresholds).
- **Shipper read-through aggregate** — the single-call read-model that fuses current location + route + live ETA + status (endpoint #8, LOCKED).

### 1.2 What STAYS in `bt-booking-service` (do NOT rebuild)

- **Raw GPS ingestion.** `POST /location/update`, `GET /location/driver/:driver_id`, `GET /location/booking/:booking_id` — Redis-backed, **30s TTL** live position. This is existing, working code. `bt-tracking-service` **consumes** this live position (server-to-server or via Redis read) but never re-implements ingestion.
- **`location_history` breadcrumb WRITE.** The throttled breadcrumb persistence belongs to the ingestion path in `bt-booking-service` (see §5). `bt-tracking-service` is **read-only** on `location_history`.

### 1.3 Out of scope for this feature

- No WebSocket / push transport — pilot keeps **10s HTTP polling** (Decision 5).
- No in-app turn-by-turn — navigation is a **deep-link handoff** to the phone's Google Maps app (Decision — see §7.2).
- No PostGIS — `lat`/`lng` are plain decimals (see §5).
- No shared npm package for the map component — the `<LiveTrackMap/>` is **COPIED** into each app (Decision 8).

---

## 2. Service Facts

| Fact | Value |
|---|---|
| Service name | `bt-tracking-service` |
| Runtime | Node.js **20** (`node:20-alpine`) |
| Framework | **Fastify 4** (`fastify@^4`) |
| Language | **TypeScript 5**, ESM (`"type": "module"`, NodeNext, `.js` import specifiers) |
| Port | **3006** (`PORT` env, default 3006) |
| Recipe | Same microservice recipe as `bt-auth-service` / `bt-booking-service` |
| Deploy target | **GCP Cloud Run**, region `asia-south1` (multi-stage Dockerfile, `USER node`, `EXPOSE 3006`) |
| CORS | `@fastify/cors` with `origin: true` (INFERRED — confirm; matches existing services) |
| Cache/state | Redis (`ioredis`), read-through cache per §4 TTLs |
| DB access | Supabase JS (`@supabase/supabase-js`, service-role key) — **read-only** on `location_history` |
| Logger | `pino` (+ `pino-pretty` in development), matching existing services |

**Folder layout (mirrors `bt-auth-service` / `bt-booking-service`):**

```
bt-tracking-service/
├── Dockerfile                 # multi-stage: deps / development / builder / production, node:20-alpine
├── .env.example
├── package.json               # "type": "module", scripts: dev(tsx watch) / build(tsc) / start(node dist/index.js)
├── tsconfig.json
└── src/
    ├── index.ts               # Fastify bootstrap: cors → plugins → routes, /health unauth, listen(PORT ?? 3006)
    ├── plugins/
    │   ├── auth.ts            # JWT gate (same recipe as booking-service authPlugin)
    │   └── redis.ts           # ioredis decorate + graceful close
    ├── lib/
    │   ├── google.ts         # Routes API + Places API (New) client (GOOGLE_MAPS_SERVER_KEY)
    │   ├── cache.ts          # Redis cache-key builders + TTL constants
    │   ├── supabase.ts       # service-role client (read location_history)
    │   ├── booking.ts        # reads live position from bt-booking-service / Redis
    │   └── types.ts          # snake_case response DTOs + TrackingError
    └── routes/
        └── tracking.ts        # all /api/tracking/* routes (registered with prefix /api/tracking)
```

**Bootstrap shape (matches existing services):**

```ts
// src/index.ts
async function bootstrap() {
  await app.register(cors, { origin: true })
  app.get('/health', () => ({ status: 'ok', service: 'bt-tracking-service', ts: new Date().toISOString() }))
  await app.register(redisPlugin)
  await app.register(async (authed) => {
    await authed.register(authPlugin)
    await authed.register(trackingRoutes, { prefix: '/api/tracking' })
  })
  await app.listen({ port: Number(process.env.PORT ?? 3006), host: '0.0.0.0' })
}
```

---

## 3. Environment Variables

Naming is **LOCKED** — use exactly these keys, no synonyms.

| Variable | Side | Restriction | Purpose | Default |
|---|---|---|---|---|
| `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | Browser / client (driver & shipper PWAs) | **HTTP-referrer restricted**; Maps JavaScript API **only** | Loads the Maps JS vector map in `<LiveTrackMap/>` | — |
| `GOOGLE_MAPS_SERVER_KEY` | **Server only** (`bt-tracking-service`) — SECRET, never shipped to the browser | API-restricted to **Routes API + Places API (New)** | Server-side calls to Routes API (route + ETA) and Places API New (pumps) | — |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` | Browser / client | Public map style ID | Vector **Map ID** for styled maps in `<LiveTrackMap/>` | — |
| `DIESEL_PRICE_INR` | Server (`bt-tracking-service`) | — | Default, editable diesel price (INR/litre) used by the fuel estimate | **`90`** |
| `PORT` | Server | — | Listen port | `3006` |
| `NODE_ENV` | Server | — | `development` toggles `pino-pretty` | `development` |
| `REDIS_URL` | Server | secret | Redis connection (cache + live-position read) | `redis://localhost:6379` |
| `SUPABASE_URL` | Server | secret | Supabase project URL (read `location_history`) | — |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | SECRET | Supabase service-role key | — |
| `JWT_SECRET` | Server | SECRET | Verifies the caller JWT (same secret as other services) | — |
| `BOOKING_SERVICE_URL` | Server | — | Base URL of `bt-booking-service` for live-position read-through *(INFERRED — confirm; alternative is direct Redis read of the shared `loc:*` keys)* | `http://localhost:3002` |

> **Never** put `GOOGLE_MAPS_SERVER_KEY` behind a `NEXT_PUBLIC_` prefix. The browser key and server key are **two physically different, separately-restricted keys** (Decision — cost control = restricted keys + per-API quota caps).

---

## 4. Endpoints

**Conventions for every endpoint below:** JSON is **snake_case**; the path param is **`:bookingId`**; all `/api/tracking/*` routes are **JWT-gated** (except `/health`); success = `{ "success": true, "data": {...} }`; error = §8 error shape. Live position is sourced from `bt-booking-service` (30s-TTL Redis), never re-ingested here.

Redis cache keys use the `trk:` namespace (parallel to booking-service's `loc:` namespace).

---

### 4.0 `GET /health`

Unauthenticated liveness probe (Cloud Run health check).

**Response `200`:**
```json
{ "status": "ok", "service": "bt-tracking-service", "ts": "2026-07-04T09:30:00.000Z" }
```
Google API: none. Cache: none.

---

### 4.1 `GET /api/tracking/route/:bookingId`

Cached **base route** polyline between the booking's source and destination.

- **Query params:** none.
- **Request body:** none.
- **Google API / tier:** **Routes API** — **`computeRoutes`, Essentials / static tier** (`routingPreference: TRAFFIC_UNAWARE`). Traffic is intentionally NOT requested here (that is `/eta`).
- **Cache key / TTL:** `trk:route:{bookingId}` — **TTL 86400s (24h)**. The base geometry is stable for a booking's origin/destination, so it is cached long *(INFERRED — confirm TTL length)*.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "booking_id": "b1f2c3d4-0000-4000-8000-000000000001",
    "source": { "lat": 19.0760, "lng": 72.8777, "address": "Bhiwandi, Maharashtra" },
    "destination": { "lat": 28.7041, "lng": 77.1025, "address": "Narela, Delhi" },
    "polyline": "yx}mCwzr{Lg@... (Google encoded polyline)",
    "distance_km": 1412.6,
    "static_duration_seconds": 97200,
    "provider": "google_routes",
    "tier": "essentials",
    "cached_at": "2026-07-04T06:00:00.000Z"
  }
}
```

---

### 4.2 `GET /api/tracking/eta/:bookingId`

Live, **traffic-aware** ETA from the truck's current position to the drop.

- **Query params:** none (origin is the live position from booking-service; destination is the booking drop).
- **Request body:** none.
- **Google API / tier:** **Routes API** — **`computeRoutes`, TRAFFIC_AWARE / Pro tier** (`routingPreference: TRAFFIC_AWARE`) (Decision 1).
- **Cache key / TTL:** `trk:eta:{bookingId}` — **TTL 60s (short)** so ETA refreshes near the 10s poll cadence without a Google call per poll *(INFERRED — confirm 60s)*.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "booking_id": "b1f2c3d4-0000-4000-8000-000000000001",
    "current_location": { "lat": 21.1458, "lng": 79.0882, "updated_at": "2026-07-04T09:29:50.000Z" },
    "destination": { "lat": 28.7041, "lng": 77.1025 },
    "eta_seconds": 41400,
    "eta_iso": "2026-07-04T20:59:50.000Z",
    "remaining_distance_km": 842.3,
    "in_traffic": true,
    "provider": "google_routes",
    "tier": "traffic_aware_pro",
    "computed_at": "2026-07-04T09:29:55.000Z"
  }
}
```

**Response when no live position (driver offline / >30s TTL expired):**
```json
{ "success": true, "data": null, "message": "No recent driver location — ETA unavailable" }
```

---

### 4.3 `GET /api/tracking/history/:bookingId`

Traveled **breadcrumb trail** for the trip, read from `location_history` (migration 009). Read-only.

- **Query params (all optional):**
  - `since` — ISO-8601 timestamp; return points at/after this time.
  - `limit` — max points (INFERRED default `500`, INFERRED max `2000` — confirm).
- **Request body:** none.
- **Google API / tier:** **none** (pure DB read).
- **Cache key / TTL:** `trk:history:{bookingId}` — **TTL 15s** *(INFERRED — confirm; short, since new breadcrumbs land ~every 10-15s)*.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "booking_id": "b1f2c3d4-0000-4000-8000-000000000001",
    "point_count": 3,
    "points": [
      { "lat": 19.0760, "lng": 72.8777, "speed_kmh": 0,  "heading": 12,  "recorded_at": "2026-07-04T06:00:05.000Z" },
      { "lat": 19.9975, "lng": 73.7898, "speed_kmh": 58, "heading": 41,  "recorded_at": "2026-07-04T07:12:20.000Z" },
      { "lat": 21.1458, "lng": 79.0882, "speed_kmh": 62, "heading": 39,  "recorded_at": "2026-07-04T09:29:50.000Z" }
    ]
  }
}
```

---

### 4.4 `GET /api/tracking/pumps/:bookingId`

**Top-8 nearest petrol pumps** to the truck's current live position (Decision 6).

- **Query params (all optional):**
  - `limit` — default **8** (LOCKED default), cap 8 for the pilot *(INFERRED — confirm cap)*.
  - `radius_m` — search radius in metres (INFERRED default `5000` — confirm).
- **Request body:** none.
- **Google API / tier:** **Places API (New)** — `places:searchNearby`, `includedTypes: ["gas_station"]`, ranked by distance from the current location. **Legacy Places API is BLOCKED** — do not use.
- **Cache key / TTL:** `trk:pumps:{bookingId}` — **TTL 120s** *(INFERRED — confirm; pumps change slowly but the anchor location moves)*.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "booking_id": "b1f2c3d4-0000-4000-8000-000000000001",
    "origin": { "lat": 21.1458, "lng": 79.0882 },
    "limit": 8,
    "pumps": [
      {
        "place_id": "ChIJ_pump_0001",
        "name": "Indian Oil Petrol Pump",
        "lat": 21.1502, "lng": 79.0910,
        "distance_m": 480,
        "address": "NH-44, Nagpur, Maharashtra",
        "brand": "Indian Oil"
      },
      {
        "place_id": "ChIJ_pump_0002",
        "name": "HP Highway Fuels",
        "lat": 21.1401, "lng": 79.0955,
        "distance_m": 910,
        "address": "Ring Road, Nagpur, Maharashtra",
        "brand": "HPCL"
      }
    ]
  }
}
```

---

### 4.5 `GET /api/tracking/fuel/:bookingId`

**Fuel-cost estimate** for the trip (Decision 4).
`fuel = distance_km / mileage_kmpl × diesel_price`.

- **Query params (all optional overrides):**
  - `vehicle_class` — one of `MCV` | `HCV` (medium/heavy commercial big-truck classes). Prefills `mileage_kmpl`.
  - `mileage_kmpl` — override the prefilled class mileage.
  - `diesel_price` — override `DIESEL_PRICE_INR` (default 90).
  - `distance_km` — override the route distance (else taken from the cached base route §4.1).
- **Request body:** none.
- **Google API / tier:** **none** (arithmetic over the cached route distance).
- **Cache key / TTL:** `trk:fuel:{bookingId}` — **not cached when overrides are present**; base (no-override) result MAY cache at `trk:fuel:{bookingId}` **TTL 3600s** *(INFERRED — confirm)*.

Prefilled mileage by class *(INFERRED values — confirm the exact kmpl per class)*: `MCV ≈ 6.0 kmpl`, `HCV ≈ 3.5 kmpl`.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "booking_id": "b1f2c3d4-0000-4000-8000-000000000001",
    "vehicle_class": "HCV",
    "distance_km": 1412.6,
    "mileage_kmpl": 3.5,
    "diesel_price_inr": 90,
    "litres_required": 403.6,
    "estimated_fuel_cost_inr": 36324,
    "inputs_overridden": false
  }
}
```

---

### 4.6 `GET /api/tracking/alerts/:bookingId`

Computed **route alerts** from the live position vs the cached route and recent history (Decision 7).

- **Query params:** none.
- **Request body:** none.
- **Google API / tier:** **none** (geometry over cached route §4.1 + live position + recent `location_history`).
- **Cache key / TTL:** `trk:alerts:{bookingId}` — **TTL 30s** *(INFERRED — confirm)*.
- **Thresholds (LOCKED, tunable after first real drive):**
  - `off_route` → truck is **> 500 m** from the base polyline.
  - `idle` → no meaningful movement for **> 15 min**.
  - `near_drop` → truck is **within 2 km** of the destination.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "booking_id": "b1f2c3d4-0000-4000-8000-000000000001",
    "evaluated_at": "2026-07-04T09:30:00.000Z",
    "current_location": { "lat": 21.1458, "lng": 79.0882, "updated_at": "2026-07-04T09:29:50.000Z" },
    "alerts": [
      { "type": "off_route",  "active": false, "value_m": 120,  "threshold_m": 500 },
      { "type": "idle",       "active": false, "idle_seconds": 45, "threshold_seconds": 900 },
      { "type": "near_drop",  "active": false, "distance_to_drop_m": 842300, "threshold_m": 2000 }
    ]
  }
}
```

---

### 4.7 `GET /api/tracking/track/:bookingId`  — **[LOCKED #8]**

The **shipper read-through / aggregate read-model**: current location + route + live ETA + status in **ONE** call. This endpoint's identity, path, and role are LOCKED and MUST NOT change.

- **Query params:** none.
- **Request body:** none.
- **Google API / tier:** aggregates §4.1 (Routes Essentials) + §4.2 (Routes TRAFFIC_AWARE/Pro); serves from the underlying caches (`trk:route:*`, `trk:eta:*`) so it does not multiply Google calls.
- **Cache key / TTL:** composes the component caches; own envelope MAY cache at `trk:track:{bookingId}` **TTL 10s** to match poll cadence *(INFERRED — confirm)*.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "booking_id": "b1f2c3d4-0000-4000-8000-000000000001",
    "status": "in_transit",
    "current_location": {
      "lat": 21.1458, "lng": 79.0882,
      "heading": 39, "speed_kmh": 62,
      "updated_at": "2026-07-04T09:29:50.000Z"
    },
    "route": {
      "polyline": "yx}mCwzr{Lg@... (Google encoded polyline)",
      "distance_km": 1412.6,
      "source": { "lat": 19.0760, "lng": 72.8777 },
      "destination": { "lat": 28.7041, "lng": 77.1025 }
    },
    "eta": {
      "eta_seconds": 41400,
      "eta_iso": "2026-07-04T20:59:50.000Z",
      "remaining_distance_km": 842.3,
      "in_traffic": true
    },
    "served_at": "2026-07-04T09:30:00.000Z"
  }
}
```

**Response when no live position yet:** `current_location` and `eta` are `null`, `route` still populated, `status` reflects the booking (e.g. `"accepted"`).

---

### 4.8 Endpoint summary

| # | Method | Path | Google API / tier | Cache key | TTL |
|---|---|---|---|---|---|
| — | GET | `/health` | none | — | — |
| 1 | GET | `/api/tracking/route/:bookingId` | Routes API — Essentials/static | `trk:route:{bookingId}` | 24h *(INF)* |
| 2 | GET | `/api/tracking/eta/:bookingId` | Routes API — TRAFFIC_AWARE/Pro | `trk:eta:{bookingId}` | 60s *(INF)* |
| 3 | GET | `/api/tracking/history/:bookingId` | none (DB read) | `trk:history:{bookingId}` | 15s *(INF)* |
| 4 | GET | `/api/tracking/pumps/:bookingId` | Places API (New) — searchNearby | `trk:pumps:{bookingId}` | 120s *(INF)* |
| 5 | GET | `/api/tracking/fuel/:bookingId` | none (arithmetic) | `trk:fuel:{bookingId}` | 1h base *(INF)* |
| 6 | GET | `/api/tracking/alerts/:bookingId` | none (geometry) | `trk:alerts:{bookingId}` | 30s *(INF)* |
| 8 | GET | `/api/tracking/track/:bookingId` | Routes (composed, cached) | `trk:track:{bookingId}` | 10s *(INF)* |

*(Only the 500m / 15min / 2km thresholds, the top-8 pump default, the Essentials-vs-Pro tier split, the endpoint set/paths, and the `:bookingId` + snake_case conventions are LOCKED. All numeric TTLs and limits marked (INF) are INFERRED starting points to confirm.)*

---

## 5. Data Contract — `location_history` (migration 009)

Migration **009 ENABLES** a new `location_history` breadcrumb table in Supabase Postgres. **No PostGIS** — `lat`/`lng` are plain decimals. The existing `trip_events` table continues to carry the lat/lng audit trail; `location_history` is the dense movement breadcrumb (throttled **~1 point / 10-15s**, Decision 2).

**Proposed columns** *(INFERRED — confirm exact column names/types against the actual migration 009 file when it lands)*:

| Column | Type | Notes |
|---|---|---|
| `id` | `bigint` / `uuid` PK | breadcrumb id |
| `booking_id` | `uuid` | FK → `bookings.id`; primary read key for `/history` |
| `driver_id` | `uuid` | FK → driver |
| `lat` | `numeric` / `double precision` | plain decimal, no PostGIS |
| `lng` | `numeric` / `double precision` | plain decimal, no PostGIS |
| `heading` | `numeric` null | degrees 0–360 |
| `speed_kmh` | `numeric` null | |
| `accuracy_m` | `numeric` null | GPS accuracy |
| `recorded_at` | `timestamptz` | device/ingest capture time; ordering + `since` filter |
| `created_at` | `timestamptz` default `now()` | row insert time |

Suggested index *(INFERRED — confirm)*: `(booking_id, recorded_at)`.

### 5.1 Read / Write ownership (CRITICAL)

- **WRITE owner = `bt-booking-service`** (the ingestion path). The throttled breadcrumb insert (~1 point / 10-15s) is performed by the existing GPS ingestion (`POST /location/update`) — the same path that writes the 30s-TTL Redis live position. `bt-tracking-service` **NEVER writes** `location_history`.
  - **(INFERRED — confirm)** The precise throttle mechanism and the exact call-site inside `bt-booking-service` that performs the breadcrumb insert are not spelled out in the locked facts. The *ownership* (booking-service writes) is locked; the *implementation detail* is INFERRED — confirm before build.
- **READ owner = `bt-tracking-service`.** It reads `location_history` (service-role, read-only) to serve `/api/tracking/history/:bookingId` (the traveled-path / history view) and to feed `/alerts` idle detection.

---

## 6. Google Maps Platform — Usage & Cost Rules

**Provider is LOCKED to Google Maps Platform.** Exactly three APIs are enabled; anything else is out of contract.

### 6.1 Allowed (and ONLY these)

| API | Where | Used for |
|---|---|---|
| **Maps JavaScript API** | Browser (`NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`) | Rendering the vector map in `<LiveTrackMap/>` |
| **Routes API** | Server (`GOOGLE_MAPS_SERVER_KEY`) | `/route` (Essentials/static) + `/eta` (TRAFFIC_AWARE/Pro) |
| **Places API (New)** | Server (`GOOGLE_MAPS_SERVER_KEY`) | `/pumps` — `searchNearby`, `gas_station` |

### 6.2 BLOCKED — never reference

- **Legacy Directions API** — blocked for new GCP projects. Use **Routes API** instead.
- **Legacy Places API** — blocked for new GCP projects. Use **Places API (New)** instead.
- Any Google Maps API not in §6.1.

### 6.3 Keys & restriction

- **Two physically separate, restricted keys** (never interchange):
  - `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` — **HTTP-referrer restricted**, Maps JS only, safe to ship to the client.
  - `GOOGLE_MAPS_SERVER_KEY` — **secret**, API-restricted to Routes + Places (New), lives ONLY in `bt-tracking-service`.

### 6.4 Cost control

- Cost cap = **per-API quota limits** + **restricted keys**. A **billing budget only ALERTS — it does NOT cap spend.** Do not rely on the budget as a spend ceiling; the hard cap is the per-API quota.
- Pilot (~20 users) is expected to fit inside Google's **free monthly tiers**.
- Server-side Redis caching (§4 TTLs) is the primary lever to keep Google call volume inside the free tier — `/track` (#8) MUST serve from the `route`/`eta` caches rather than issuing fresh Google calls on every 10s poll.

### 6.5 Phase-0 gate (BEFORE any map code)

The cross-session build runs one phase per session, phases 0–6, strictly sequential. **Phase 0 is a hard gate that must complete before any map code:**
1. Create the GMP/GCP project.
2. Enable the **3 APIs** (Maps JS, Routes, Places New).
3. Create the **2 restricted keys** (browser referrer-restricted; server secret).
4. Set **per-API quota caps**.

Testing (later phases): real Android drive tests on the pilot corridor + a **route-replay GPS simulator** (replays a recorded path so movement is testable without driving). **Geolocation requires HTTPS (secure context)** for phone testing.

---

## 7. Frontend Contract

- **No map library is installed yet.** The React map layer MUST use **`@vis.gl/react-google-maps`**.
- **No shared npm package** (Decision 8): `driver/` and `shipper/` are separate Next.js 16 / React 19 projects, so the `<LiveTrackMap/>` component is **COPIED** into each app. Keep the two copies in sync manually.
- Per-app deliverables:
  - **shipper/** → `<LiveTrackMap/>` (live-tracking map: moving truck marker + route polyline + ETA, fed by `/api/tracking/track/:bookingId`).
  - **driver/** → `<LiveTrackMap/>` (navigation view) + insights (pumps / fuel / alerts) + the deep-link nav helper.
- **PWA basics now** (Decision 3): minimal PWA manifest + service worker; use the **Screen Wake Lock API** to keep the driver screen on during a drive.

### 7.1 `<LiveTrackMap/>` props

```ts
type LatLng = { lat: number; lng: number }

interface LiveTrackMapProps {
  /** Booking whose trip is being shown; drives all /api/tracking/:bookingId reads. */
  bookingId: string

  /** Live truck position (from the existing 10s poll of booking-service). Null until first fix. */
  currentLocation: (LatLng & {
    heading?: number | null
    speed_kmh?: number | null
    updated_at?: string
  }) | null

  /** Cached base route to draw as a polyline. Google encoded polyline string. */
  routePolyline?: string | null

  /** Trip endpoints for the source/destination markers. */
  source?: LatLng | null
  destination?: LatLng | null

  /** Traveled breadcrumb trail (from /history) to draw behind the truck. Optional. */
  historyPath?: LatLng[]

  /** Live ETA label to overlay, seconds to drop. */
  etaSeconds?: number | null

  /** Vector Map ID — pass NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID. */
  mapId: string

  /** Browser Maps-JS key — pass NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY. */
  apiKey: string

  /** Fit/center behavior. Default: follow the truck. */
  follow?: boolean

  /** Optional height (CSS). Default 100%. */
  height?: string | number

  /** Fired when the user taps the truck/marker (e.g. open detail). */
  onMarkerClick?: () => void
}
```
*(INFERRED — the exact prop set is a proposed shape; only "component is `@vis.gl/react-google-maps`-based, copied per app, consumes the locked endpoints and the locked env keys" is frozen. Confirm prop names at build.)*

### 7.2 Deep-link navigation helper

Navigation is a **deep-link handoff to the phone's Google Maps app** — **NOT** in-app turn-by-turn. Same behaviour on the web PWA now and React Native later.

```ts
/**
 * Build a deep link that hands the driver off to the phone's Google Maps app.
 * - iOS  → comgooglemaps:// (falls back to the https URL if the app is absent)
 * - Else → https://www.google.com/maps/dir/ universal URL
 * Returns a URL string to open (window.open / <a href> / location.assign).
 */
function buildNavDeepLink(args: {
  destination: LatLng
  origin?: LatLng           // optional; omit to let Google use the phone's current location
  travelMode?: 'driving'    // pilot = driving
}): string
```

Locked URL bases: `https://www.google.com/maps/dir/` (universal) and `comgooglemaps://` (iOS). Do not build a custom in-app navigator.

---

## 8. Conventions & Change Control

### 8.1 Conventions (FROZEN)

- **JSON is snake_case** everywhere (request and response).
- **All tracking endpoints are namespaced under `/api/tracking/…`** and use the **`:bookingId`** path param.
- **Endpoint #8 is LOCKED:** `GET /api/tracking/track/:bookingId` is the shipper read-through aggregate (current location + route + live ETA + status in one call).
- **Petrol-pump search default limit = 8.**
- **Auth:** every `/api/tracking/*` route is JWT-gated (same JWT/`JWT_SECRET` as the other services); `/health` is open.

### 8.2 Success shape

```json
{ "success": true, "data": { /* endpoint-specific, snake_case */ } }
```

### 8.3 Error shape (matches `bt-booking-service` / `bt-auth-service`)

```json
{ "success": false, "error": "human-readable message", "code": "MACHINE_CODE" }
```

- The HTTP status carries the category; `code` is a stable machine string.
- Reuse the existing codes/recipe: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `INVALID_TRANSITION` (409), and an internal `500` `{ "success": false, "error": "Internal server error" }`. Implement via a `TrackingError` class mirroring `BookingError` (`message`, `code`, `httpStatus`). Validate params/query with `zod`.

Example (unknown booking):
```json
{ "success": false, "error": "Booking b1f2c3d4-... not found", "code": "NOT_FOUND" }
```

### 8.4 FROZEN — change control

**This CONTRACT is frozen.** Any change to a LOCKED item — the endpoint set/paths, endpoint #8's identity, the snake_case/`:bookingId` conventions, the env-key names, the provider/API choice (Routes + Places New + Maps JS; legacy blocked), the deep-link nav model, the 500m / 15min / 2km alert thresholds, the top-8 pump default, the Essentials-vs-Pro tier split, the write-owner = booking-service rule, or the "copy `<LiveTrackMap/>` per app" rule — **requires a new `D-xxx` decision** recorded and referenced here before implementation. Items tagged **(INFERRED — confirm)** are NOT frozen and should be pinned down during build, but pinning them still updates this doc.

**On any conflict with the PLAN narrative, this CONTRACT wins.**
