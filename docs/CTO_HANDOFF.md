# BharatTruck — CTO Session Handoff

> **You are the incoming CTO node** of the BharatTruck engineering team. This is your single, self-contained
> brief: what the product is, what's built and LIVE, what's left, the team/IPC workflow, every locked
> decision, and every credential you need. Written 2026-07-11 by the outgoing CTO. Read this fully, then read
> the docs in §2. **You coordinate engineer sessions over claude-ipc, audit their work, and are the only node
> that merges to `main`. You are answerable to the founder** (`deltaos1997@gmail.com`), who manually verifies
> each stage on the live platform.

---

## 0. TL;DR — where things stand right now

- **The entire "Completed Paid Trip" vertical slice is code-complete, CTO-verified, and merged to `main`**
  (`origin/main`): lifecycle → live tracking → POD-OTP → cash payment → pricing breakdown → ops console.
- **The whole stack is DEPLOYED and LIVE on GCP Cloud Run** (7 backend services + gateway + 3 PWAs), running
  against the **real Supabase DB** with a **seeded Mumbai→Nagpur pilot corridor**. Login/booking/tracking/ops
  are verified working end-to-end via the deployed gateway.
- **CI is green on GitHub.** `main` is the deployable, on-scope source of truth.
- **Two things block a *complete* end-to-end founder demo** (both are small, see §5): (1) the shipper **map
  won't render** — the wrong Maps key was baked into the shipper build + a referrer restriction; (2) **POD +
  cash-payment services** (`cargo`, `payment`) were redeployed but are **missing `JWT_SECRET`/`REDIS_URL`**
  env, so the last two trip steps aren't live yet.
- **A second coder (kartik) pushed Python escrow + RL-pricing services** — **OUT of MVP scope**; they've been
  **quarantined to branch `feat/python-engines`** (nothing lost). A full review + recommendation exists (§7).
- The `backend` and `frontend` IPC engineer nodes are **idle/holding**, all their work merged.

---

## 1. The product (essentials)

BharatTruck is an India interstate/intrastate **freight-booking marketplace** on the LogisticOS microservices
platform. **North star: Completed Paid Trips.** The bar: **one shipper → one driver → one tracked, proven,
paid interstate trip**, done by a real external user. **MVP deadline: 31 Aug 2026.** This is a **feasibility
MVP** — not scale, not full RBI/legal compliance. Ops fills gaps by hand.

The loop: a **shipper** posts a load → **drivers/fleet owners** compete (blind **auction** or **direct
contract**) → **negotiate** → shipper picks a winner → truck runs with **live GPS tracking** → delivery proven
by a **receiver OTP** → **money settles** (cash-recorded first; escrow deferred).

**Personas:** Shipper (own app), Driver/Fleet-Owner (one combined persona/app, may be non-literate → icon-led
UX), Ops (web console, exception-handling), Receiver (no account, just enters the delivery OTP).

---

## 2. Read these next (authority order)

1. **`docs/BHARATTRUCK_MVP_PRD.md`** — the authoritative PRODUCT spec (personas, the 3 journeys §6, per-module
   scope §5, Definition of Done §11, NFRs §8, data procurement Part 7, open questions Part 13). **You must
   know this cold** — the founder expects the CTO to hold every stage against it.
2. **`docs/EXECUTION_ROADMAP.md`** — the authoritative PLAN + committed cuts. **Wins over the PRD on
   *what-we-build/what-we-cut*.** (The PRD is aspirational-full; the roadmap is the ruthlessly-cut feasibility
   MVP.)
3. **`CLAUDE.md`** (root) — working rules, repo orientation, global conventions, gotchas.
4. **`docs/AGENT_HANDOFF.md`** — the original cold-start brief (how the monorepo was born, honest state).
5. **`docs/MAPS_TRACKING_CONTRACT.md`** + `MAPS_TRACKING_DECISIONS.md` (`D-001..D-013`) — **FROZEN**; win over
   everything on maps/tracking. Only Google Routes + Places(New) + Maps JS; deep-link nav; env-key names
   locked; `<LiveTrackMap>` copied per app (no shared pkg).
6. **`docs/IPC_TEAM_PROTOCOL.md`** — how you run the team over claude-ipc (§3 below summarizes).
7. **`docs/CTO_ENGINEERING_STANDARDS.md`** — the system-design bar + the stage-gate you enforce.
8. **`docs/TEAM_GIT_WORKFLOW.md`** — per-node git worktree isolation + the CTO-only-push rule.
9. **`docs/CTO_SCORECARD.md`** — the running, evidence-backed record of every engineer's work (read it to
   know what's been verified and how each node performs).
10. **`docs/CTO_AUDIT_FINDINGS.md`** — the original backlog + the §0 rulings that resolved doc contradictions.

**Trust order for build state:** frozen CONTRACT → code → per-folder `ROADMAP.md` → root docs. Several
`README.md`/`API.md` files are stale — trust the code.

---

## 3. How you run the team (IPC + stage-gate)

- **Register on the bus:** "Register this instance as `cto` on claude-ipc." It's a localhost broker
  (`127.0.0.1:9876`); all nodes run on the same machine. **The broker drops in and out** — if `check messages`
  errors with "Not registered," just re-register (you may get queued messages back). **`list_instances` has a
  token bug on this build — rely on `check`/`send`/`broadcast`.**
- **Channel rule:** reach engineers ONLY via claude-ipc ("send message to backend: …", "check messages").
  **NEVER** use Claude Code's built-in `SendMessage` — it can't cross terminals.
- **Roles:** `cto` (you), `backend` (bt-* services), `frontend` (driver/shipper/bt-ops-web), `infra` (CI/CD,
  deploy, migrations — **currently unstaffed; the CTO has been doing infra directly**).
- **Message format:** JSON objects, `type` ∈ {task, ack, report, review, status, blocker}, always with
  `id`/`from`/`to` (see IPC_TEAM_PROTOCOL §3).
- **The stage-gate (non-negotiable):** engineers work on `feat/*` branches in their **own git worktree**, never
  push to `main`. On a `report` you **independently verify** — read the diff, run the build, run the tests,
  **exercise it end-to-end** — before sending `approved`/`changes_requested`. **Only YOU merge to `main`, and
  only after you reproduced it.** Then the **founder** does the final live check. Nothing reaches the founder
  unverified. (The outgoing CTO caught real bugs this way — e.g. a shared-tree tangle that would have deleted a
  whole task, and a CI-red shared-libs fix — do NOT rubber-stamp.)
- **Honesty is the one fireable line** — for engineers and for you. Report failures with output; never claim a
  "done" you can't reproduce.
- **Note:** engineer sessions also drop when the broker restarts; they re-register and re-send. If one goes
  silent a long time, send a heartbeat. If they idle-poll and there's nothing to do, tell them to hold (and
  consider pausing any polling loop to save tokens — IPC_TEAM_PROTOCOL §7).

---

## 4. What is BUILT + VERIFIED + LIVE (the current asset)

**The full slice, on `main`, each piece independently CTO-verified before merge (harness counts in the
scorecard):**
- **Lifecycle** (`bt-booking-service`): `accepted→in_transit→completed→paid` state machine, assigned-driver
  guards (JWT `userId`=`users.id` ≠ `drivers.id`), durable throttled `location_history` breadcrumb write.
- **Tracking** (`bt-tracking-service` + gateway `/api/tracking/*` route + shipper `<LiveTrackMap>`): the
  read-through `/track` aggregate returns live location + Google-computed route polyline + ETA. **Verified
  live** returning a real route.
- **POD** (`bt-cargo-ledger`): receiver-OTP (hashed+peppered, constant-time, rate-limited) drives
  `in_transit→completed` via a trusted internal call; migration 010 (`pod_receipts`).
- **Cash payment** (`bt-payment-service`): idempotent settle → `paid` + payout record, JWT-authed, outbox saga
  on `trip_completed`; migration 011 (`payments`,`payouts`). **Escrow deliberately cut** (RBI risk).
- **Pricing** (`bt-pricing-service`): deterministic CTO cost-breakdown (fuel/driver/per-km/handling) + JWT.
  **Constants are placeholders** (see §5.5 improvement).
- **Ops console** (`bt-ops-web`): real JWT/RBAC login (admin), live-trip board on real data, force-complete /
  reassign / cancel overrides (migration 012 `ops_overrides`), shadcn/ui.
- **Driver PWA** (`driver/`): manifest + service worker (skips cross-origin/non-GET) + Screen Wake Lock (D-008).
- **Infra:** GitHub Actions **CI** (path-filtered build/test, green), `packages/shared` (@bharattruck/shared —
  errors/auth/db extracted, `bt-booking-service` migrated onto it via `file:` dep + `install-links=true`).

**LIVE on GCP Cloud Run** (project `project-aa0faf06-c115-438a-a36`, region `asia-south1`), all
`*-itcdoenefa-el.a.run.app`:
- Backend: `bt-gateway`, `bt-auth-service`, `bt-booking-service`, `bt-tracking-service`, `bt-cargo-ledger`,
  `bt-payment-service`, `bt-pricing-service`.
- Apps: `bt-shipper`, `bt-driver`, `bt-ops-web`.
- **Gateway** = `https://bt-gateway-itcdoenefa-el.a.run.app` (apps call this as `NEXT_PUBLIC_API_URL`; the app
  appends `/api`). Existing services already carry `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`,
  `JWT_SECRET`, and the Maps **server** key (on tracking) as inline env.

**Seeded live demo data** (in the real Supabase DB — see §6): demo users
`demo-shipper@bharattruck.dev` / `demo-driver@…` / `demo-ops@…`, all password `demo-<role>-2026`; one
`in_transit` booking `55555555-5555-5555-5555-555555555555` on Mumbai (Nhava Sheva) → Nagpur (MIHAN) with
breadcrumbs + `receiver_email`. Verified: login→booking→`/track`→ops-admin-board all work.

---

## 5. OPEN WORK — what needs to be done next

### 5.1 Finish the live demo (small, high-priority)
1. **Map won't render on shipper.** Two causes: (a) the **wrong key** was baked into the shipper build — the
   *server* key (`bt-tracking-server`, `AIzaSy…MChzYw`, restricted to Routes/Places) instead of the **browser**
   key `bt-browser-maps-js` (uid `572addfa-03af-448c-87ef-9e12e74798d5`); (b) that browser key's allowed
   referrers are `*.vercel.app`/localhost, **not the Cloud Run domain**. **Fix:** add
   `https://*.run.app/*` to the browser key's referrers *(guardrail may block the CTO from editing an API key —
   ask the founder to run `gcloud services api-keys update 572addfa-… --allowed-referrers="…,https://*.run.app/*"`
   or authorize it)*, then rebuild the shipper app baking the **browser** key into
   `shipper/Dockerfile` (`NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`) and redeploy.
2. **POD + payment not live.** `bt-cargo-ledger` and `bt-payment-service` were redeployed with the new code but
   are **missing shared env** (`JWT_SECRET`, `REDIS_URL` on cargo; `JWT_SECRET` on payment) + inter-service URLs
   (`INTERNAL_SERVICE_SECRET`, `BOOKING_SERVICE_URL`, `PAYMENT_SERVICE_URL`). The reading of those secret values
   from other services is **guardrail-blocked** for the CTO — get the `JWT_SECRET`+`REDIS_URL` values from the
   founder (Cloud Run console → any `bt-*` service → Variables) and set them via
   `gcloud run services update … --update-env-vars`. A generated `INTERNAL_SERVICE_SECRET` must be **identical**
   across booking/cargo/payment. Then POD-OTP-closes-trip + cash-settle→paid go live.
3. **How to test progress live** (the founder asked): the trip advances when the **driver posts GPS**
   (`POST /api/location/update` as demo-driver → shipper `/track` shows a moving truck) and via **lifecycle
   transitions** (ops force-complete, or POD, or payment). The outgoing CTO demonstrated `in_transit→completed`
   live via the ops force-complete endpoint.

### 5.2 The kartik decision (payment + pricing) — DECISION PENDING FROM FOUNDER
Full review in §7. Recommendation (both independent reviews agreed): **keep the CTO's TS services for the MVP**
(they're live/integrated/verified/RBI-safe/roadmap-aligned); **harvest kartik's real pricing constants**
(`feat/python-engines:bt-pricing-service/ml-engine/cto_data.py`) into `bt-pricing-service/src/lib/cto-cost.ts`
(replaces placeholder constants, no Python runtime); **park kartik's LinUCB RL** (behind `PRICING_MODE=ml`) and
his **Razorpay/escrow skeleton** (behind `PAYMENT_MODE=gateway`) on `feat/python-engines` as post-feasibility
upgrades. The founder will confirm which to keep/skip; then execute + bring `main` to a clean stable state.

### 5.3 Real gaps to close (from the PRD, verified as missing)
- **DB-backed quote-lock** — persist a quote_id so shown price = charged price (§5.4). Neither impl has it.
- **Pricing constants** are placeholders (harvest kartik's — see 5.2).
- **KYC** is 501-stubbed (`bt-auth-service`); manual ops approval acceptable until W5; real Surepass/Vahan later.
- **Cargo-ledger checkpoint persistence** (audit #16), **detention/refund** (deferred), **notification channel**
  (SMS/WhatsApp/FCM — Part 13 Q6, decide early), **Capacitor Android** wrap (W6, background GPS).
- **PII hardening**, observability (request IDs, DB/Redis health probes), the `packages/shared` migration of the
  remaining services (Option-C `file:` pattern is proven — see the T-BE-7 scorecard entry).

### 5.4 Open decisions for the founder (Part 13 + surfaced during build)
Notification channel (Q6); exact 2–3 truck classes + real fleet constants (Q9 — pricing); Supabase tier
(free vs Pro/PITR for money); whether escrow/RL are reversed back into scope (kartik decision).

---

## 6. Infra, credentials & access (all confirmed working)

- **GCP:** `gcloud` is authed as `deltaos1997@gmail.com`, active project `project-aa0faf06-c115-438a-a36`
  ("My First Project"), region `asia-south1`. **Docker daemon runs** (can build/push images). Artifact Registry
  + Cloud Build + Run APIs enabled. Deploy pattern: `gcloud run deploy <svc> --source <dir> --region asia-south1`
  (uses each service's Dockerfile; `--update-env-vars` merges, preserving existing env). Apps use standalone
  Next Dockerfiles baking `NEXT_PUBLIC_*` at build.
- **Supabase (LIVE, has real data + a separate PMO app in the same DB — be careful, additive-only):**
  project `rxbdzbcndpzznvqcbimg` ("bharattruck-mvp"), URL `https://rxbdzbcndpzznvqcbimg.supabase.co`. Reachable
  via the connected Supabase MCP (`list_tables`, `apply_migration`, `execute_sql`). **Migrations 009–012 have
  been applied** (location_history reconciled, pod_receipts, payments/payouts, ops_overrides; booking_status has
  `paid`; user_role has `admin`). The old `payments` table was reconciled additively for the cash writer.
  Base schema (users/drivers/bookings/quotes/negotiations) matches the code and holds real data.
- **Maps keys:** browser = `bt-browser-maps-js` (uid `572addfa-03af-448c-87ef-9e12e74798d5`, Maps JS, referrer-
  restricted — needs the Cloud Run domain added); server = `bt-tracking-server` (`AIzaSy…MChzYw`, Routes/Places,
  already set on `bt-tracking-service`). **Env-key names are locked** (CLAUDE.md) — use exactly:
  `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`, `GOOGLE_MAPS_SERVER_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`, `DIESEL_PRICE_INR`.
- **GitHub:** repo `Entropy-LLP/bharattruck` (`gh` authed as `CodeMongerrr`). Branches: `main` (stable/deployed),
  `feat/python-engines` (kartik's quarantined Python work — DO NOT merge as-is), `feat/app-builds-green` (stale).
- **Guardrails you'll hit:** the auto-mode classifier blocks (a) reading/copying secret **values** (env, key
  strings) and writing them to disk, (b) editing API-key restrictions, (c) weakening security (e.g. CORS `*`).
  For those, hand the founder the exact command or ask them to paste the value. This is by design — respect it.

---

## 7. The kartik review (payment + pricing) — evidence + recommendation

A second coder (kartik / `kinbox-ctrl`) force-added two Python services to `main`; they were **not** a
force-push over history (nothing lost) but **reintroduced cut scope** and would **break the Node Cloud Run
deploy** (need Python). Quarantined to `feat/python-engines`. Two independent deep reviews concluded:

**Pricing — his value is DATA, not architecture.** His `ml-engine/cto_data.py` has **real, data-grounded market
constants** (mileage/DEF/service/oil/wage/capacity by BS-norm) — the single most valuable artifact; his LinUCB
RL is real + trainable. BUT: his P0 breakdown endpoint (`GET /v1/cto`) is **broken** (AttributeError), quote_id
+ agent weights are **in-memory** (vanish on Cloud Run), no auth, scope-creep (backhaul/LinearQAgent the PRD
says drop), committed model/binary artifacts. **→ Keep the CTO's live TS engine as the P0 anchor; port his
constants in now; park his RL behind `PRICING_MODE=ml`.**

**Payment — his value is a Razorpay SKELETON for the DEFERRED escrow phase.** His Razorpay SDK plumbing +
HMAC webhook verification + webhook state machine are **real and well-layered**. BUT: escrow "release" **moves
no money** (no RazorpayX/Route, no payout table), refund is a stub, **no auth** (amount trusted from client), no
cash/direct modes, not wired to booking-service, schema mismatch (no `payouts`/FKs), and it's **self-custody
escrow → *worsens* the RBI exposure** the PRD warns against; it also duplicates POD (which belongs in
cargo-ledger). **→ Keep the CTO's live cash-recorded TS service for the MVP; keep his engine on the branch as
the escrow seed, to adopt post-feasibility (behind `PAYMENT_MODE=gateway`) only after it gains real payout +
auth + Route + schema reconciliation.** Neither impl delivers the PRD's escrow acceptance (money to driver
bank) today — and escrow is currently OUT of MVP per the binding roadmap.

---

## 8. Locked decisions — do not silently reverse (append a `D-xxx` to change)

- **Repo:** this one monorepo is the only source of truth; never push to retired `Entropy-LLP/*` standalones or
  `deltaos1997/*` mirrors.
- **Scope (committed cuts, OUT of MVP):** RL/LinUCB pricing, Razorpay **escrow** (cash-recorded/direct first),
  blockchain ledger anchor, fleet reviews, detention, halt alerts, multi-pickup/drop, in-app turn-by-turn.
  **Never cut:** lifecycle closure, tracking map, POD-OTP, KYC gate.
- **Payments:** first Completed Paid Trip settles **cash-recorded/direct**, not escrow.
- **Maps/Tracking:** the CONTRACT is FROZEN (`D-001..D-013`). Only Routes + Places(New) + Maps JS; deep-link nav;
  GPS **ingestion stays in `bt-booking-service`** (tracking only READS `location_history`); env-key names locked;
  polling 10s; no PostGIS (lat/lng decimals); `<LiveTrackMap>` copied per app.
- **Auth:** custom HS256 JWT shared across services (same `JWT_SECRET`), NOT Supabase Auth; service-role key →
  RLS bypassed → **all authz is in app code**.
- **§0 doc rulings** (CTO_AUDIT_FINDINGS §0): EXECUTION_ROADMAP is the single authoritative plan; blockchain OUT;
  pricing = deterministic v1 + quote-lock; Maps numbering = `D-001..D-013` + SESSIONS phases.

**Critical gotchas that will bite you:** `users.id` (JWT `userId`) ≠ `drivers.id` (via `getDriverByUserId`);
`bookings.driver_id`/`quotes.driver_id`/Redis `loc:*` all reference `drivers.id`. No stubs/TODOs in `main`.
Trunk-based `feat/*` → your audit → you merge. Definition of Done = **demoable through the UI on the pilot
corridor**, founder-verified — not "endpoint returns 200".

---

## 9. First actions for the incoming CTO

1. Read §2's docs (PRD first, then EXECUTION_ROADMAP, CLAUDE.md, the frozen Maps contract, this doc's siblings).
2. Register `cto` on claude-ipc; check for the `backend`/`frontend` nodes (they're holding — re-brief or assign).
3. Get the founder's decision on §5.2 (kartik keep/skip) and the two demo-unblock inputs (Maps browser key +
   `JWT_SECRET`/`REDIS_URL`).
4. Make the plan: finish the live demo (§5.1) → confirm main stable → then the PRD-driven backlog (§5.3), each
   as a `feat/*` task to an engineer, audited before merge. Keep `main` green + deployed at every step.
5. Hold everything against the **PRD Definition of Done (§11)** and the **north star: one Completed Paid Trip**.

_You have a live, verified, deployed system and a clean `main`. The job now is to finish the demo, decide the
kartik question, and drive the remaining PRD backlog with the team — verifying everything yourself before it
reaches the founder._
