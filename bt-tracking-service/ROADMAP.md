# bt-tracking-service — Development Roadmap

> **Part of [BharatTruck](https://github.com/CodeMongerrr/LogisticOS-pathway).** Owns **Live Tracking & Maps** (PRD §5.6). Master PRD: `LogisticOS-pathway/docs/BHARATTRUCK_MVP_PRD.md`.
> **MVP deadline:** 31 Aug 2026 · **North Star:** Completed Paid Trips · _Living doc — update checkboxes as work lands._
> ⚠️ **This service is unbuilt (empty `src/`, no git history yet).** This roadmap seeds the repo.

**Role:** The shipper sees their truck move on a live Google Map; the driver navigates via deep-link hand-off (no in-app turn-by-turn). Geofenced pickup/drop; >1hr halt alerts. Raw GPS ingestion currently lives in bt-booking-service (Redis, 30s TTL) — this service owns the higher-level route/ETA/geofence/alert logic.

**Status legend:** ✅ done · 🟡 partial · ⬜ to do · ⛔ stub

---

## ✅ What's done
- _Nothing built yet_ (only `node_modules` present). Provider + nav UX decisions locked (below).

## ⬜ To do — Phase 0 (gating, before any map code)
- ⬜ GCP **Maps Platform** project + enable **Maps JS + Routes API (New) + Places API (New)** (legacy Directions/Places are blocked for new projects).
- ⬜ Two restricted keys: `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` (referrer-restricted) + `GOOGLE_MAPS_SERVER_KEY` (secret) + `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`.
- ⬜ **Per-API quota caps** + billing budget alert (hard cap = quotas; budget only alerts).

## ⬜ To do — service (MVP / P0)
- ⬜ Scaffold Fastify/TS/Node20 service (port 3006) per the microservice recipe; Dockerfile + Cloud Run deploy + git repo + remote.
- ⬜ Server-side **route/ETA proxy** with Redis caching (ETA TRAFFIC_AWARE/Pro; cached route Essentials).
- ⬜ **Geofence** pickup/drop zones → denser GPS sampling + arrival detection.
- ⬜ **Halt detection:** stationary > 1 hour → alert surfaced to shipper.
- ⬜ **Breadcrumb persistence** (throttled ~1pt/10–15s) — `location_history` table (migration 009).
- ⬜ **Ingest transport:** Redis pub/sub for the MVP (sufficient at pilot scale); Kafka deferred to post-pilot scale.
- ⬜ Cadence: **~10–15s in geofenced zones, ~60s mid-trip** (trips run 20+ hrs — balance battery/data).
- ⬜ Frozen interface: snake_case JSON, `:bookingId` path params, shipper read-through `GET /api/tracking/track/:bookingId`.

## ⬜ To do — frontend (shared with driver + shipper apps)
- ⬜ `<LiveTrackMap>` component (Maps JS) — copied into both apps (separate Next projects).
- ⬜ **Deep-link nav helper** → opens the phone's Google Maps app.
- ⬜ Driver app: **wake-lock + store-and-forward** GPS queue (web PWA limitation; native via Capacitor later).

## 🔮 Deferred / out of MVP
- Petrol-pump search, fuel estimate, route alerts (driver insights) — layer on after live map + nav.
- In-app turn-by-turn navigation (we deep-link).
- Kafka ingestion (Redis pub/sub is enough for the pilot).

## 🔑 External dependencies / data
- GCP Maps Platform billing + 3 APIs + keys (Phase 0).

## 🎯 Definition of done (this service)
On a real (or simulated) drive, the shipper watches the truck move on a map updating at the stated cadences; geofence entry at pickup/drop is detected; a >1hr halt is flagged; the driver can deep-link to Google Maps for navigation.

_Last updated: 2026-07-01_
