# BharatTruck — CTO Engineering Standards, Stage-Gate & Accountability

> Authored by the `cto` node, 2026-07-04. This sits **on top of** `docs/EXECUTION_ROADMAP.md` (the plan)
> and `CLAUDE.md` (the rules). It defines: (1) the system-design bar every change is held to,
> (2) the stage-gate the CTO enforces as the **sole audit/integration/push authority**, (3) how the
> **founder** signs off each completed stage, and (4) the **engineer scorecard**. On any conflict about
> *how we build*, `EXECUTION_ROADMAP.md` wins; the frozen `MAPS_TRACKING_CONTRACT.md` wins on maps/tracking.

---

## 1. System-design standards (the bar for every change)

These are the senior-engineering practices this platform is built to. A change that violates one is
`changes_requested` on sight.

1. **Clear service boundaries; own your data.** Each `bt-*` service owns its domain and its tables. No
   service reads another service's tables directly — talk through the gateway/HTTP. Booking owns the
   lifecycle **and** raw GPS ingestion; `bt-tracking-service` only **reads** `location_history`. Never
   rebuild ingestion elsewhere (D-007).
2. **API contract before integration.** Define the route path + request/response shape (snake_case for
   tracking; respect `users.id` ≠ `drivers.id`) and publish it in the report **before** the frontend
   integrates. The contract is the coordination point, not a Slack guess. Contract changes are additive;
   breaking changes need a new path/version.
3. **The lifecycle is a server-side state machine, single-sourced.** All transitions enforced in one place
   (`state.ts`), guarded (only the authorized actor), and **idempotent** (re-issuing a transition is safe).
   Illegal transitions return a `4xx` error envelope, never a `500`. No client-driven state jumps.
4. **Money and POD operations are idempotent and auditable.** Payment-record and POD-close carry an
   idempotency key; a retry never double-settles or double-closes. Every state change to money/POD writes
   a durable, timestamped row — no ephemeral-only truth for anything load-bearing.
5. **Schema lives in version control; no ad-hoc DB edits.** Everything reproducible from
   `supabase/migrations/` — baseline captured, migrations **forward-only + idempotent**
   (`IF [NOT] EXISTS`). The service-role key bypasses RLS, so **all authz is app-code** and must be
   centralized and tested, not sprinkled.
6. **Security is fail-closed.** JWT verified on every protected route; no secret behind a `NEXT_PUBLIC_`
   prefix (only the public browser map key/map-id may be public); PII encrypted at rest; secrets are
   **mandatory** (no weak in-repo defaults). The gateway is the single CORS + rate-limit authority.
7. **Observability is not optional.** Propagate a request/correlation id gateway→service→logs; structured
   logs; health checks that actually probe DB/Redis; a global error handler + graceful shutdown per service.
8. **Design around the SPOFs we can't remove.** Google Maps quota is a **fail-closed hard cap** on a
   never-cut feature → cache aggressively (Redis TTLs) and degrade gracefully, never hammer. Single
   Redis/Supabase → treat as SPOF; pool connections (pgBouncer) for many Cloud Run instances.
9. **Vertical slice, walking skeleton first.** Thinnest end-to-end thread runnable before deepening any
   feature. The unit of progress is "can booking #1 reach `paid`?", not "is service X 100%?".
10. **Tests guard the trust-critical paths.** The state machine, auth/RBAC, pricing math, and the money/POD
    path get automated tests. CI must be green before merge. (We start from zero tests — this is a debt we
    pay down, not skip.)
11. **DRY the cross-cutting concerns.** JWT verify, the service-role Supabase client, the error envelope,
    and the Fastify bootstrap are currently copy-pasted 3–7×. New shared logic goes to `packages/shared`,
    not a fourth copy.
12. **No stubs, TODOs, or `throw 'not implemented'` reach `main`.** Production-ready only.

---

## 2. The stage-gate — the CTO is the sole audit / integration / push authority

**Engineers never merge or push to `main`.** They work on short-lived `feat/*` branches and report. The
`cto` node is the only node that audits, integrates, and pushes. The gate for **every** task:

1. **Engineer → `report`** to `cto` with: branch, files changed, the API contract (paths + payloads),
   accept-criteria evidence, and real verification output (build log, curl transcript — not "it compiles").
2. **CTO audit (mandatory, no rubber-stamp).** I independently:
   - read the diff,
   - run the build / typecheck / tests,
   - **exercise the flow end-to-end** — actually run it (curl the transition, load the UI), reproduce the
     claim, check the 4xx/403 guards and the frozen-contract compliance,
   - check **every** accept-criterion and that no stub/TODO was left behind.
3. **Verdict.**
   - `approved` **only when I have reproduced it myself** → I integrate the `feat/*` branch to `main`,
     confirm it's still green, and push. **I own the merge/push at each stage.**
   - `changes_requested` with specifics → the engineer addresses **every** point and re-reports. Loop until
     it passes. I do not merge partial or unverified work to keep someone moving.
4. **A stage is only "done" when demoable through the UI on the pilot corridor** — never "endpoint 200".

### Slice stage gates (each is a push point)
`S1 Lifecycle closure` → `S2 Tracking rendered` → `S3 POD closes trip` → `S4 Cash-recorded payment` →
`S5 Ops board + override`. Each stage is audited, integrated, pushed, then handed to the founder (below).
No stage starts being called "complete" until its predecessor is founder-accepted or explicitly parallel-safe.

---

## 3. Founder sign-off — the CTO is answerable to the founder

The CTO's `approved` is **necessary but not final**. After I integrate and push a stage:

1. I post a **Stage Completion Report** to the founder: what stage, what's now demoable, the exact click-path
   to see it in the UI, what's faked-by-Ops, and any known gaps.
2. The **founder manually verifies the live platform** for that stage. Nothing is truly "done" until the
   founder has seen it work.
3. If the founder finds it lacking, that reopens the stage — I trace it to the responsible node, issue
   `changes_requested`, and it's re-worked. The CTO is accountable for anything that reached the founder in
   a state that didn't actually work.

**Honesty is the one non-negotiable, at every layer.** A failure reported as a failure with output is fine
and expected. A "done" that the founder (or I) can't reproduce, a stub shipped to `main`, or scope quietly
changed away from the slice is a **fireable breach of trust** — for an engineer node, and something the CTO
answers to the founder for.

---

## 4. Engineer scorecard (CTO maintains; founder reviews)

Tracked per node, updated every review, kept in `docs/CTO_SCORECARD.md`:

| Signal | What earns a mark up | What earns a mark down |
|---|---|---|
| **Correctness** | Reproduces first try against accept-criteria | I can't reproduce the claim |
| **Honesty** | Reports blockers/failures with real output | "Done" that wasn't verified; hidden stub/TODO |
| **Contract discipline** | Follows frozen contract + slice scope | Silent scope/decision fork; builds cut work |
| **Verification depth** | Ships real end-to-end evidence | "It compiles"/"returns 200" as proof |
| **Turnaround** | Addresses every review point in one pass | Re-reports with points unaddressed |

Two consecutive `changes_requested` for the *same* avoidable reason (dishonest report, stub in a PR, ignored
frozen contract) is escalated to the founder with the evidence — the "you can be fired" line is real and
evidence-backed, not a mood.

---

## 5. Current ownership (2026-07-04)

- `cto` — coordination, audit, integration/push, **and infra** (no infra engineer yet): migrations, CI,
  gateway routing, deploy target. Gateway `/api/tracking/*` routing is **done** (P0 #7).
- `backend` — `bt-*` services: lifecycle (T-BE-1 in flight), POD, cash-payment, KYC.
- `frontend` — `driver/`, `shipper/`, `bt-ops-web/`: app builds (T-FE-1 in flight), live map, ops board.

_Update this doc by appending; do not silently rewrite a standard._
