# BharatTruck — Master Development Roadmap

> Umbrella index for the BharatTruck MVP. The authoritative spec is **[docs/BHARATTRUCK_MVP_PRD.md](docs/BHARATTRUCK_MVP_PRD.md)** (PDF alongside). Each service/app has its own `ROADMAP.md` (done / to-do) that we update as we build.
>
> **MVP deadline:** 31 Aug 2026 (~8 weeks) · **North Star:** Completed Paid Trips · **Goal:** feasibility, not scale/legal.
> **The bar:** one shipper → one driver → one tracked, proven, paid interstate trip.

---

## Per-repo roadmaps

| Repo | Owns | Overall status |
|---|---|---|
| [bt-auth-service](https://github.com/deltaos1997/bt-auth-service) | Identity, truck-derived roles, KYC | 🟡 auth works · KYC stub |
| [bt-booking-service](https://github.com/deltaos1997/bt-booking-service) | Loads, auction/contract, negotiation, lifecycle, GPS ingest | 🟡 front half works · fulfillment missing |
| [bt-pricing-service](https://github.com/deltaos1997/bt-pricing-service) | Pricing (CTO cost-engine + LinUCB) | 🟡 rule-based placeholder · Python engine to integrate |
| [bt-payment-service](https://github.com/deltaos1997/bt-payment-service) | Payments, escrow, milestone payout split | ⛔ stub |
| [bt-cargo-ledger](https://github.com/deltaos1997/bt-cargo-ledger) | POD (receiver OTP), checkpoints, on-chain ledger | ⛔ stub (chain off) |
| [bt-tracking-service](https://github.com/deltaos1997/bt-tracking-service) | Live tracking, maps, geofence, halt alerts | ⛔ empty / unbuilt |
| [bt-ops-web](https://github.com/deltaos1997/bt-ops-web) | Ops console (KYC approval, trips, overrides) | ⛔ stub (fake login + mock) |
| [bt-driver-app](https://github.com/deltaos1997/bt-driver-app) (`driver/`) | Driver + Fleet Owner PWA → Capacitor | 🟡 partial · build broken |
| [bt-shipper-app](https://github.com/deltaos1997/bt-shipper-app) (`shipper/`) | Shipper PWA | 🟡 partial · build broken |

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

## 8-week plan (30 Jun → 31 Aug 2026)

| Wk | Theme | Highlights |
|---|---|---|
| W1 | Foundations | fix builds · gateway in repo · DB migrations · env URLs · GCP Maps Phase-0 |
| W2 | Identity & roles | MSG91 OTP · truck-derived roles · Vahan/RC · driver KYC · fleet↔driver |
| W3 | Ops console | real auth+RBAC · KYC approval queue · users/fleets/trucks |
| W4 | Booking loop | pickup/delivery endpoints · auction expiry · negotiation cap · quote-lock |
| W5 | Pricing | Python/FastAPI · CTO breakdown · GST/TDS · LinUCB (synthetic) |
| W6 | Tracking & maps | tracking service · GPS ingest · shipper live map · geofence · deep-link nav |
| W7 | POD · ledger · payments | receiver OTP closes trip · checkpoint photos + on-chain anchor · Razorpay escrow + milestone split |
| W8 | Harden & wrap | Capacitor Android · ops overrides · notifications · end-to-end corridor test |

**Safe cut-order if time slips:** RL dynamic pricing → halt alerts → detention → reviews → escrow-down-to-cash/direct. **Never cut:** lifecycle closure, tracking map, POD-OTP, KYC gate.

---

_See [docs/BHARATTRUCK_MVP_PRD.md](docs/BHARATTRUCK_MVP_PRD.md) for full scope, the 3 user journeys, data-procurement list (Part 7), and open questions (Part 13). Last updated: 2026-07-01._
