# BharatTruck — CTO Audit & Task Backlog

> Evidence-backed production-readiness audit of the monorepo, run 2026-07-04 across four surfaces
> (backend services, frontend apps, infra/CI/deploy/security, planning docs). This is the CTO node's
> working backlog: hand these out as `task` messages per `docs/IPC_TEAM_PROTOCOL.md`. Trust the code,
> not the READMEs. All claims carry `file:line` evidence — **re-verify before assigning or accepting.**

Priorities: **P0** = blocks the walking skeleton / the one paid-trip slice. **P1** = required for the
MVP bar but not blocking today. **P2** = hardening / hygiene. Owning node in **[brackets]**.

---

## 0. Resolve FIRST — the docs contradict each other (a dev will build cut work)

> ### ✅ CTO RULINGS (2026-07-04) — these settle §0; build to these, not the stale docs
> 1. **Single authoritative plan = `docs/EXECUTION_ROADMAP.md`.** `ROADMAP.md` has been banner-marked
>    SUPERSEDED and its cut-scope lines annotated; `PRD` Part 10's escrow/blockchain/RL sequencing is
>    **historical only**. On any conflict about *what we build or cut*, EXECUTION_ROADMAP wins; the frozen
>    `MAPS_TRACKING_CONTRACT.md` wins on tracking/maps specifics.
> 2. **Retired-repo links fixed.** `ROADMAP.md` no longer links to `deltaos1997/*`; those point to
>    monorepo folders now. Nobody pushes to the retired standalones/mirrors.
> 3. **Blockchain / on-chain anchor = OUT** of MVP (deferred). **Receiver-OTP POD = IN.** Checkpoint
>    photos may be captured but are NOT anchored on-chain for the first paid trip. Confirmed.
> 4. **Pricing = the existing deterministic rate-card/CTO-breakdown quote engine (v1, already works)** with
>    quote-lock. The from-scratch Python/FastAPI + LinUCB rewrite is **OUT**. Quote-lock claim stays; no new
>    pricing week is scheduled — `bt-pricing-service` is spine-complete for the slice unless the slice needs
>    a specific fix.
> 5. **Maps numbering reconciled to the frozen scheme:** decisions are **`D-001..D-013`** (inline "Decision
>    1–8" labels are historical aliases, not a second scheme) and phases follow
>    **`MAPS_TRACKING_SESSIONS.md` (Phase 0–6)**. `MAPS_TRACKING_PLAN.md §8`'s phase numbers are subordinate.
>    No tracking phase past 2 starts until this is cited by its `D-xxx`/SESSIONS phase number.
>
> Original contradiction list (kept for context):

Before assigning feature work, the CTO must reconcile these or engineers will follow the wrong plan:

- **Three conflicting weekly roadmaps.** `EXECUTION_ROADMAP.md` (authoritative, 2026-07-04) cuts RL
  pricing, escrow, blockchain and sequences Tracking@W2 / KYC@W5. But `PRD` Part 10 keeps
  escrow/blockchain/RL (Tracking@W6, KYC@W2), and `ROADMAP.md` (dated 2026-07-01, pre-decisions)
  still lists "Razorpay escrow + milestone split" and "on-chain anchor" as in-scope. **Action:**
  annotate/delete the stale plans; make `EXECUTION_ROADMAP.md` the single source. [cto]
- **`ROADMAP.md` links to `deltaos1997/*` repos** that are slated for deletion (retired mirrors). Fix
  or remove. [cto/infra]
- **Blockchain ledger is both "core P0" (PRD §5.7) and "OUT" (EXECUTION_ROADMAP).** Decide: is
  tamper-evident custody in the feasibility bar at all? (Receiver-OTP POD is IN; on-chain anchor is
  OUT — confirm.) [cto]
- **Pricing is "spine/IN" but has no week and no slice step**, and the PRD wants a from-scratch
  Python/FastAPI rewrite. Either schedule it or drop the quote-lock claim. [cto]
- **Two Maps phase-numbering schemes** (`MAPS_TRACKING_SESSIONS.md` vs `MAPS_TRACKING_PLAN.md` §8
  define Phase 1–5 differently) and **two decision-numbering schemes** (inline "Decision 1–8" vs
  frozen `D-001..D-013`). Reconcile into one before anyone "does Phase 3". [cto]

---

## 1. P0 — blocks the walking skeleton / the paid-trip slice

1. **Trip lifecycle dead-ends at `accepted`.** State machine defines
   `pending→accepted→in_transit→completed` (`bt-booking-service/src/lib/state.ts:10-17`) but **no code
   path leaves `accepted`** — routes expose only accept/cancel (`src/routes/bookings.ts`);
   `service.ts` has no `in_transit`/`completed` transition. This is the missing spine. **[backend]**
2. **`location_history` breadcrumb write does not exist.** `POST /location/update` writes only
   ephemeral Redis (`bt-booking-service/src/routes/location.ts:97-103`); no durable trail → no
   traveled-path/history, weakens POD proof. **[backend]** (write owner = booking-service, per D-007)
3. **DB schema is not version-controlled.** Zero `.sql` files anywhere; `supabase/migrations/` has
   only a README documenting 7 migrations that were never created; **migration 009 (`location_history`)
   does not exist** — it's only in docs, marked INFERRED. No baseline, no rollback, no DR. **[infra]**
4. **No CI/CD exists.** No `.github/workflows/`, no cloudbuild — nothing builds/tests/deploys, yet
   `ROADMAP.md:31` claims "prod on Cloud Run". Templates in `docs/legacy-ci-reference/` need path
   filters + new-repo WIF re-authorization before they'd work in a monorepo. **[infra]**
5. **`driver/` does not build** — 6 onboarding pages import **11 undefined API fns** + **6 undefined
   types** from `@/lib/api` / `@/lib/types` (e.g. `getOnboardingProfile`, `submitLicense`,
   `createVehicle`, `linkBankAccount`; types `License`, `Vehicle`, `Insurance`, `BankAccount`,
   `OnboardingStatus`, `OnboardingProfile`). See `src/app/onboarding/*/page.tsx`. **[frontend]**
6. **`shipper/` does not build** — imports missing `@/components/maps/LiveTrackMap` and `@/lib/maps`,
   plus unexported `getRoute`/`RouteData` (`src/app/bookings/[id]/page.tsx:14,16,24`);
   `@vis.gl/react-google-maps` is **not even declared** in `package.json`. **[frontend]**
7. **Gateway does not route `/api/tracking/*`.** `bt-tracking-service` (:3006) is unreachable through
   the edge — zero `tracking` blocks in `bt-gateway/nginx.conf.template`. **[infra/backend]**

---

## 2. P1 — required for the MVP bar

8. **Cash-recorded payment + payout record does not exist.** `bt-payment-service` returns hardcoded
   `rzp_stub_order_id`, webhook does **no signature verification**, no persistence, no auth
   (`src/routes/payments.ts:16-47`). Escrow is OUT of MVP, but the cash-recorded settle→`paid`→payout
   flow that the slice needs must be built. **[backend]**
9. **Receiver-OTP POD flow is absent.** No code drives `in_transit → completed` via a receiver OTP,
   and no transactional-email provider is named anywhere (a "never-cut" item with no plan). **[backend + cto to pick email provider]**
10. **KYC is a shell.** `SurepassClient.post()` throws (`bt-auth-service/src/lib/surepass.ts:45`);
    all verifications return `Pending`; routes `reply.code(501)` (`src/routes/kyc.ts:89,110`). Manual
    ops approval is acceptable until W5; real Surepass/Vahan by W5. **[backend]**
11. **Unauthenticated services exposed via the gateway.** `bt-payment-service`, `bt-cargo-ledger`,
    `bt-pricing-service` have no JWT check and nginx doesn't auth at the edge —
    `/api/payments/`, `/api/cargo/`, `/api/pricing/` are open (`nginx.conf:167-183`). **[backend]**
12. **Auth tokens (access + refresh JWT) in `localStorage`** in both PWAs
    (`driver/src/lib/api.ts:9-33`, `shipper/src/lib/api.ts:9-37`) → XSS = account takeover. Empty
    `next.config` (no CSP/security headers); a JWT-in-URL test path exists. **[frontend]**
13. **`bt-ops-web` is a non-functional mockup** — no live API calls (`axios` unused), hardcoded mock
    data (`app/ops/dashboard/page.tsx:11,26`), static login (`app/login/page.tsx:62`). Needs real
    auth/RBAC + live data for the W4 ops board. **[frontend]**
14. **No Screen Wake Lock on the driver trip screen** — GPS `watchPosition`
    (`driver/src/app/(app)/bookings/[id]/page.tsx:714`) with no wake lock → screen sleeps, OS
    throttles GPS mid-trip. Breaks the core driver use case (D-008). **[frontend]**
15. **No PWA infrastructure** despite the PWA label — no manifest, service worker, or offline in any
    app; not installable (D-008 requires minimal manifest + SW). **[frontend]**
16. **Cargo-ledger persistence absent** — Merkle hashing is real but every route returns `status:'stub'`
    with `// TODO: Supabase` (`bt-cargo-ledger/src/routes/shipments.ts:46,82,90-91,117`); on-chain is
    OUT but checkpoint/POD persistence is needed. **[backend]**

---

## 3. P2 — hardening & hygiene

17. **Zero automated tests** across all 7 services and all 3 apps — no framework, no scripts. Nothing
    guards the state machine, auth, RBAC, or pricing math. **[all nodes, ongoing]**
18. **No shared package; boilerplate duplicated.** JWT verify (3×), service-role Supabase client (3×),
    error envelope, and Fastify bootstrap (7×) are copy-pasted. `JWT_SECRET!` asserted, never validated
    at boot. A `packages/shared` (auth, db, errors, logging) is the missing piece. **[backend]**
19. **Weak observability.** No correlation/request IDs, shallow health checks (don't probe DB/Redis),
    only 1/7 services has a global error handler, no graceful shutdown, `CORS origin:true` everywhere.
    **[backend/infra]**
20. **Incoherent deployment story** — Cloud Run (docs) vs Render (gateway config/README) vs k8s (1/7
    manifests) vs 2 composes vs AWS refs. Pick one target. **[infra/cto]**
21. **Committed weak default secrets** — `docker-compose.yml:90` bakes a known 64-hex `ENCRYPTION_KEY`
    fallback (encrypts bank PII) + dev `JWT_SECRET` fallbacks; prod-via-compose without overrides
    silently uses public keys. Make them mandatory (drop the `:-` default). **[infra]**
22. **Suspicious `bt-ops-web` deps** — `@anthropic-ai/claude-code` as a *runtime* dependency, and
    `lucide-react ^1.7.0` (real releases are `0.x` → wrong/typosquat-risk pin). **[frontend]**

**Positives (keep):** no real production secrets are committed; `.gitignore` correctly excludes
`.env*`; the Nginx gateway is genuinely well-hardened (per-IP rate limits, security headers,
single-authority CORS, retries); `bt-tracking-service` is the most complete service (real Routes/ETA,
Redis caching, RBAC, durable upsert, global error handler); the auction/negotiation engine in
`bt-booking-service` is solid; both PWAs share a clean central API client with a token-refresh mutex.

---

## 4. External gates & single points of failure (CTO to track)

- **"Registered entity" gate** blocks Surepass (KYC), Razorpay (payments), and GCP-billing (Maps
  Phase 0). Resolve before W5–W6. Until then KYC silently degrades to manual eyeballing.
- **Single vendors, no fallback:** Surepass (9 KYC types incl. Aadhaar/UIDAI sensitivity); Google Maps
  (quota is a *fail-closed hard cap* on a never-cut feature — a bug in the 10s poll trips it and the
  map dies); Supabase (SPOF, service-role key bypasses RLS → one leak = full-DB compromise; no pgBouncer
  noted for many Cloud Run instances); single Redis (OTP + sessions + live location + caches).
- **Payment/RBI landmine:** escrow deferred via cash-recording, but a real launch invokes RBI
  PA/escrow licensing (multi-month). No date/owner/partial plan.
- **POD email deliverability:** the loop-closing OTP goes to an arbitrary consignee's inbox via an
  unnamed provider — no bounce/retry plan.
- **Notification channel undecided** (SMS vs WhatsApp vs FCM); WhatsApp Business onboarding can take
  weeks — decide early or it won't be ready for the W7/W8 pilot.
- **Capacitor "Go native" (W6)** is large/unspecified: reliable Android *background* GPS (Doze/battery
  optimization) is exactly what the web PWA can't do; `@vis.gl/react-google-maps` is web-only. No spike
  scheduled before it. High risk to the W7 real-device pilot.
- **Timeline:** W0 (this week) + W1–W8 lands ~end-Aug/early-Sep against a **31 Aug hard deadline** —
  zero slack, no per-week owners/estimates, 2–4 engineers from a ~30%-stub base with 5 trust-critical
  subsystems at zero.

---

## 5. Suggested first wave of tasks (dependency order)

Assign these once the bus is up; they are the walking skeleton + slice step 1:

- **[infra] T-INFRA-1:** Capture a baseline Supabase migration + author migration 009 (`location_history`)
  under `supabase/migrations/`; stand up CI (`.github/workflows/`) from `docs/legacy-ci-reference/` with
  per-service path filters. (P0 #3, #4)
- **[infra] T-INFRA-2:** Route `/api/tracking/*` through `bt-gateway` to `:3006`; pick ONE deploy target.
  (P0 #7, P2 #20)
- **[backend] T-BE-1:** Implement lifecycle transitions + endpoints `accepted → in_transit → completed`
  in `bt-booking-service`, and the throttled `location_history` write on the ingestion path. (P0 #1, #2)
- **[frontend] T-FE-1:** Get `driver/` + `shipper/` to green `next build` — implement the 11 missing
  onboarding fns/6 types; add `@vis.gl/react-google-maps` + `LiveTrackMap`/`lib/maps` + `getRoute`. (P0 #5, #6)
- **[cto] T-CTO-1:** Reconcile the three roadmaps + Maps numbering (§0); pick the email provider (POD)
  and notification channel; confirm blockchain OUT / pricing scheduling.

_Generated 2026-07-04. Re-verify each finding against current code before acting._
