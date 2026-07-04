# BharatTruck — Agent / Developer Handoff

> **Read this first.** It's the single self-contained brief for anyone (human or AI agent) picking up this codebase cold. It explains *what this project is*, *how this monorepo came to exist*, *the honest current state*, *the decisions we've locked*, and *the plan*. Written 2026-07-04.
>
> After this, read in order: `CLAUDE.md` (working rules) → `docs/EXECUTION_ROADMAP.md` (the plan + committed cuts) → `docs/BHARATTRUCK_MVP_PRD.md` (product spec). For any maps/tracking work, `docs/MAPS_TRACKING_CONTRACT.md` is **frozen** and wins over everything.

---

## 0. TL;DR

- **Product:** BharatTruck — a two-sided freight-booking marketplace for India (interstate/intrastate trucking) on the LogisticOS microservices platform.
- **The bar (definition of done for the MVP):** **one shipper → one driver → one tracked, proven, PAID interstate trip**, done end-to-end by a real external (non-team) user.
- **North Star:** Completed Paid Trips. **Deadline:** 31 Aug 2026.
- **This repo (`Entropy-LLP/bharattruck`) is the single source of truth.** It replaced a scattered mess of standalone repos (see §1). Nothing else is canonical anymore.
- **Where we are:** ~30% built — the *front half* (auth, load posting, auction/negotiation) is real; the *back half* that actually makes a Completed Paid Trip (trip lifecycle, live map, POD, payment) is missing or stubbed. Both PWAs currently fail `next build`.
- **The strategy:** stop building horizontally. Drive **one vertical slice** (one booking, post → paid) to done, faking non-essentials with Ops.

---

## 1. What happened (background — how this monorepo was born)

On 2026-07-04 we audited the project and found the code was scattered across **three GitHub namespaces** with no single source of truth:

- `Entropy-LLP/*` — the canonical org, but split into ~10 **standalone repos** (one per service) plus a stale partial `LogisticOS` aggregate.
- `deltaos1997/*` — the founder's **old personal account**; the local checkout's git remotes still pointed here (dead).
- `CodeMongerrr/LogisticOS-pathway` — a personal repo holding only docs + a Cloudflare stub.

The local working copy was **stale and disconnected** (behind the org, `bt-tracking-service/` empty, `shipper/` not even committed), and its `origin` remotes pointed at the dead account — so `git push` would have gone into the void.

**Decision + action:** consolidate everything into **one clean-break monorepo**. This repo was snapshot-assembled from the canonical `Entropy-LLP/*` standalone HEADs, given a **fresh git history with no ties to any prior repo** (no submodules, no cross-repo deps, no old remotes). Source commit SHAs are recorded in `docs/MONOREPO_PROVENANCE.md`. The old standalones + `deltaos1997/*` mirrors are **retired** — never push to them. The per-service Cloud Run CI recipe was preserved under `docs/legacy-ci-reference/` for rebuilding monorepo CI.

---

## 2. The product (essentials)

The loop we're building:
> A **shipper** posts a load → **drivers/fleet owners** compete (blind **auction** or a **direct 1:1 contract**) → they **negotiate** price → shipper picks a winner → truck runs the trip with **live GPS tracking** → delivery is proven by a **receiver OTP** → **money settles** through the platform.

- **Personas:** Shipper (own app), Driver/Fleet-Owner (*one combined persona, one app* — the primary audience, may be non-literate), Ops (web console, exception-handling only), Receiver (no account, just enters the delivery OTP).
- **Truck-derived roles:** role is derived from trucks on the account (1 truck = Driver, 2nd = Fleet Owner). We verify the *truck's* authenticity (Vahan/RC), not legal ownership.
- This is a **feasibility MVP** — not scale, profit, or full legal/RBI compliance. Ops fills gaps by hand.

---

## 3. Honest system state (trust the code, not the READMEs)

Trust order for status: **frozen CONTRACT → code → per-folder `ROADMAP.md` → root docs.** Several `README.md`/`API.md` files are stale/aspirational.

| Component | State | Reality |
|---|---|---|
| `bt-auth-service` | 🟡 Partial | Auth works (phone OTP\*, email+pw, magic link, Google, JWT refresh) + driver onboarding CRUD. **All KYC is 501-stubbed**; phone OTP has no real SMS (console-logs). |
| `bt-booking-service` | 🟡 Partial | Booking CRUD + **full auction/negotiation engine** (the best code here) + GPS→Redis (30s TTL). **Lifecycle dead-ends at `accepted`** — no code moves a trip to `in_transit`/`completed`. `location_history` breadcrumb write not implemented. |
| `bt-pricing-service` | 🟢 Works (v1) | Deterministic rate-card quote engine. The Python RL/CTO engine is separate and OUT of MVP. |
| `bt-payment-service` | ⛔ Stub | Returns fabricated data (`rzp_stub_order_id`). No real Razorpay. |
| `bt-cargo-ledger` | ⛔ Mostly stub | SHA-256/Merkle crypto is real; no persistence, no chain write, delivery proof is fake. |
| `bt-tracking-service` | 🟢 Built (Ph. 0-2) | Real Google Maps proxy: `/route`, `/eta`, `/track`, `/health` work. `/history`,`/pumps`,`/fuel`,`/alerts` not built. |
| `bt-gateway` | 🟢 Exists | Nginx edge. **Does not yet route `/api/tracking/*`** — Week-0 fix. |
| `bt-ops-web` | ⛔ Stub | **Next.js 14 / React 18** (not 16). Fake login, all-mock data, inert buttons. |
| `driver/` | 🟡 Build broken | Login/browse/quote/negotiate/run-trip UI works; `/onboarding/*` imports ~11 undefined fns → `next build` fails. No maps yet. |
| `shipper/` | 🟡 Build broken | Login/dashboard/create/negotiate work; imports missing `LiveTrackMap`/`getRoute` → build fails. |

\* No SMS provider wired anywhere yet.

**The one-sentence problem:** the North Star thread (post → award → **run → prove → pay**) has **no continuous code path** past `accepted`. Everything else is detail.

---

## 4. Decisions locked (2026-07-04) — do not silently reverse

1. **Repo model → this one fresh monorepo.** Standalones + `deltaos1997/*` retired.
2. **Team → small (2–4 engineers).**
3. **First Completed Paid Trip → cash-recorded / direct settlement.** Razorpay escrow is a *later upgrade*, OUT of MVP.
4. **Scope → cut-order committed now.** OUT of MVP: RL/LinUCB pricing, escrow, blockchain ledger anchor, fleet reviews, detention, halt alerts, multi-pickup/drop, in-app turn-by-turn. **Never cut:** lifecycle closure, tracking map, POD-OTP, KYC gate.

---

## 5. Operating model (how we work now)

- **Vertical slices, not horizontal layers.** DoD = **demoable through the UI on the pilot corridor**, not "endpoint returns 200".
- **Walking skeleton first** — keep the thinnest end-to-end thread runnable (apps build, gateway routes to every service, a booking flows shipper → gateway → booking → DB → back) before deepening features.
- **Ruthless triage** — fake non-load-bearing bits with Ops (manual KYC approval early, cash-recorded payment).
- **Trunk-based + PR + green CI, production-ready only.** Short-lived `feat/*` → PR → CI green → merge to `main`. **No stubs / TODOs / `throw 'not implemented'` in `main`.**

---

## 6. The plan

**The one vertical slice to drive to 100% first** — booking #1, post → paid, on the pilot corridor:
1. **Lifecycle closure** in `bt-booking-service` (`accepted → in_transit → completed`) + breadcrumb write.
2. **Tracking rendered end-to-end** — `bt-tracking-service` `/track` + copy `<LiveTrackMap/>` into `shipper/`.
3. **POD** — receiver-email OTP closes the trip.
4. **Payment (cash-recorded)** marks it `paid` + records driver payout.
5. **Ops** — real auth/RBAC, live-trip board on real data, force-complete/reassign.

**Week-by-week (re-baselined, full detail in `docs/EXECUTION_ROADMAP.md`):**
`W0` Stabilize & Connect (walking skeleton) · `W1` lifecycle spine · `W2` tracking rendered · `W3` close the loop (POD + cash payment) — *first slice green* · `W4` ops + hardening · `W5` real KYC · `W6` Capacitor Android + notifications · `W7` pilot dry-run · `W8` the external-user proof.

---

## 7. Immediate next actions (Week 0 — do these first)

1. `npm install` across every package; run a **build-health check** to see exactly what's broken.
2. **Fix both app builds** (`driver/` undefined onboarding fns/types; `shipper/` missing `LiveTrackMap`/`getRoute`/`@vis.gl/react-google-maps`).
3. **Wire `bt-gateway` to route `/api/tracking/*`** so the shipper map can reach the tracking service.
4. **DB migrations into `supabase/migrations/`** (baseline + pending, incl. `location_history` migration 009).
5. **Rebuild monorepo CI** from `docs/legacy-ci-reference/` (keyless-WIF → Artifact Registry → Cloud Run), path-filtered per service.
6. Set real per-service env URLs + secrets (`JWT_SECRET` shared across services; `ENCRYPTION_KEY` for auth; the locked Google Maps keys). No secret behind `NEXT_PUBLIC_`.

**Exit criteria:** fresh clone → build → full stack runs locally → a dummy booking flows shipper → gateway → booking-service → Supabase → back, visible in the shipper UI. CI green on `main`.

---

## 8. Critical gotchas (will bite you)

1. **`users.id` vs `drivers.id`** — the JWT carries `users.id` as `userId`; `drivers.id` is a *separate* row (via `getDriverByUserId`). `bookings.driver_id`, `quotes.driver_id`, and Redis `loc:*` keys reference **`drivers.id`**, not `users.id`.
2. **Auth is custom HS256 JWT** shared across services (same `JWT_SECRET`), NOT Supabase Auth. Supabase is accessed with the **service-role key** → RLS bypassed → all authz is in app code.
3. **The Maps & Tracking contract is FROZEN** (`docs/MAPS_TRACKING_CONTRACT.md`, decisions `D-001..D-013`). Never silently fork a locked decision — append a new `D-xxx`. Only Google **Routes API + Places API (New) + Maps JS**; legacy Directions/Places are **blocked**. Nav is a **deep-link handoff** (no in-app turn-by-turn). GPS ingestion stays in `bt-booking-service`. Env-key names are locked.
4. **No PostGIS** — lat/lng are plain decimals; geometry runs in app code.
5. **`bt-ops-web` is Next 14 / React 18**; `driver/`+`shipper/` are Next 16 / React 19. Trust each `package.json`.
6. **Stale READMEs** describe a different product (OTP pickup, ePOD, WebSocket, wrong field names). Trust the code.

---

## 9. Repo & infra facts

- **Repo:** https://github.com/Entropy-LLP/bharattruck (private, `main`). **This is the only place code lands.**
- **Retired (never push):** the `Entropy-LLP/*` standalone service repos, `Entropy-LLP/LogisticOS` (stale aggregate), all `deltaos1997/*` mirrors, `CodeMongerrr/LogisticOS-pathway`. Kept as historical archive only.
- **Deploy:** GCP Cloud Run, region `asia-south1`, project `project-aa0faf06-c115-438a-a36`, keyless OIDC/WIF. CI recipe in `docs/legacy-ci-reference/`.
- **Data:** Supabase Postgres (no PostGIS) + Redis.
- **Local ports:** gateway `8080` (apps hit `NEXT_PUBLIC_API_URL` → `/api/*`), auth `3001`, booking `3002`, pricing `3003`, payment `3004`, cargo-ledger `3005`, tracking `3006`, ops-web/apps Next dev `3000`.
- **Provenance:** `docs/MONOREPO_PROVENANCE.md` (source SHAs). Local orchestration: `docker-compose.yml`, `Makefile`, `infra/`, `k8s/`.

_Last updated: 2026-07-04._
