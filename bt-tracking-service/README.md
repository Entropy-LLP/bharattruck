# bt-tracking-service

Live-tracking & maps service for BharatTruck. A **server-side Google Maps proxy with Redis caching** — it owns the cached route polyline, traffic-aware ETA, breadcrumb history, petrol-pump search, fuel estimate, route alerts, and the shipper read-through aggregate. It does **not** ingest raw GPS (that stays in `bt-booking-service`); it consumes the live position and adds the derived/map logic.

**Port:** `3006`
**Stack:** Node.js 20 · TypeScript · Fastify 4 · Redis (ioredis) · Supabase · Google Maps Platform (Routes API + Places API New)

---

## Quickstart

```bash
cp .env.example .env        # fill in secrets (server Maps key, Supabase, Redis, JWT)
npm install
npm run dev                 # tsx watch — hot reload
```

```bash
npm run build && npm start  # production (tsc -> node dist/index.js)
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Defaults to `3006` |
| `NODE_ENV` | No | `development` enables `pino-pretty` logs |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service-role key (reads bookings/drivers) |
| `REDIS_URL` | Yes | Read-only on `loc:*` (live position from booking); writes `trk:*` cache |
| `JWT_SECRET` | Yes | Validates tokens issued by `bt-auth-service` (`{userId, role}`) |
| `GOOGLE_MAPS_SERVER_KEY` | Yes | **Secret** server key — restricted to Routes API + Places API (New). Never expose to the browser / `NEXT_PUBLIC`. |
| `ROUTE_CACHE_TTL_SECONDS` | No | Route/ETA cache TTL (default `21600`) — cost guardrail against hammering Routes API |
| `DIESEL_PRICE_INR` | No | Fallback diesel price for fuel estimate (default `90`, editable per request) |

> The browser side uses two **separate** public keys (`NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`) that live in the driver/shipper apps — never in this service.

---

## API

All routes are JWT-gated except `/health`. The gateway exposes them under `/api/tracking/*`.

| Method | Path | Status | Description |
|--------|------|--------|-------------|
| `GET`  | `/health` | ✅ | Liveness probe (unauth) — `{status, service, ts}` |
| `POST` | `/tracking/route/:bookingId` | ✅ | Compute + cache the base route polyline (Routes API, Essentials tier) |
| `GET`  | `/tracking/route/:bookingId` | ✅ | Return the cached base route |
| `GET`  | `/tracking/eta/:bookingId` | ✅ | Live traffic-aware ETA (Routes API, TRAFFIC_AWARE/Pro, short TTL) |
| `GET`  | `/tracking/track/:bookingId` | ✅ | **Shipper read-through** — current location + route + ETA + status in one call |
| `GET`  | `/tracking/history/:bookingId` | ⬜ Phase 3 | Traveled breadcrumb trail from `location_history` (migration 009) |
| `GET`  | `/tracking/pumps/:bookingId` | ⬜ Phase 5 | Top-8 petrol pumps near current location (Places API New) |
| `GET`  | `/tracking/fuel/:bookingId` | ⬜ Phase 5 | Fuel estimate (mileage-by-class × diesel price) |
| `GET`  | `/tracking/alerts/:bookingId` | ⬜ Phase 5 | Off-route / idle / near-drop alerts |

---

## Build status

Maps & Tracking build (see `docs/MAPS_TRACKING_*` in the `LogisticOS` monorepo):

- ✅ **Phase 0** — Google Maps Platform project, 3 APIs (Maps JS, Routes, Places New), 2 restricted keys, per-API quota caps, ₹50 budget alert.
- ✅ **Phase 1 + 2** — service skeleton + `/route`, `/eta`, `/track` + shipper live map.
- ⬜ **Phase 3** — migration 009 `location_history` + `/history` breadcrumbs.
- ⬜ **Phase 4** — `<LiveTrackMap/>` polish + deep-link nav helper.
- ⬜ **Phase 5** — driver navigation view + `/pumps` + `/fuel` + `/alerts` insights.
- ⬜ **Phase 6** — PWA manifest + service worker + wake lock + route-replay GPS simulator + corridor drive test.

## Conventions

- JSON is **snake_case**; endpoints use a `:bookingId` path param.
- Navigation is a **deep-link handoff** to the phone's Google Maps app — no in-app turn-by-turn.
- Only **Routes API + Places API (New) + Maps JS** — legacy Directions/Places are blocked for this GCP project.
- The frozen interface contract is `docs/BIBLE.md §3.1`; decisions log is `docs/BIBLE.md §3.2` (append-only,
  currently at D-013 — this file previously said "D-016," which doesn't match the log's actual git
  history (a single commit, never amended past D-013); corrected 2026-07-20, re-verify if you know of a
  newer decision that didn't make it into the log).
