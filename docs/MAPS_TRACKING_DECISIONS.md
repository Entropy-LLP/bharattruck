# BharatTruck — Maps & Tracking DECISIONS (append-only)

> **This log is APPEND-ONLY.** Read it top-to-bottom first; append new decisions at the bottom.
> Never edit, reorder, or delete an existing `D-xxx` entry — a decision that turns out wrong is *superseded* by a NEW higher-numbered entry that references it, not rewritten in place.
> A real fork of any locked decision (see the FROZEN CONTRACT in `MAPS_TRACKING_CONTRACT.md`) requires **asking the founder** before it is recorded here.
> On any conflict between this log and the CONTRACT, the CONTRACT wins; this log records *why* each locked item is what it is.
> Entries D-001..D-013 below were all confirmed together on **2026-06-18**.

---

**D-001 — New `bt-tracking-service` instead of extending `bt-booking-service`**

- **Date:** 2026-06-18
- **Status:** Accepted
- **Context:** The Maps & Tracking feature adds a distinct body of logic — cached route + live ETA (Google proxy), petrol-pump search, fuel estimate, route alerts, and the shipper read-through aggregate. `bt-booking-service` already owns raw GPS ingestion (`POST /location/update`, `GET /location/booking/:id`, Redis-backed 30s-TTL live position). Folding the new Google-proxy + caching concerns into booking-service would bloat a service that is already on the critical booking path and would couple Google quota/latency risk to core booking flows.
- **Decision:** Stand up a **new microservice `bt-tracking-service`** (Fastify / TypeScript / Node 20, port 3006) following the existing microservice recipe used by `bt-auth-service` / `bt-booking-service` (same folder layout, Fastify bootstrap, Dockerfile, GCP Cloud Run deploy in `asia-south1`). It **owns only the new derived/read logic** and is a server-side Google proxy with Redis caching. Raw GPS **ingestion STAYS in `bt-booking-service`** and is never re-implemented; tracking-service consumes the existing live position (server-to-server or Redis read).
- **Consequences:** Clean separation of Google-cost/latency risk from the booking path; independent deploy and scaling. One more service to operate and one more JWT-gated surface to secure. Tracking-service is a *consumer* of booking-service's live position and a *read-only* reader of `location_history` — it must degrade gracefully when the live position is stale (>30s TTL).

---

**D-002 — Provider is Google Maps Platform (ease-of-build chosen over lowest cost)**

- **Date:** 2026-06-18
- **Status:** Accepted
- **Context:** The map layer needs routing, traffic-aware ETA, place (fuel) search, and a rendered map. Options ranged from cheaper/self-hosted stacks (OSRM + OSM tiles + Nominatim) to fully-managed providers (Google, Mapbox). The MVP bar is one proven tracked paid trip by 31 Aug 2026; engineering time is the scarce resource, not per-call price at pilot scale (~20 users).
- **Decision:** Standardize on **Google Maps Platform** for the whole feature. Accept slightly higher marginal cost in exchange for one coherent, well-documented, India-covered platform (routing + traffic + places + JS map) that a small team can ship fast. Pilot volume is expected to sit inside Google's **free monthly tiers**.
- **Consequences:** Vendor concentration on Google; cost must be actively controlled (see D-005). India road/traffic/place coverage and a single SDK family reduce integration risk. Revisiting the provider later would be a founder-level `D-xxx` decision, not an incremental change.

---

**D-003 — Use Routes API + Places API (New) + Maps JavaScript API; legacy APIs are BLOCKED**

- **Date:** 2026-06-18
- **Status:** Accepted
- **Context:** Google offers both legacy and new generations of its APIs. Crucially, the **legacy Directions API and legacy Places API are BLOCKED for new GCP projects** — a fresh BharatTruck project cannot enable them even if we wanted to. We must pick the currently-supported surfaces.
- **Decision:** Enable and use exactly **three** APIs: **Maps JavaScript API** (browser, renders the vector map), **Routes API** (server, `computeRoutes` for base route + traffic ETA), and **Places API (New)** (server, `searchNearby` for petrol pumps). **Never reference or attempt to use legacy Directions API or legacy Places API.** Routing goes through Routes API; place search goes through Places API (New).
- **Consequences:** Future-proof against Google's legacy deprecations and compatible with new-project restrictions. Any tutorial/snippet built on the legacy APIs must be translated to the new request/response shapes (e.g. field masks, `routingPreference`, `includedTypes`). This three-API set is the *only* allowed Google surface; anything else is out of contract.

---

**D-004 — Navigation is a deep-link handoff to the phone's Google Maps app (no in-app turn-by-turn)**

- **Date:** 2026-06-18
- **Status:** Accepted
- **Context:** Drivers need turn-by-turn navigation, but building an in-app navigator (voice guidance, rerouting, lane guidance) is a large, licensed, high-maintenance effort — far beyond the MVP bar. Drivers already trust and use Google Maps for navigation.
- **Decision:** Do **not** build in-app turn-by-turn. Instead **deep-link handoff** to the phone's Google Maps app: build a URL via a `buildNavDeepLink()` helper using **`https://www.google.com/maps/dir/`** (universal) and **`comgooglemaps://`** on iOS (falling back to the https URL if the app is absent). Pilot travel mode = `driving`. Same behaviour on the web PWA now and in React Native later.
- **Consequences:** Near-zero navigation maintenance; drivers get Google-grade guidance immediately. We lose in-app control of the nav experience and cannot overlay BharatTruck data on the turn-by-turn view. The helper is a per-app deliverable (copied, see D-013).

---

**D-005 — Two physically separate restricted keys + per-API quota caps as the cost/security control**

- **Date:** 2026-06-18
- **Status:** Accepted
- **Context:** A public browser key and a powerful server key have very different threat models, and Google's **billing budget only ALERTS — it does not cap spend.** Relying on a budget alone leaves the project exposed to runaway cost from a leaked key or a bug in a polling loop.
- **Decision:** Use **two physically different, separately-restricted API keys**, never interchanged:
  - `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` — **HTTP-referrer restricted**, allowed for **Maps JavaScript API only**, safe to ship to the client.
  - `GOOGLE_MAPS_SERVER_KEY` — **secret**, API-restricted to **Routes API + Places API (New)**, lives **only** in `bt-tracking-service`, **never** behind a `NEXT_PUBLIC_` prefix.
  Additionally set **per-API quota caps** as the *hard* spend ceiling (the budget is only an alert). `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` names the vector map style. This is enforced up front in the Phase-0 gate (project + 3 APIs + 2 keys + quota caps) before any map code is written.
- **Consequences:** A leaked browser key can't drive server-side (billable) Routes/Places calls, and referrer restriction limits its abuse. A bug or attack is bounded by quota caps rather than by a credit-card limit. Two keys means two rotation/rollout paths to manage. Redis caching (D-006 TTLs) is the primary lever to stay inside free tiers under quota.

---

**D-006 — ETA uses Routes TRAFFIC_AWARE ("Pro"); the cached base route uses static Essentials tier**

- **Date:** 2026-06-18
- **Status:** Accepted
- **Context:** Two different routing needs with different freshness and cost profiles: the **base route geometry** between origin and destination is stable for a booking and only needs to be drawn once; the **live ETA** must reflect current traffic and changes as the truck moves. Routes API's traffic-aware ("Pro") tier costs more than the static ("Essentials") tier.
- **Decision:** Split the two:
  - `/api/tracking/route/:bookingId` → **Routes API, Essentials / static tier** (`routingPreference: TRAFFIC_UNAWARE`), cached long at `trk:route:{bookingId}` (target TTL 24h, INFERRED).
  - `/api/tracking/eta/:bookingId` → **Routes API, TRAFFIC_AWARE / Pro tier** (`routingPreference: TRAFFIC_AWARE`), cached short at `trk:eta:{bookingId}` (target TTL 60s, INFERRED) so ETA refreshes near the 10s poll cadence without a Google call per poll.
  The aggregate `/track` (#8) composes these two caches rather than issuing fresh Google calls.
- **Consequences:** We pay the Pro price only for the ETA path, and only ~once per short TTL window rather than per poll; the base geometry is drawn from a long-lived cache. The tier split is LOCKED; the exact TTL numbers are INFERRED starting points to confirm after the first real drive.

---

**D-007 — Persist throttled location breadcrumbs to `location_history` (migration 009)**

- **Date:** 2026-06-18
- **Status:** Accepted
- **Context:** The live position lives in Redis with a 30s TTL — good for "where is the truck now" but it evaporates, so there is no traveled-path / history view and no basis for idle detection over time. `trip_events` carries a sparse lat/lng audit trail but not a dense movement track. Supabase Postgres is used **without PostGIS** (lat/lng as plain decimals).
- **Decision:** Enable a new **`location_history` breadcrumb table via migration 009**, storing throttled breadcrumbs at **~1 point / 10–15s**. The **WRITE owner is `bt-booking-service`** — the breadcrumb insert happens on the existing ingestion path (the same path that writes the 30s Redis live position). `bt-tracking-service` is **read-only** on `location_history` and reads it to serve `/api/tracking/history/:bookingId` and to feed `/alerts` idle detection.
- **Consequences:** A durable traveled path becomes available for the shipper's history view and for alert computation. No PostGIS means distance/geometry math is done in application code, not the DB. The write-owner rule (booking-service writes, tracking-service never writes) is LOCKED; the exact throttle mechanism, the precise call-site inside booking-service, and the final column names/types of migration 009 are **INFERRED — confirm** against the real migration when it lands.

---

**D-008 — Add PWA manifest + service worker now, with the Screen Wake Lock API for drives**

- **Date:** 2026-06-18
- **Status:** Accepted
- **Context:** `driver/` and `shipper/` are Next.js 16 / React 19 PWAs. During a drive the driver's screen must not sleep (GPS polling + map must keep running), and phone geolocation testing requires a secure context. Investing now in PWA basics also smooths the later Capacitor/React-Native path.
- **Decision:** Add a **minimal PWA manifest + service worker now** in both apps, and use the **Screen Wake Lock API** to keep the driver screen awake during an active drive. Geolocation testing runs over **HTTPS (secure context)**.
- **Consequences:** Installable, more app-like PWAs and a screen that stays on during tracking. Wake Lock support/behaviour varies by browser and must degrade gracefully (and be re-acquired on visibility change). Keep the service worker minimal to avoid caching-staleness bugs during rapid MVP iteration.

---

**D-009 — Fuel estimate = mileage prefilled by vehicle class × editable diesel price**

- **Date:** 2026-06-18
- **Status:** Accepted
- **Context:** Drivers want a quick trip fuel-cost figure. True per-vehicle mileage and live diesel prices are not available in the MVP, but a good-enough, transparent, editable estimate is valuable and cheap (pure arithmetic over the cached route distance — no Google call).
- **Decision:** Compute **`fuel = distance_km / mileage_kmpl × diesel_price`**. Prefill `mileage_kmpl` by **vehicle class** (big-truck classes **MCV / HCV**; INFERRED starting values ≈ MCV 6.0 kmpl, HCV 3.5 kmpl — confirm), and use an **editable diesel price** defaulting to **`DIESEL_PRICE_INR=90`** INR/litre. `/api/tracking/fuel/:bookingId` accepts overrides for `vehicle_class`, `mileage_kmpl`, `diesel_price`, and `distance_km`; distance otherwise comes from the cached base route (D-006).
- **Consequences:** Instant, override-friendly estimate with no Google cost. Accuracy depends on the class mileage defaults and the diesel price staying roughly current; both are adjustable. Overridden results should not be cached as the canonical base estimate. The formula, the class-prefill approach, and the `DIESEL_PRICE_INR=90` default are the locked shape; the exact kmpl-per-class numbers are INFERRED.

---

**D-010 — Keep 10s HTTP polling for the pilot (no WebSocket / push yet)**

- **Date:** 2026-06-18
- **Status:** Accepted
- **Context:** The driver/shipper apps already poll live location every 10s over HTTP; the map layer is the only missing piece. A real-time push transport (WebSocket / SSE) would add server infrastructure, reconnection/backoff logic, and Cloud Run connection-handling complexity — for marginal benefit at ~20 pilot users.
- **Decision:** Keep the existing **10s HTTP polling** for the pilot. Do **not** introduce WebSocket/push transport in this feature. Cache TTLs (D-006) are tuned to sit near the 10s cadence so polling does not multiply Google calls.
- **Consequences:** Zero new transport infrastructure; the map simply consumes the existing poll. Up-to-10s staleness in position/ETA, which is acceptable for interstate freight. A push transport remains a clean future upgrade behind the same read endpoints (a later `D-xxx`).

---

**D-011 — Petrol-pump search returns the top-8 nearest pumps**

- **Date:** 2026-06-18
- **Status:** Accepted
- **Context:** Drivers want nearby fuel options along the route without an overwhelming list. Too few options is limiting; too many is noise on a small phone screen and more data to fetch/render.
- **Decision:** `/api/tracking/pumps/:bookingId` returns the **top-8 nearest petrol pumps** to the truck's current live position, via **Places API (New)** `searchNearby` with `includedTypes: ["gas_station"]`, ranked by distance. Default **limit = 8** (LOCKED). Results cached at `trk:pumps:{bookingId}` (target TTL 120s, INFERRED). Legacy Places API is not used (D-003).
- **Consequences:** A concise, actionable fuel-stop list. The 8-result default is LOCKED; the search radius and cache TTL are INFERRED and tunable. Because the anchor is the *moving* current location, the cache must be short enough that results track the truck.

---

**D-012 — Route-alert thresholds: 500 m off-route, 15 min idle, 2 km near-drop**

- **Date:** 2026-06-18
- **Status:** Accepted
- **Context:** The shipper and ops need automatic exception signals (deviation, stall, arrival-imminent) without watching the map continuously. Alerts are computed with pure geometry over the cached base route (D-006) + live position + recent `location_history` (D-007) — no Google call. Real-world thresholds are unknown until the first drive.
- **Decision:** Ship three alerts with these **starting thresholds (LOCKED, tunable after the first real drive):**
  - **off_route** → truck is **> 500 m** from the base polyline.
  - **idle** → no meaningful movement for **> 15 min**.
  - **near_drop** → truck is **within 2 km** of the destination.
  Served by `/api/tracking/alerts/:bookingId`, cached at `trk:alerts:{bookingId}` (target TTL 30s, INFERRED).
- **Consequences:** Immediate, no-cost exception detection for the pilot loop. Thresholds are deliberately provisional; the first real corridor drive is expected to recalibrate them. Distance-to-polyline math runs in app code (no PostGIS, D-007). The three thresholds are LOCKED as the current values but explicitly expected to be re-tuned.

---

**D-013 — Copy `<LiveTrackMap/>` per app; lock snake_case + `:bookingId` + endpoint #8 conventions**

- **Date:** 2026-06-18
- **Status:** Accepted
- **Context:** `driver/` and `shipper/` are **separate** Next.js 16 / React 19 projects; there is no shared component package and no map library installed yet. A shared npm package would add publish/versioning/build overhead disproportionate to two copies of one component during an MVP. Separately, the API surface needs stable conventions so both apps and the service agree without ambiguity.
- **Decision:** Two parts:
  1. **Frontend:** build the map layer on **`@vis.gl/react-google-maps`** and **COPY the `<LiveTrackMap/>` component (and the deep-link nav helper) into each app** rather than sharing an npm package; keep the two copies in sync manually. Shipper gets the live-tracking map (fed by `/track`, #8); driver gets the navigation view + insights (pumps / fuel / alerts) + the deep-link helper.
  2. **API conventions (FROZEN):** JSON is **snake_case** everywhere; all tracking routes are namespaced under **`/api/tracking/…`** with the **`:bookingId`** path param and are JWT-gated (except `/health`); **endpoint #8 `GET /api/tracking/track/:bookingId` is LOCKED** as the shipper read-through aggregate (current location + route + live ETA + status in one call); petrol-pump default limit = 8. Success = `{ "success": true, "data": {…} }`; errors use the shared `{ success:false, error, code }` shape via a `TrackingError` class.
- **Consequences:** Fast, dependency-light frontend with two divergent-by-design consumers; the manual-sync cost is accepted for the MVP and revisitable later. The locked conventions let the service and both PWAs integrate without renegotiation — any change to the endpoint set, #8's identity, the snake_case/`:bookingId` rules, the env-key names, or the copy-per-app rule requires a **new `D-xxx` decision and founder sign-off** (per the CONTRACT change-control).

---

**Next D-number: D-014**
