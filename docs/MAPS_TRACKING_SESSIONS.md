# BharatTruck — Maps & Tracking SESSIONS (build playbook)

> **What this is.** A per-phase, copy-paste session playbook for building the **Maps & Tracking** feature **ONE phase per Claude session**, phases **0 → 6, strictly sequential**. Each phase has a ready-to-paste **kickoff prompt** and a concrete **Definition-of-Done (DoD)** checklist.
>
> **Source of truth.** [`docs/MAPS_TRACKING_CONTRACT.md`](MAPS_TRACKING_CONTRACT.md) is **FROZEN** and wins on any conflict with this playbook. This file is *operational* (how to run each session); the CONTRACT is *normative* (what is locked). If this playbook ever contradicts the CONTRACT, the CONTRACT wins — fix this file.
>
> **Golden rules for every session:**
> 1. **Do exactly ONE phase.** Do not start the next phase "while you're here." Stop at the phase's DoD.
> 2. **Never violate a LOCKED item.** Endpoint set/paths, endpoint #8 identity, snake_case + `:bookingId`, env-key names, provider/API choice (Routes + Places New + Maps JS; legacy blocked), deep-link nav, the 500m/15min/2km thresholds, top-8 pumps, Essentials-vs-Pro split, write-owner = booking-service, copy-`<LiveTrackMap/>`-per-app. Changing any of these needs a new **`D-xxx`** decision first.
> 3. **Production-ready only.** No stubs, no TODOs, no `throw new Error('not implemented')`. Every endpoint returns real data or a real, typed error.
> 4. **Items tagged `(INFERRED — confirm)`** in the CONTRACT are *not* frozen. Pin them down during the phase that touches them, then record the pin as a `D-xxx` and update the CONTRACT.

---

## START ritual (run at the top of EVERY session)

Paste this before anything else. It reloads the frozen context and forces you to name the phase.

```
START RITUAL — Maps & Tracking build session.

1. Read docs/MAPS_TRACKING_CONTRACT.md IN FULL. It is FROZEN and wins on any conflict.
2. Read docs/MAPS_TRACKING_SESSIONS.md §"Decisions log (D-xxx)" and §"Phase status board" below.
3. Read the target service/app roadmap for the phase:
   - service phases → bt-tracking-service/ROADMAP.md
   - shipper phase  → shipper/  app + its ROADMAP
   - driver phase   → driver/   app + its ROADMAP
4. Confirm OUT LOUD, in one line each:
   - Which phase am I doing this session? (exactly ONE of 0–6)
   - Is the PREVIOUS phase's DoD fully checked? If not, STOP — finish it first (phases are sequential).
   - Which LOCKED items does this phase touch, and how will I stay inside them?
   - Which (INFERRED — confirm) values will I pin this session?
5. Only then start work on that single phase.
```

**Sequencing gate:** Phase N may begin only when Phase N-1's DoD is 100% checked on the Phase status board. Phase 0 is a **hard gate** — no map code, no service code that calls Google, until Phase 0's DoD is green.

---

## END ritual (run before you end EVERY session)

```
END RITUAL — before ending this session:

1. Re-open docs/MAPS_TRACKING_CONTRACT.md and confirm I contradicted NOTHING locked.
2. Tick this phase's DoD checklist in docs/MAPS_TRACKING_SESSIONS.md. If any box is unticked, say so explicitly and mark the phase "IN PROGRESS", not "DONE".
3. Update the "Phase status board" below (⛔→🟡→✅) with a one-line note + date.
4. For every (INFERRED — confirm) value I pinned: append a D-xxx row to the "Decisions log" here AND update the matching line in the CONTRACT (the CONTRACT is the source of truth; this log is the change history).
5. Update the relevant ROADMAP.md (bt-tracking-service / shipper / driver) checkboxes.
6. Commit on a feature branch (never commit straight to main); do NOT push unless asked. Suggested branch names per phase are in each section.
7. State the NEXT phase and its one-line entry condition. Do not start it.
```

---

## Phase status board

_Update in the END ritual. Legend: ⛔ not started · 🟡 in progress · ✅ done._

| Phase | Scope | Status | Note / date |
|---|---|---|---|
| 0 | GMP/GCP project + 3 APIs + 2 restricted keys + per-API quota caps (NO code) | ⛔ | — |
| 1 | `bt-tracking-service` skeleton (Fastify, 3006, `/health`, config, Dockerfile, git+remote) + Redis + Google proxy scaffold | ⛔ | — |
| 2 | `/route` + `/eta` with Redis caching | ⛔ | — |
| 3 | migration 009 `location_history` + `/history` read | ⛔ | — |
| 4 | shipper `<LiveTrackMap/>` + `GET /api/tracking/track/:bookingId` + deep-link helper | ⛔ | — |
| 5 | driver nav view + `/pumps` + `/fuel` + `/alerts` | ⛔ | — |
| 6 | PWA manifest + service worker + wake lock + route-replay GPS simulator + drive-test checklist | ⛔ | — |

---

## Decisions log (D-xxx)

> Every time you pin an `(INFERRED — confirm)` value, or make any new call the CONTRACT doesn't already lock, add a row here **and** edit the CONTRACT line. Format: `D-xxx | date | phase | what changed | from → to`.

| ID | Date | Phase | Decision | From → To |
|---|---|---|---|---|
| D-000 | 2026-06-18 | — | Base contract frozen (8 decisions, endpoint set, env keys, provider) | — |
| _(append below as you build)_ | | | | |

**Pre-seeded pin checklist (each becomes a D-xxx when confirmed):**
- TTLs: `route` 24h · `eta` 60s · `history` 15s · `pumps` 120s · `fuel` 1h · `alerts` 30s · `track` 10s.
- Limits: `/history` default 500 / max 2000 · `/pumps` `radius_m` default 5000, cap 8.
- Mileage-by-class: `MCV ≈ 6.0 kmpl`, `HCV ≈ 3.5 kmpl`.
- Live-position read mode: `BOOKING_SERVICE_URL` HTTP read-through **vs** direct Redis read of shared `loc:*` keys.
- `location_history` exact columns/index (confirm against the real migration 009).
- CORS `origin: true` for the tracking service.

---

# Phase 0 — GMP/GCP gate (NO map code)

**Goal:** stand up the Google Maps Platform footprint so later phases have keys and quota caps. **Zero code this session** — this is a console/CLI + secrets phase. It is a hard gate.

**Entry condition:** none (this is the first phase).

### Kickoff prompt (paste)

```
Do the START RITUAL. Phase 0 only — the GMP/GCP gate. NO map code, NO service code this session.

Deliver, using the LOCKED env-key names from the CONTRACT §3:
1. A GCP project for Maps (or confirm the target project) with BILLING enabled.
2. Enable EXACTLY these 3 APIs — nothing else:
   - Maps JavaScript API
   - Routes API
   - Places API (New)
   Legacy Directions API and legacy Places API are BLOCKED — never enable or reference them.
3. Create TWO physically separate, restricted API keys:
   - NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY — HTTP-referrer restricted, allowed API = Maps JavaScript API ONLY. Referrers must include the driver + shipper PWA prod/preview/local origins.
   - GOOGLE_MAPS_SERVER_KEY — SECRET, API-restricted to Routes API + Places API (New) ONLY. Never NEXT_PUBLIC_. Lives only in bt-tracking-service.
4. Create/record NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID — a vector Map ID for styled maps.
5. Set PER-API QUOTA CAPS on Routes, Places (New), and Maps JS sized for a ~20-user pilot inside Google's free monthly tiers. Remember: a billing budget only ALERTS, it does NOT cap spend — the hard cap is the per-API quota.
6. Also set a billing BUDGET ALERT (informational only).
7. Write down (in bt-tracking-service/.env.example placeholders + the team secret store) where each key lives. Do NOT commit real key values to git.

Since this is a console/gcloud phase and this session may be non-interactive: produce an exact, copy-paste RUNBOOK (gcloud commands + console click-paths) and a filled-in checklist of what a human must click, so the human can execute and confirm. Record the resulting key restrictions and quota numbers back into this playbook's Decisions log.

Finish with the END RITUAL. Do NOT start Phase 1.
```

### Definition of Done — Phase 0

- [ ] GCP project chosen/created; billing enabled.
- [ ] Exactly the 3 APIs enabled: **Maps JavaScript API**, **Routes API**, **Places API (New)**. No legacy Directions/Places anywhere.
- [ ] `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` created, **referrer-restricted**, **Maps JS only**, referrers cover driver + shipper origins (prod + preview + `localhost`).
- [ ] `GOOGLE_MAPS_SERVER_KEY` created, **secret**, **API-restricted to Routes + Places (New) only**, never `NEXT_PUBLIC_`.
- [ ] `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` (vector Map ID) recorded.
- [ ] **Per-API quota caps** set on all 3 APIs (the hard cost cap), sized for the pilot free tier.
- [ ] Billing **budget alert** set (understood as alert-only, not a cap).
- [ ] Key locations documented in the secret store + `.env.example` placeholders; **no real key values committed**.
- [ ] Runbook (gcloud + console click-path) written so a human can reproduce.
- [ ] `bt-tracking-service/ROADMAP.md` Phase-0 boxes ticked; status board + decisions log updated.

**Suggested branch:** _n/a (no code)_ — commit only `.env.example` placeholders + runbook doc if anything is written.

---

# Phase 1 — `bt-tracking-service` skeleton + Redis + Google proxy scaffold

**Goal:** a running Fastify service on **port 3006** with `/health`, config loading, Redis plugin, JWT auth plugin, the Google client scaffold, a Dockerfile, and its own git repo + GitHub remote. **No tracking endpoints with real Google calls yet** — just the wiring, so `/health` is green and the app boots.

**Entry condition:** Phase 0 DoD is ✅ (the two keys + Map ID exist to drop into env).

### Kickoff prompt (paste)

```
Do the START RITUAL. Phase 1 only — scaffold bt-tracking-service. Follow the CONTRACT §2 folder layout and bootstrap shape EXACTLY. Mirror the recipe already used by bt-booking-service and bt-auth-service (read bt-booking-service/src/index.ts, plugins/auth.ts, lib/redis.ts, lib/supabase.ts, lib/types.ts first and match their conventions).

Build:
1. package.json — "type":"module", Node 20, Fastify ^4, ioredis, @supabase/supabase-js, zod, pino/pino-pretty. Scripts: dev (tsx watch), build (tsc), start (node dist/index.js). tsconfig.json — TS5, ESM, NodeNext, .js import specifiers.
2. src/index.ts — bootstrap EXACTLY per CONTRACT: register cors {origin:true}; GET /health (UNAUTH) returning {status:"ok",service:"bt-tracking-service",ts:ISO}; register redis plugin; then a scoped encapsulation that registers authPlugin + trackingRoutes with prefix "/api/tracking"; listen on Number(process.env.PORT ?? 3006), host 0.0.0.0.
3. src/plugins/redis.ts — ioredis decorate + graceful close (match booking-service).
4. src/plugins/auth.ts — JWT gate, same recipe/secret (JWT_SECRET) as booking-service authPlugin.
5. src/lib/cache.ts — trk: namespace cache-key builders + the TTL constants from CONTRACT §4.8 (route 24h, eta 60s, history 15s, pumps 120s, fuel 1h, alerts 30s, track 10s). These are (INFERRED) — set them as named constants so they are one place to tune.
6. src/lib/google.ts — a Google client SCAFFOLD for Routes API + Places API (New) using GOOGLE_MAPS_SERVER_KEY. Real request builders can be thin now; NO calls wired into routes yet. Never reference legacy Directions/Places.
7. src/lib/supabase.ts — service-role client (read-only usage later).
8. src/lib/booking.ts — a typed helper to read live position from booking-service/Redis (implement in a later phase; define the interface + BOOKING_SERVICE_URL config now).
9. src/lib/types.ts — snake_case DTOs + a TrackingError class mirroring BookingError (message, code, httpStatus) and the §8.3 error codes.
10. src/routes/tracking.ts — register the route MODULE (can be empty/placeholder handlers returning NOT_IMPLEMENTED-shaped 501? NO — do not ship stubs). Instead register ZERO endpoints this phase beyond what compiles; the endpoints come in Phases 2–5. Keep the module so the prefix wiring is proven.
11. .env.example with ALL CONTRACT §3 keys (PORT=3006, NODE_ENV, REDIS_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET, GOOGLE_MAPS_SERVER_KEY, DIESEL_PRICE_INR=90, BOOKING_SERVICE_URL, and the two NEXT_PUBLIC_ keys documented as browser-side). Placeholders only, no real values.
12. Dockerfile — multi-stage node:20-alpine (deps/development/builder/production), USER node, EXPOSE 3006 — mirror booking-service's Dockerfile.
13. Initialize a git repo in bt-tracking-service/, create the GitHub remote (gh repo create under the same org as bt-booking-service), .gitignore node_modules/dist/.env, first commit on a feature branch.

Prove it: npm i, npm run build (tsc clean), npm run dev, curl http://localhost:3006/health → 200 {status:"ok"...}. A protected /api/tracking/* placeholder (if any) returns 401 without a JWT.

Finish with the END RITUAL. Do NOT start Phase 2.
```

### Definition of Done — Phase 1

- [ ] Folder layout matches CONTRACT §2 exactly (`index.ts`, `plugins/{auth,redis}.ts`, `lib/{google,cache,supabase,booking,types}.ts`, `routes/tracking.ts`).
- [ ] `npm run build` (tsc) is clean; `npm run dev` boots; `GET /health` → `200 {status:"ok",service:"bt-tracking-service",ts}`.
- [ ] Bootstrap order matches CONTRACT: cors → `/health` (unauth) → redis → scoped(auth + tracking routes at `/api/tracking`) → listen `PORT ?? 3006` on `0.0.0.0`.
- [ ] Redis plugin connects + closes gracefully; JWT auth plugin rejects missing/invalid token with `401 UNAUTHORIZED` (same recipe as booking-service).
- [ ] `lib/cache.ts` exposes the `trk:` key builders + TTL constants (single tuning point).
- [ ] `lib/types.ts` has `TrackingError` + the §8.3 codes; success/error envelopes match §8.2/§8.3.
- [ ] `lib/google.ts` scaffolds **Routes + Places (New)** only, keyed by `GOOGLE_MAPS_SERVER_KEY`; no legacy API references anywhere.
- [ ] `.env.example` has every CONTRACT §3 key as a placeholder; no real secrets committed; `.gitignore` covers `node_modules/dist/.env`.
- [ ] Multi-stage `node:20-alpine` Dockerfile, `USER node`, `EXPOSE 3006`.
- [ ] `bt-tracking-service` is its own git repo with a GitHub remote created; first commit on a feature branch.
- [ ] ROADMAP + status board + decisions log updated (record the TTL constants as pinned D-xxx if you froze them).

**Suggested branch:** `feat/tracking-skeleton`

---

# Phase 2 — `/route` + `/eta` (Google Routes + Redis caching)

**Goal:** the two Routes-API endpoints, correctly split by tier, each cached. `/route` = Essentials/static (long TTL). `/eta` = TRAFFIC_AWARE/Pro (short TTL), origin = live position from booking-service.

**Entry condition:** Phase 1 DoD ✅ (service boots, Google client scaffold + cache exist).

### Kickoff prompt (paste)

```
Do the START RITUAL. Phase 2 only — implement GET /api/tracking/route/:bookingId and GET /api/tracking/eta/:bookingId per CONTRACT §4.1 and §4.2. Both JWT-gated, snake_case, :bookingId, success/error envelopes per §8.

Implement lib/booking.ts for real this phase: read the live truck position that bt-booking-service owns (30s-TTL Redis). Confirm the read mode — BOOKING_SERVICE_URL HTTP read-through vs direct Redis read of shared loc:* keys — pick one, record it as a D-xxx, and update the CONTRACT (§3 BOOKING_SERVICE_URL note). Do NOT re-ingest GPS here.

/route:
- Routes API computeRoutes, Essentials/static tier, routingPreference: TRAFFIC_UNAWARE. Do NOT request traffic here.
- Origin/destination = the booking's source/drop (fetch booking source/dest — from booking-service or Supabase, whichever the other services use).
- Return: booking_id, source{lat,lng,address}, destination{...}, polyline (Google encoded), distance_km, static_duration_seconds, provider "google_routes", tier "essentials", cached_at.
- Cache trk:route:{bookingId}, TTL from lib/cache.ts (24h, INFERRED). Serve from cache on hit; only call Google on miss.

/eta:
- Routes API computeRoutes, TRAFFIC_AWARE/Pro tier (Decision 1). Origin = live position (booking-service), destination = booking drop.
- Return per §4.2: current_location{lat,lng,updated_at}, destination, eta_seconds, eta_iso, remaining_distance_km, in_traffic, provider, tier "traffic_aware_pro", computed_at.
- If NO recent live position (driver offline / >30s TTL expired): return 200 {success:true, data:null, message:"No recent driver location — ETA unavailable"} EXACTLY per §4.2.
- Cache trk:eta:{bookingId}, TTL 60s (INFERRED).

Validate path/query with zod. Unknown booking → 404 NOT_FOUND per §8.3. Google/network failure → mapped TrackingError, never a raw 500 leak of provider internals. Handle Google quota/error responses gracefully.

Test: with a real bookingId and a seeded live position, hit both endpoints, confirm cache HIT on second call (no second Google call — log/verify), confirm the null-position branch on /eta.

Finish with the END RITUAL. Do NOT start Phase 3.
```

### Definition of Done — Phase 2

- [ ] `GET /api/tracking/route/:bookingId` returns the §4.1 shape; uses **Routes API Essentials / `TRAFFIC_UNAWARE`**; `tier: "essentials"`.
- [ ] `GET /api/tracking/eta/:bookingId` returns the §4.2 shape; uses **Routes API `TRAFFIC_AWARE`/Pro**; `tier: "traffic_aware_pro"`.
- [ ] `/eta` origin is the **live position from booking-service** (30s Redis); GPS is **not** re-ingested here.
- [ ] `/eta` null-position branch returns the **exact** `{success:true, data:null, message:"No recent driver location — ETA unavailable"}`.
- [ ] Redis caching works: `trk:route:*` (24h) and `trk:eta:*` (60s); second call within TTL is a **cache HIT with no extra Google call** (verified via log/counter).
- [ ] Both endpoints JWT-gated; snake_case; `:bookingId`; zod-validated; unknown booking → `404 NOT_FOUND`; Google failures → typed `TrackingError`, no provider-internal leak.
- [ ] Live-position read mode **decided + recorded as D-xxx** and CONTRACT §3 updated.
- [ ] TTL values confirmed/pinned as D-xxx if changed from the INFERRED defaults.
- [ ] ROADMAP + status board + decisions log updated.

**Suggested branch:** `feat/tracking-route-eta`

---

# Phase 3 — migration 009 `location_history` + `/history`

**Goal:** the breadcrumb table and the read endpoint. **WRITE ownership stays in bt-booking-service** — this service is READ-ONLY on `location_history`. Confirm/author migration 009, then serve `/history`.

**Entry condition:** Phase 2 DoD ✅.

### Kickoff prompt (paste)

```
Do the START RITUAL. Phase 3 only — migration 009 location_history + GET /api/tracking/history/:bookingId per CONTRACT §4.3 and §5.

CRITICAL ownership (LOCKED, CONTRACT §5.1): WRITE owner = bt-booking-service (the ingestion path). bt-tracking-service NEVER writes location_history. This service is READ-ONLY.

1. Migration 009: locate or author the location_history migration in the project's migration home (check how other services version DB — ROADMAP notes migrations aren't in VCS yet, so this may be the first committed one; follow the Supabase pattern). Columns per §5 (id, booking_id, driver_id, lat, lng, heading, speed_kmh, accuracy_m, recorded_at, created_at), NO PostGIS (plain decimals), index (booking_id, recorded_at). Confirm the EXACT column names/types and record any deviation from the §5 proposal as a D-xxx, then update CONTRACT §5.
2. WRITE side (booking-service): wire the throttled breadcrumb insert (~1 point / 10–15s) into bt-booking-service's existing POST /location/update path (read bt-booking-service/src/routes/location.ts first). This is the write-owner per §5.1 — the throttle mechanism + call-site are INFERRED, so decide them, implement, and record as a D-xxx. Keep the 30s-TTL Redis live position untouched.
3. READ side (this service): GET /api/tracking/history/:bookingId reads location_history (service-role, read-only). Query params (optional): since (ISO-8601, points at/after), limit (default 500, max 2000 — INFERRED, confirm). Return §4.3 shape: booking_id, point_count, points[{lat,lng,speed_kmh,heading,recorded_at}] ordered by recorded_at. Cache trk:history:{bookingId} TTL 15s (INFERRED).

zod-validate since/limit. Unknown booking or no rows → 200 with point_count 0 / empty points (not a 404). JWT-gated, snake_case.

Test: insert breadcrumbs via the booking-service ingestion path (or seed directly), then /history returns them ordered; since filter works; limit caps; cache HIT within TTL.

Finish with the END RITUAL. Do NOT start Phase 4.
```

### Definition of Done — Phase 3

- [ ] Migration 009 `location_history` exists, versioned, **no PostGIS** (plain decimal lat/lng), index on `(booking_id, recorded_at)`; exact columns confirmed and CONTRACT §5 reconciled.
- [ ] **Breadcrumb WRITE lives in bt-booking-service** (throttled ~1pt/10–15s on the existing `POST /location/update` path); throttle + call-site recorded as D-xxx. 30s Redis live position unchanged.
- [ ] `bt-tracking-service` writes **nothing** to `location_history` (read-only service-role usage only).
- [ ] `GET /api/tracking/history/:bookingId` returns the §4.3 shape, ordered by `recorded_at`; `since` + `limit` (default 500 / max 2000, confirmed) work; empty → `point_count:0`, not 404.
- [ ] Cached at `trk:history:*` (15s); cache HIT verified.
- [ ] JWT-gated, snake_case, zod-validated.
- [ ] ROADMAP + status board + decisions log updated (D-xxx for column set, throttle, and any TTL/limit pins).

**Suggested branch (tracking):** `feat/tracking-history` · **(booking):** `feat/booking-breadcrumb-write`

---

# Phase 4 — shipper `<LiveTrackMap/>` + `/track` (#8) + deep-link helper

**Goal:** the shipper sees the truck move on a real Google map, fed by the **LOCKED endpoint #8** aggregate. Build the read-through aggregate, then the shipper map component, then the deep-link nav helper (shared shape; shipper wires it, driver reuses in Phase 5).

**Entry condition:** Phase 3 DoD ✅ (route/eta/history all live; #8 can compose from `trk:route:*` + `trk:eta:*`).

### Kickoff prompt (paste)

```
Do the START RITUAL. Phase 4 only. Three deliverables:

A) BACKEND — GET /api/tracking/track/:bookingId  [LOCKED endpoint #8], CONTRACT §4.7.
   The shipper read-through AGGREGATE: current_location + route + eta + status in ONE call.
   - Compose from the underlying caches (trk:route:*, trk:eta:*) so it does NOT multiply Google calls — MUST serve #8 from those caches, not fresh Google calls per 10s poll (CONTRACT §6.4).
   - Return §4.7 shape exactly: booking_id, status, current_location{lat,lng,heading,speed_kmh,updated_at}, route{polyline,distance_km,source,destination}, eta{eta_seconds,eta_iso,remaining_distance_km,in_traffic}, served_at.
   - No live position yet → current_location and eta = null, route still populated, status reflects the booking (e.g. "accepted"). Per §4.7.
   - Cache trk:track:{bookingId} TTL 10s (INFERRED). JWT-gated, snake_case, :bookingId. Endpoint #8 identity/path is LOCKED — do not rename or move it.

B) FRONTEND (shipper/) — <LiveTrackMap/> using @vis.gl/react-google-maps (install it in shipper/; it is the mandated lib, CONTRACT §7). Props per §7.1 (bookingId, currentLocation, routePolyline, source, destination, historyPath?, etaSeconds, mapId, apiKey, follow?, height?, onMarkerClick?) — confirm the exact prop names and record as D-xxx if adjusted.
   - Vector map via NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID + NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY (browser key ONLY — never the server key in the client).
   - Draw: decoded route polyline, source/dest markers, a moving truck marker (heading-rotated if available), optional history trail behind the truck, an ETA label overlay.
   - Data source = the existing 10s poll, now hitting /api/tracking/track/:bookingId. Replace the raw lat/lng TEXT rendering with the map. follow=true centers on the truck by default.

C) FRONTEND (shipper/) — deep-link nav helper buildNavDeepLink(...) per §7.2 (used more by driver in Phase 5, but land the shared helper now): iOS → comgooglemaps:// with https fallback; else https://www.google.com/maps/dir/. travelMode 'driving'. NOT in-app turn-by-turn.

Note Decision 8: <LiveTrackMap/> is COPIED per app (no shared npm package). This phase builds the shipper copy; Phase 5 copies it into driver and keeps them in sync manually.

Test: shipper trip screen renders the map, truck marker moves as live position updates, route polyline + ETA show, null-position state degrades gracefully. Verify #8 serves from cache (no Google call per poll).

Finish with the END RITUAL. Do NOT start Phase 5.
```

### Definition of Done — Phase 4

- [ ] `GET /api/tracking/track/:bookingId` (**endpoint #8, identity/path unchanged**) returns the §4.7 aggregate shape; JWT-gated, snake_case.
- [ ] #8 **composes from `trk:route:*` + `trk:eta:*` caches** — verified it does **not** issue fresh Google calls on each 10s poll.
- [ ] Null-position branch: `current_location`/`eta` = `null`, `route` populated, `status` from booking.
- [ ] `trk:track:*` cached (10s); cache behavior verified.
- [ ] `@vis.gl/react-google-maps` installed in **shipper/**; `<LiveTrackMap/>` renders a **vector** map via `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` + `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` (browser key only, server key never in client).
- [ ] Map shows: decoded route polyline, source/dest markers, moving truck marker, optional history trail, ETA overlay; raw lat/lng **text is replaced** by the map on the shipper trip screen.
- [ ] Data fed by the existing 10s poll now calling `/api/tracking/track/:bookingId`; `follow` default centers on truck; graceful null-position UI.
- [ ] `buildNavDeepLink(...)` helper implemented per §7.2 (iOS `comgooglemaps://` + https fallback; else universal `https://www.google.com/maps/dir/`); driving mode; no in-app turn-by-turn.
- [ ] Prop names confirmed (D-xxx if adjusted); shipper `next build` passes.
- [ ] ROADMAP + status board + decisions log updated.

**Suggested branches:** `feat/tracking-aggregate` (service) · `feat/shipper-live-map` (shipper)

---

# Phase 5 — driver nav view + `/pumps` + `/fuel` + `/alerts`

**Goal:** the driver app gets the navigation view (map + deep-link handoff) plus the three insight endpoints and their UI: nearest pumps, fuel estimate, route alerts.

**Entry condition:** Phase 4 DoD ✅ (`<LiveTrackMap/>` exists to copy; deep-link helper exists; `/route` cache exists for fuel distance + alerts geometry).

### Kickoff prompt (paste)

```
Do the START RITUAL. Phase 5 only. Backend (3 endpoints) + driver frontend.

BACKEND (bt-tracking-service):
1) GET /api/tracking/pumps/:bookingId — CONTRACT §4.4. Places API (New) places:searchNearby, includedTypes ["gas_station"], anchored at the truck's current live position, ranked by distance. Return TOP-8 (LOCKED default limit=8). limit query default 8 / cap 8 (INFERRED cap — confirm); radius_m default 5000 (INFERRED). Shape §4.4: origin, limit, pumps[{place_id,name,lat,lng,distance_m,address,brand}]. Cache trk:pumps:{bookingId} 120s. Legacy Places API is BLOCKED.
2) GET /api/tracking/fuel/:bookingId — CONTRACT §4.5. Arithmetic only, no Google. fuel = distance_km / mileage_kmpl * diesel_price. vehicle_class MCV|HCV prefills mileage (MCV≈6.0, HCV≈3.5 kmpl — INFERRED, confirm + D-xxx). Overrides: mileage_kmpl, diesel_price (default DIESEL_PRICE_INR=90), distance_km (else from cached base route §4.1). Shape §4.5 incl. litres_required, estimated_fuel_cost_inr, inputs_overridden. Cache base (no-override) trk:fuel:{bookingId} 1h; do NOT cache when overrides present.
3) GET /api/tracking/alerts/:bookingId — CONTRACT §4.6. Geometry only, no Google. Compute over cached route §4.1 + live position + recent location_history. LOCKED thresholds: off_route > 500 m from base polyline; idle > 15 min no meaningful movement; near_drop within 2 km of destination. Shape §4.6: evaluated_at, current_location, alerts[{type,active,...}]. Cache trk:alerts:{bookingId} 30s.

All 3: JWT-gated, snake_case, :bookingId, zod, typed errors, null-position handled gracefully.

FRONTEND (driver/):
- COPY <LiveTrackMap/> from shipper/ into driver/ (Decision 8 — copy per app, no shared package; keep in sync manually). Install @vis.gl/react-google-maps in driver/.
- Driver navigation VIEW: the map + a "Navigate" action that calls buildNavDeepLink (copy the helper too) to hand off to the phone's Google Maps app (comgooglemaps:// on iOS, https universal else). NOT in-app turn-by-turn.
- Insights UI: nearest pumps list (from /pumps), fuel estimate card with editable diesel price + vehicle class (from /fuel), and route-alert banners (from /alerts).

Test: pumps returns ≤8 ranked by distance; fuel math correct with + without overrides and caches only the base; alerts flip active at the locked thresholds (use a seeded off-route/idle/near-drop position); driver map + Navigate deep-link opens Google Maps; insight cards render.

Finish with the END RITUAL. Do NOT start Phase 6.
```

### Definition of Done — Phase 5

- [ ] `GET /api/tracking/pumps/:bookingId` uses **Places API (New) `searchNearby`, `gas_station`**, anchored at live position, ranked by distance, returns **top-8**; `trk:pumps:*` 120s; legacy Places never referenced.
- [ ] `GET /api/tracking/fuel/:bookingId` computes `distance_km / mileage_kmpl × diesel_price`; class prefill (MCV/HCV) + all overrides (`mileage_kmpl`, `diesel_price`, `distance_km`); base result caches (`trk:fuel:*` 1h), **override results are not cached**; `inputs_overridden` correct; no Google call.
- [ ] `GET /api/tracking/alerts/:bookingId` computes off-route (**>500m**), idle (**>15min**), near-drop (**within 2km**) — the **LOCKED thresholds** — over cached route + live position + recent history; no Google call; `trk:alerts:*` 30s.
- [ ] All three JWT-gated, snake_case, `:bookingId`, zod-validated, typed errors, null-position handled.
- [ ] `<LiveTrackMap/>` **copied into driver/** (not shared-packaged); `@vis.gl/react-google-maps` installed in driver/; the two copies noted as manually-synced.
- [ ] Driver **navigation view**: map + **Navigate** deep-link handoff (`buildNavDeepLink`, copied) to Google Maps app; **no** in-app turn-by-turn.
- [ ] Driver insights UI: pumps list, fuel card (editable diesel price + vehicle class), alert banners.
- [ ] Mileage-by-class values + pump cap/radius confirmed as D-xxx; driver `next build` passes.
- [ ] ROADMAP + status board + decisions log updated.

**Suggested branches:** `feat/tracking-insights` (service) · `feat/driver-nav-insights` (driver)

---

# Phase 6 — PWA (manifest + service worker + wake lock) + route-replay GPS simulator + drive-test

**Goal:** make the driver PWA drive-ready — installable, screen stays on during a drive — and build the route-replay simulator so movement is testable without driving, plus the real-drive checklist. (Decision 3, plus the testing toolchain from CONTRACT §6.5.)

**Entry condition:** Phase 5 DoD ✅ (full endpoint set + both apps' maps live).

### Kickoff prompt (paste)

```
Do the START RITUAL. Phase 6 only — PWA hardening + testing toolchain. No new tracking endpoints.

1) PWA basics (driver/ primary; shipper/ if trivial) — Decision 3:
   - Minimal PWA manifest (name, icons, start_url, display standalone, theme/background).
   - A minimal service worker (register it; scope the app; keep it minimal — offline shell / basic caching, do NOT break the 10s poll).
   - Screen Wake Lock API: acquire a wake lock while a drive/trip screen is active so the driver's screen stays on; release on blur/visibilitychange/trip end; handle unsupported browsers gracefully.

2) Route-replay GPS simulator (CONTRACT §6.5): a tool that replays a RECORDED path (array of {lat,lng,recorded_at}) and feeds it to the ingestion path (POST /location/update on bt-booking-service) at the pilot cadence, so the truck marker MOVES end-to-end (map, ETA refresh, history breadcrumbs, pumps re-anchor, alerts flip) WITHOUT driving. Ship a sample recorded path on the pilot corridor (e.g. Bhiwandi→Narela). Make cadence + speed configurable.

3) HTTPS/secure-context note + drive-test checklist: geolocation requires HTTPS (secure context) on the phone. Document how to expose the dev apps over HTTPS for phone testing, and write a concrete real-Android drive-test checklist for the pilot corridor (what to open, what to watch: live marker, ETA, off-route/idle/near-drop alerts firing, pumps, fuel, wake lock holding, deep-link nav opening Google Maps).

Test: install the driver PWA (Add to Home Screen), confirm wake lock holds the screen on during a simulated trip, run the simulator end-to-end and watch every surface update, then dry-run the drive-test checklist against the simulator before the real drive.

Finish with the END RITUAL. This is the last phase — note feature-complete + any follow-ups (WebSocket push, threshold tuning after first real drive) as post-pilot, NOT in-scope changes.
```

### Definition of Done — Phase 6

- [ ] PWA **manifest** added (driver/, and shipper/ if trivial): name, icons, `start_url`, `display: standalone`, theme/background; installable ("Add to Home Screen").
- [ ] Minimal **service worker** registered + scoped; offline shell / basic caching; **does not break** the 10s poll.
- [ ] **Screen Wake Lock** acquired on the drive/trip screen, released on blur/visibility/trip-end, graceful when unsupported.
- [ ] **Route-replay GPS simulator** replays a recorded path into `POST /location/update` at pilot cadence; a **sample pilot-corridor path** is shipped; cadence/speed configurable.
- [ ] End-to-end via simulator: truck marker moves, ETA refreshes, history breadcrumbs accumulate, pumps re-anchor, alerts flip at thresholds, deep-link nav opens Google Maps — **without driving**.
- [ ] **HTTPS/secure-context** requirement documented for phone geolocation; method to serve apps over HTTPS for phone tests written.
- [ ] **Real-Android drive-test checklist** for the pilot corridor written (surfaces to verify listed).
- [ ] Post-pilot follow-ups (WebSocket push, threshold tuning after first real drive) noted as **out-of-scope** until a new decision.
- [ ] ROADMAP + status board + decisions log updated; feature marked **build-complete**.

**Suggested branches:** `feat/driver-pwa-wakelock` (driver) · `feat/tracking-gps-simulator` (tooling)

---

## Cross-phase guardrails (quick reference)

- **Provider:** Routes API + Places API (New) + Maps JS **only**. Legacy Directions / legacy Places are **BLOCKED** — never enable, import, or reference them.
- **Keys:** `GOOGLE_MAPS_SERVER_KEY` is server-only and **never** `NEXT_PUBLIC_`. The browser uses `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` (Maps JS only) + `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`.
- **Cost cap = per-API quotas** (hard) + restricted keys + Redis caching. Budget alerts **do not** cap spend. `/track` (#8) must serve from `route`/`eta` caches, not fresh Google calls per poll.
- **Ingestion stays in booking-service.** Tracking never re-ingests GPS and never writes `location_history`.
- **Conventions:** snake_case JSON, `:bookingId`, `/api/tracking/*` JWT-gated (`/health` open), `{success:true,data}` / `{success:false,error,code}`.
- **Endpoint #8** `GET /api/tracking/track/:bookingId` identity/path is **immovable**.
- **`<LiveTrackMap/>` is copied per app** (driver + shipper) — no shared npm package; keep the copies in sync by hand.
- **One phase per session. Finish the DoD. Run the END ritual. Do not spill into the next phase.**
