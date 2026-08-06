# CLAUDE.md

> **New here?** Read this file, then `docs/BIBLE.md`. Everything you need to not break production is
> in one of the five docs listed below — there are no others. The old five-deep handoff chain and the
> 16 "superseded" stubs were **deleted on 2026-08-03**; git history has them if you ever need one.

## The only five docs

| File | What it is | When to read it |
|---|---|---|
| `docs/BIBLE.md` | Source of truth: product spec, execution plan, the **frozen** Maps contract, live state, QA harness, runbooks | Before assuming anything about the project |
| `docs/ARCHITECTURE_UNIFIED_IDENTITY.md` | **LOCKED** identity/persona model, decisions D-1…D-20, the one-app product design | Before touching auth, roles, personas, visibility, or payouts |
| `docs/INDIA_FREIGHT_COMPLIANCE.md` | Sourced legal research: e-way bills, LR/consignment notes, POD evidence, GTA exposure | Before touching documents, pricing presentation, POD, or anything money-facing |
| `docs/MAPS_TRACKING_PLAN.md` | 1200-line engineering narrative for the tracking build | Deep reference during a maps/tracking phase |
| `docs/BLOCKERS.md` | The single list of things only the founder can unblock | When you hit a credential/console/legal wall — and **add to it** rather than stalling |

Anything else you find asserting project state is stale by construction. Trust order:
**frozen CONTRACT (`BIBLE §3.1`) → code → these five docs.** Several per-service `README.md`/`API.md`
files are aspirational — never trust them over the code.

---

## Repo orientation

BharatTruck is an India interstate/intrastate freight marketplace. **This monorepo is the single
source of truth** — all services, all four frontends, gateway, infra, migrations. MVP deadline
**31 Aug 2026**. North star: **one Completed Paid Trip** — one shipper → one carrier → one tracked,
proven, paid trip.

> Never push to the retired `Entropy-LLP/*` standalones or `deltaos1997/*` mirrors.

**Services** — Fastify / TypeScript / Node 20, Cloud Run `asia-south1`:

| Service | Owns |
|---|---|
| `bt-gateway` | Nginx edge. Every app reaches the backend only through this (`NEXT_PUBLIC_API_URL`) |
| `bt-auth-service` | Auth + identity (HS256 JWT). KYC via Surepass — **stubbed**. Phone OTP **console-logged**, no SMS provider |
| `bt-booking-service` | Bookings, auction/negotiation, **GPS ingestion**, `location_history` breadcrumbs, POD, notification outbox |
| `bt-pricing-service` | Freight quotes (CTO cost-breakdown anchor). RL engine OUT of MVP |
| `bt-payment-service` | Settlement — **cash-recorded/direct**. Razorpay **not wired** (`BLOCKERS` B-3) |
| `bt-cargo-ledger` | Cargo/trip POD + ledger. On-chain anchor OUT |
| `bt-tracking-service` | Maps proxy: route, ETA, pumps, fuel, alerts, geofence evaluator |
| `bt-fleet-service` | Fleet roster, vehicle assignment, per-asset P&L |

**Frontends** — all Next.js 16 / React 19, App Router, Tailwind 4:
`shipper/` · `driver/` · `fleet/` (the fleet console) · `bt-ops-web/` (internal, Next 14).
`driver/CLAUDE.md` and `shipper/CLAUDE.md` add app-specific rules on top of this file.

---

## Current state — verified 2026-08-03

- **Branches: `main` only.** No other local or remote branch, one worktree, clean tree, zero open PRs.
- **All 12 Cloud Run services healthy** (8 services 200, 3 apps 200, ops-web 307→login).
- **Last 3 CD runs green.**
- **Schema is at migration 0022.** `0023_payout_split.sql` exists in the repo and is **NOT applied** —
  see `BLOCKERS.md B-0`. The shipped code tolerates both schemas, so nothing is broken today.
- **Geofencing is merged and deployed but inert** — one missing env var (`BLOCKERS.md B-1`).

### What is live and worth demoing

Fleet console (`fleet/`) is where the most recent work shows: live truck board, geofence CRUD,
auction bidding, per-truck P&L. Driver app has the live trip map plus fuel/pumps/alerts. Transactional
email is live (durable outbox). Negotiation is capped at 5 rounds. The rate card is derived from the
cost model, not hardcoded.

---

## How we work

- **One target: a Completed Paid Trip.** Build **vertical slices**, not horizontal layers.
  **Done = demoable through the UI**, not "the endpoint returns 200".
- **Trunk-based.** Short-lived `feat/*` → one PR → green CI → merge. **No stubs, TODOs, or
  `throw new Error('not implemented')` in `main`.**
- **Active `feat/*` branches get `docs/tasks/<branch-name>.md`**, deleted on merge (`BIBLE §0.4`).
- **Committed cuts (OUT of MVP):** RL/LinUCB pricing, Razorpay escrow, blockchain anchor, fleet
  reviews, detention, halt alerts, multi-pickup/drop, in-app turn-by-turn, **in-platform e-way bill
  generation**. **Never cut:** lifecycle closure, tracking map, POD-OTP, KYC gate.

---

## Identity — READ BEFORE ANY AUTH OR VISIBILITY WORK

Locked 2026-08-03. Full model in `docs/ARCHITECTURE_UNIFIED_IDENTITY.md`.

**A persona is not a flag. It is a view over what you own and who you are connected to.**

```
own trucks              → 'carry'   (marketplace access)
own 2+ / hold a driver  → 'operate' (fleet surfaces)
have a drivers row      → 'drive'
'ship' is ungated       — posting a load is what emerges the persona
```

> **Commercial visibility follows ASSET OWNERSHIP, not affiliation.** Own a truck → you carry its
> cost → you see the money and keep the load board. Own nothing and drive for a fleet → employee →
> masked, assignments only.

- **Do not add `role` checks.** Authorization goes through `@bharattruck/shared/personas`
  (`capabilitiesFrom`, `relationToBooking`, `seesCommercialsOnBooking`).
- `users.role` survives only as `primary_persona` — the destination for emailed links.
- `is_fleet_affiliated` is **not** a product switch; `is_employed` is.

**Identity gotcha (still true, still bites):** the JWT carries `users.id` as `userId`. `drivers.id` is
a **separate row** (`getDriverByUserId`). `bookings.driver_id`, `quotes.driver_id` and Redis `loc:*`
keys reference **`drivers.id`**, not `users.id`.

---

## Compliance — READ BEFORE DOCUMENTS, PRICING COPY, OR POD

Full detail + citations in `docs/INDIA_FREIGHT_COMPLIANCE.md`. Three commercial **red lines** (§1.3) —
crossing any of them risks classifying the platform as a **GTA** under GST, which is a tax-and-liability
event, not a paperwork one:

1. **Never the named issuer** on an LR. Fleet owner's name, GSTIN, series. **Never a platform-wide
   LR counter.**
2. **Never assume cargo liability** in code, copy, terms, or a claims path.
3. **Never contract as principal** — the platform must not *set* the freight price, invoice freight in
   its own name, or take freight as principal. Price *discovery* is safe; price *setting* is not.

Also non-obvious and load-bearing: consignment value **includes GST**; a UUID is an **invalid** GST
document number (≤16 chars, `[A-Za-z0-9/-]` only); POD photos must be hashed **on device** and
**never re-encoded**.

---

## Maps & Tracking — FROZEN, do not contradict

Read `BIBLE §3.1` (CONTRACT) and `§3.2` (DECISIONS D-001…D-013) before touching tracking code. The
CONTRACT wins over the PLAN wherever they disagree. To change anything, **append a new `D-xxx`** —
never edit a frozen entry.

- **Provider:** Google Maps Platform, **only** Routes API + Places API (New) + Maps JavaScript API.
  Legacy Directions/Places are **BLOCKED** for new GCP projects.
- **Navigation is a deep-link handoff** to the phone's Google Maps app. No in-app turn-by-turn.
- **Ingestion stays in `bt-booking-service`.** `bt-tracking-service` only READS `location_history`.
  Do not rebuild ingestion.
- **DB:** Supabase Postgres, **no PostGIS** — lat/lng are plain decimals.
- **Polling:** 10s GPS polling for the pilot. No WebSocket push.
- **Frontend:** `@vis.gl/react-google-maps`; **COPY** `<LiveTrackMap/>` per app (no shared package).

**Locked env-key names — use exactly these:**
`NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` (referrer-restricted, browser) ·
`GOOGLE_MAPS_SERVER_KEY` (secret, `bt-tracking-service` ONLY) ·
`NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` · `DIESEL_PRICE_INR=90`

`bt-tracking-service` endpoints are snake_case, namespaced `/api/tracking/...`, `:bookingId` path param.

---

## Migrations — the procedure that actually works

**CD does NOT run migrations.** Schema changes are always manual.

1. **Ask before taking a number.** They collide silently and surface in production.
   Next free: **0024**. (`0019` is applied and in the repo; `0023` is in the repo, **not applied**.)
2. Write it **idempotent** — `add column if not exists`, `drop constraint if exists`,
   `create index if not exists`, enum creation behind a `do $$ … $$` guard.
3. **`apply_migration` is classifier-blocked** in this project. Use the Supabase MCP `execute_sql`.
4. **Verify each object landed** — `execute_sql` returns `[]` for DDL whether or not it did anything.
   Query `information_schema` / `pg_constraint` / `pg_type` / `pg_indexes`, and assert existing rows
   kept their old values.
5. **Write the ledger row by hand** — `execute_sql` does not touch
   `supabase_migrations.schema_migrations`. Without it `list_migrations` goes stale and a future
   `db push` re-runs the file.

**Deploy ordering is a real hazard:** merging auto-deploys the service via `deploy.yml` path filters,
while migrations are applied by hand. **Write code that tolerates both schemas** rather than
documenting a required order.

---

## CI/CD traps that have actually bitten

- 🔴 **Merging PRs back-to-back silently loses deploys.** GitHub holds **one** pending run per
  concurrency group; each new merge **cancels the one already waiting**. Merge one, wait for its
  deploy, then merge the next. After any batch, check `gh run list --workflow=deploy.yml` for
  `cancelled` and `gh run rerun <id>` each. (`BIBLE §5.3`)
- 🔴 **`--update-env-vars`, never `--set-env-vars`.** `--set` wipes every unlisted var — that is what
  crash-looped payment and pricing on 2026-07-28.
- A service that does not exist yet is **created by CD with an empty environment** and crash-loops.
  Seed it first.
- Verify what is actually live from the revision's commit label:
  `gcloud run services describe <svc> --region=asia-south1 --project=project-aa0faf06-c115-438a-a36 --format='value(status.latestReadyRevisionName, spec.template.metadata.labels.commit-sha)'`

---

## UI / browser verification

Read **`BIBLE §6`** before any UI/QA pass — URLs, demo logins, tool gotchas and known-broken features
are all there, so you do not re-pay the cost of rediscovering them. Default to testing the **live
Cloud Run deployment**, not local dev.

Two traps worth repeating: a **local dev server cannot call the live gateway** (CORS — use the
`API_PROXY_TARGET` same-origin proxy, `§6.5`), and **§6 is a living section** — if you learn something
new while testing, add it before your session ends.
