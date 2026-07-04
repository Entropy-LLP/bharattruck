# BharatTruck — Master Development Roadmap

> ## ⛔ SUPERSEDED (2026-07-04) — do not plan work from this file
> This roadmap is dated **2026-07-01, before the locked scope decisions**. It still lists **cut** scope
> (Razorpay escrow + milestone split, on-chain/blockchain anchor, RL/LinUCB pricing, a from-scratch
> Python pricing rewrite) as in-scope, and links to the **retired `deltaos1997/*` repos**. It is kept only
> as a historical index of per-service ROADMAPs.
>
> **The authoritative plan is [docs/EXECUTION_ROADMAP.md](docs/EXECUTION_ROADMAP.md)** (how we work + committed cuts),
> with [docs/BHARATTRUCK_MVP_PRD.md](docs/BHARATTRUCK_MVP_PRD.md) as the product spec and the frozen
> [docs/MAPS_TRACKING_CONTRACT.md](docs/MAPS_TRACKING_CONTRACT.md) winning on tracking/maps. **Where any weekly
> plan below conflicts with `EXECUTION_ROADMAP.md`, EXECUTION_ROADMAP wins.** The single source of truth is
> this **monorepo** — the polyrepo-per-service framing below is obsolete.
>
> **MVP deadline:** 31 Aug 2026 (~8 weeks) · **North Star:** Completed Paid Trips · **Goal:** feasibility, not scale/legal.
> **The bar:** one shipper → one driver → one tracked, proven, paid interstate trip.

---

## Per-service directories (all in THIS monorepo — links are folders, not repos)

> The old `deltaos1997/*` / standalone repos are **retired — never push to them**. Everything below is a
> directory in this monorepo. "Owns" columns mentioning escrow / milestone split / on-chain ledger / LinUCB
> describe the **old** aspiration; those are **OUT of MVP** (see `docs/EXECUTION_ROADMAP.md §3`).

| Directory | Owns | Overall status |
|---|---|---|
| [bt-auth-service/](bt-auth-service/) | Identity, truck-derived roles, KYC | 🟡 auth works · KYC stub |
| [bt-booking-service/](bt-booking-service/) | Loads, auction/contract, negotiation, lifecycle, GPS ingest | 🟡 front half works · fulfillment missing |
| [bt-pricing-service/](bt-pricing-service/) | Pricing (CTO cost-engine; ~~LinUCB~~ **CUT**) | 🟢 deterministic quote engine works (v1) |
| [bt-payment-service/](bt-payment-service/) | Payments (cash-recorded; ~~escrow/milestone split~~ **CUT**) | ⛔ stub |
| [bt-cargo-ledger/](bt-cargo-ledger/) | POD (receiver OTP), checkpoints (~~on-chain~~ **CUT**) | ⛔ stub (chain off) |
| [bt-tracking-service/](bt-tracking-service/) | Live tracking, maps, geofence (~~halt alerts~~ **CUT**) | 🟢 built Ph.0–2 (`/route` `/eta` `/track` `/health`) |
| [bt-ops-web/](bt-ops-web/) | Ops console (KYC approval, trips, overrides) | ⛔ stub (fake login + mock) |
| [driver/](driver/) | Driver + Fleet Owner PWA → Capacitor | 🟡 partial · build broken |
| [shipper/](shipper/) | Shipper PWA | 🟡 partial · build broken |

_Legend: ✅ done · 🟡 partial · ⛔ stub/empty_

---

## Platform / Infra (cross-cutting — PRD §5.10)

**Done**
- ✅ Prod backend on **GCP Cloud Run** (asia-south1); keyless **OIDC** CI/CD per service.
- ✅ Polyrepo-per-service; Supabase Postgres + Redis; Razorpay/MSG91/Maps/SurePass chosen.

**To do (P0)**
- ⬜ **API gateway (bt-gateway)** — the Nginx edge mapping app `/api/*` → service routes — **is missing from the repos**; apps can't reach the backend without it. Add it (Dockerfile + Cloud Run) and commit it.
- ⬜ **DB migrations in version control** (Supabase schema is currently only code comments).
- ⬜ Real production `NEXT_PUBLIC_API_URL` + per-service URLs (env files are empty → default localhost).
- ⬜ **Fix both app builds** (driver + shipper currently fail `next build`).
- ⬜ **bt-tracking-service** needs a git repo + GitHub remote created (not a repo yet).
- ⬜ Smoke tests on the money/booking/POD paths; Sentry + log routing; Cloud Run min-instances (avoid cold-start latency on OTP/booking).
- ⬜ Remove stale `render.yaml` artifacts (migrated to GCP).

---

## 8-week plan (OBSOLETE — replaced by `docs/EXECUTION_ROADMAP.md §5`)

> ⛔ The table below is the **pre-decision (2026-07-01)** sequencing and is **superseded**. It front-loads
> cut scope (W5 Python/LinUCB pricing rewrite, W7 on-chain anchor + Razorpay escrow/milestone split) and
> puts tracking at W6. **Use the re-baselined W0–W8 plan in [docs/EXECUTION_ROADMAP.md §5](docs/EXECUTION_ROADMAP.md)
> instead** (W1 lifecycle spine → W2 tracking → W3 POD + cash payment → W4 ops → W5 real KYC → W6 Capacitor).
> Kept only for historical reference.

| Wk | Theme | Highlights |
|---|---|---|
| W1 | Foundations | fix builds · gateway in repo · DB migrations · env URLs · GCP Maps Phase-0 |
| W2 | Identity & roles | MSG91 OTP · truck-derived roles · Vahan/RC · driver KYC · fleet↔driver |
| W3 | Ops console | real auth+RBAC · KYC approval queue · users/fleets/trucks |
| W4 | Booking loop | pickup/delivery endpoints · auction expiry · negotiation cap · quote-lock |
| W5 | Pricing | ~~Python/FastAPI · LinUCB~~ **CUT** — keep deterministic CTO breakdown + quote-lock (already v1) |
| W6 | Tracking & maps | tracking service · GPS ingest · shipper live map · geofence · deep-link nav |
| W7 | POD · ledger · payments | receiver OTP closes trip · ~~on-chain anchor · Razorpay escrow + milestone split~~ **CUT** → cash-recorded payment |
| W8 | Harden & wrap | Capacitor Android · ops overrides · notifications · end-to-end corridor test |

**Safe cut-order if time slips:** RL dynamic pricing → halt alerts → detention → reviews → escrow-down-to-cash/direct. **Never cut:** lifecycle closure, tracking map, POD-OTP, KYC gate.

---

_See [docs/BHARATTRUCK_MVP_PRD.md](docs/BHARATTRUCK_MVP_PRD.md) for full scope, the 3 user journeys, data-procurement list (Part 7), and open questions (Part 13). Last updated: 2026-07-01._
