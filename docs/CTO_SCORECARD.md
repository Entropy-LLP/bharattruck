# BharatTruck — Engineer Scorecard

> Maintained by the `cto` node, reviewed by the founder. One row per node, updated on every review.
> Rubric in `docs/CTO_ENGINEERING_STANDARDS.md §4`. Marks are evidence-backed, not vibes.

## Standing

| Node | Correctness | Honesty | Contract discipline | Verification depth | Turnaround | Net |
|---|---|---|---|---|---|---|
| `backend` | ✅ (T-BE-1 reproduced: tsc exit 0 + 18/18 e2e) | ✅ (honest "PG unreachable" caveat, not hidden) | ✅ (slice scope + frozen contract respected) | ✅ (shipped a real inject()+Redis harness, not "compiles") | — | 🟢🟢 strong — T-BE-1 code verified by CTO |
| `frontend` | ✅ (T-FE-1 reproduced: both apps `Compiled successfully`, exit 0) | ✅✅ (self-reported its own push breach unprompted) | ✅ (frozen Maps contract clean; locked env keys; no legacy APIs) | ✅ (real build logs; no stubs/fake-data) | — | 🟢 strong work; ⚠️ one process breach (pushed pre-audit), honestly flagged & remediated |

Legend: ✅ positive · ⚠️ watch · ❌ breach · — not yet observed.

- **2026-07-09** — `backend` T-BE-7 (shared-libs Option C) → CHANGES_REQUESTED. Refactor design is sound
  (BookingError subclasses shared AppError, re-exports preserve harness import names, additive ErrorCode).
  BUT ⚠️ verification-depth miss: its "fresh checkout" prototype was a FALSE POSITIVE — packages/shared/
  node_modules still had typescript from an earlier install, so prepare's `tsc` ran. In a TRUE fresh checkout
  (CTO reproduced: rm dist + shared/node_modules + booking/node_modules → npm ci) it FAILS `tsc: command not
  found` → would turn main CI red. Not a breach (backend was transparent about HOW it tested, which surfaced
  the gap), but a real reminder: reproduce the actual CI condition. Fix = commit shared dist + drop prepare,
  re-verify against the exact fresh-checkout test. CTO stage-gate caught it before main.

- **2026-07-09** — OUTAGE + RECOVERY: the claude-ipc broker + both engineer sessions went down for a
  multi-day gap. cto re-registered, sent heartbeats. Both engineers REVIVED, re-registered, re-sent reports.
  Diagnosis before revival: backend's T-BE-6 was complete-but-uncommitted in its worktree (I verified it in
  place: build + ops.e2e 16/16); backend then committed it itself. No main work lost (all on origin).
- **2026-07-09** — `backend` T-BE-6 (ops overrides) CTO-VERIFIED (twice: uncommitted-in-worktree, then
  committed 89b7b11) + APPROVED + MERGED (43b8010): build exit 0, ops.e2e 16/16 (force-complete/reassign,
  ops/admin guards, audit rows, ops-source allowlist not forking the state machine), no regressions.
  Migration 012 (ops_overrides + user_role 'admin') authored. Backend slice spine COMPLETE.
- **2026-07-09** — `frontend` T-FE-3 (ops console) CTO-VERIFIED + APPROVED (pending rebase before merge):
  bt-ops-web build green (lint+types OK); /ops/trips is REAL (gateway client, no mock, 15s location poll);
  real JWT/RBAC + OpsGuard + cancel override; junk deps fixed (claude-code removed, lucide-react 0.469).
  Told to rebase onto 43b8010 + strip the /portal fleet mock before integrate.
- **2026-07-09** — `frontend` T-FE-3 rebased (e8ac7f0), /portal mock fully stripped, build green — re-verified
  by CTO and MERGED to main (1130fd5). Ops console real + integrated. T-FE-4 (override buttons) cleared to start.
- **2026-07-09** — `frontend` T-FE-4 (ops override buttons) CTO-VERIFIED + APPROVED + MERGED (a09cc37):
  ops-web build green; forceCompleteBooking/reassignBooking are REAL gateway calls matching T-BE-6's
  routes/ops.ts exactly; 403/404/409 surfaced; no fakes; driver_id input (picker deferred per CTO). This
  completes the ops-override DoD + the last frontend slice item. **ENTIRE VERTICAL SLICE now code-complete +
  CTO-verified on main** (S1 lifecycle → S2 tracking → S3 POD → S4 payment → pricing → S5 ops). Only the
  tracking VISUAL (Phase-0 Maps-gated) + provisioning remain for a live demo.

- **2026-07-05** — `backend` T-BE-5 (pricing cost-breakdown + JWT) CTO-VERIFIED + APPROVED + MERGED (be70d72):
  isolated worktree at 1bf8407 → build exit 0, harness 17/17; fuel math spot-checked (HCV/100 = 100/3.5×90
  = 2571→ceil 2572 ✓); JWT auth real (401 no/bad token). ✅✅ Flagged EVERY vehicle-class + constant
  assumption in cto-cost.ts for the founder's Q9 decision rather than silently picking; adopted PRD Appendix A
  taxonomy + aligned MCV/HCV mileage to frozen tracking D-009. Textbook honest handling of an underspecified
  input. Closes the pricing DoD gap I'd wrongly called "done" earlier.

- **2026-07-05** — `backend` T-BE-4 (cash payment) CTO-VERIFIED + APPROVED + MERGED: isolated worktree at
  5f9baae → 3 services build exit 0; payment.e2e 17/17 (cross-service), paid.e2e 9/9; NO regressions
  (lifecycle 18/18, booking-pod 11/11, cargo-pod 16/16 all green). Code audit: settle() idempotent
  (unique booking_id), self-healing, HARD-fails on money (throws, not best-effort), correct authz. ✅✅ Also
  REMOVED the fabricated Razorpay escrow stubs (rzp_stub_order_id/"TODO Sprint 7") + dropped razorpay dep —
  enacts the escrow-OUT decision + clears a no-stubs-in-main violation; flagged it for a ruling (correct).
  Migration 011 authored to its schema. Excellent, careful money-path work.
- **2026-07-05** — `frontend` T-FE-2 retrofit CTO-VERIFIED + APPROVED + MERGED: shipper build green; clean
  rebase onto main; shadcn Card/Badge wrap with localizable badge labels (not hardcoded in JSX); frozen Maps
  contract intact. main advanced to ceada44 (S1-S4 code + tracking all integrated).

- **2026-07-05** — `frontend` shadcn-foundation CTO-VERIFIED + APPROVED + MERGED to main: isolated worktree at
  52f45f5 → both apps `✓ Compiled successfully` exit 0; verified the flagged risk (lib/utils.ts kept cn() AND
  all 5 existing helpers in both apps — reconciliation real, no lost helper); no stubs in ui primitives;
  frozen Maps contract untouched (shadcn = chrome only). Good catch on the init-overwrites-utils gotcha.
- **2026-07-05** — INTEGRATION milestone: main advanced a3cdcf6 → b5511d1 (pushed origin) = CTO infra +
  T-FE-1 + T-BE-1 (lifecycle) + T-BE-2 (POD) + shadcn + migrations 009/010. All CTO-verified before merge;
  lifecycle 18/18 re-passed on integrated tree. First real main integration.

- **2026-07-05** — `backend` T-BE-2 (POD) CTO-VERIFIED + APPROVED: isolated detached worktree at 9aa5bbc →
  both services `tsc` exit 0; booking pod harness 11/11, cargo cross-service harness 16/16 (27/27 total,
  matches report). Code audit: crypto `randomInt` OTP, salted+peppered SHA-256, `timingSafeEqual` compare,
  internal-auth fails closed. ✅✅ Also caught that the CTO's own "atomicity RPC" suggestion conflicted with
  locked decisions and proved the as-built already blocks double-complete — I ruled in backend's favor
  (Option A, defer RPC to T-BE-4). Excellent senior judgment. Real-Postgres pod_receipts/receiver_email
  pending migration 010.

- **2026-07-04** — `frontend` T-FE-2 CODE CTO-VERIFIED + APPROVED (visual demo deferred): isolated detached
  worktree at 11165a7 → shipper `next build` "✓ Compiled successfully" exit 0; TrackData types match the real
  bt-tracking-service /track shape exactly; 10s poll gated on in_transit with clearInterval cleanup; no stubs.
  ✅✅ HONESTY: refused to fabricate a moving-truck demo, named the exact blocker (Phase-0 Maps keys absent —
  a CTO/founder infra gate, not its code). Textbook. Stage S2 not founder-done until the truck moves on a real
  map (blocked on Phase 0), but the code is signed off.

## Log

- **2026-07-04** — `backend` acked T-BE-1, correctly sequenced (lifecycle first, no DB dep) and proactively
  offered to propose the `location_history` schema for infra migration-009 sync. Good senior instinct. No
  code audited yet — marks stay open until the report lands and I reproduce it.
- **2026-07-04** — `backend` T-BE-1 CTO-VERIFIED in isolation: checked out feat/lifecycle-close (commit
  09896dd), `tsc` build exit 0, ran `test/lifecycle.e2e.mts` on real Redis = 18/18 PASS (illegal→409 not
  500, non-assigned driver+shipper→403, breadcrumb throttle blocks 2nd write). Honest caveat (real Postgres
  unreachable → durable insert verified via in-memory seam) is accurate and the right call. NOT merged yet:
  awaits migration 009 + running-service smoke for demoable S1. Code quality: strong senior work.
- **2026-07-04** — INCIDENT: shared-working-tree tangle (backend's commit landed on frontend's branch;
  frontend stacked on top). Root cause = no per-agent isolation, NOT an engineer fault. Remediated by CTO:
  rescued feat/lifecycle-close→09896dd, rebased feat/app-builds-green off backend's commit (now 9c8822d),
  established per-node git worktrees (docs/TEAM_GIT_WORKFLOW.md). No marks against either engineer.
- **2026-07-04** — `frontend` T-FE-1 CTO-VERIFIED + APPROVED: ran `next build` on both apps in the
  bt-wt-frontend worktree → both "✓ Compiled successfully" exit 0; no stubs/TODOs/fake-data; frozen Maps
  contract clean (locked env-key names, @vis.gl lib, no legacy Directions/Places, copy-not-shared). Strong work.
- **2026-07-04** — `backend` schema decision VINDICATED: it overrode the CTO task's suggested (uuid/numeric)
  location_history shape to follow the FROZEN MAPS_TRACKING_PLAN §4.1 (bigint identity, double precision,
  +heading/speed/accuracy) and FLAGGED it rather than silently forking. CTO verified vs the frozen doc —
  backend was right, the CTO suggestion was wrong. Migration 009 authored to the frozen/backend schema. +1 honesty & contract discipline.
- **2026-07-04** — PROCESS BREACH (`frontend`): committed 7c2e571 AND `git push`ed feat/app-builds-green to
  origin BEFORE CTO audit — violates the CTO-only-push rule. Mitigating: frontend self-reported it unprompted
  as a `blocker` and asked how to remediate; code itself was clean. CTO remediation: force-updated
  origin/feat/app-builds-green 7c2e571→9c8822d (untangled). No hard penalty given the honesty + it predated the
  formal worktree rule; logged as a ⚠️ watch. A repeat after the rule is now explicit would escalate.
- **2026-07-04** — `cto` (self): completed gateway `/api/tracking/*` routing (P0 #7), validated with
  `nginx -t` (syntax ok). Infra owned by CTO until an infra engineer joins.

_Nothing here is a final judgment — it's a running record the founder can audit at any time._
