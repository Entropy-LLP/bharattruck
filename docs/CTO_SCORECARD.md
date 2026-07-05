# BharatTruck — Engineer Scorecard

> Maintained by the `cto` node, reviewed by the founder. One row per node, updated on every review.
> Rubric in `docs/CTO_ENGINEERING_STANDARDS.md §4`. Marks are evidence-backed, not vibes.

## Standing

| Node | Correctness | Honesty | Contract discipline | Verification depth | Turnaround | Net |
|---|---|---|---|---|---|---|
| `backend` | ✅ (T-BE-1 reproduced: tsc exit 0 + 18/18 e2e) | ✅ (honest "PG unreachable" caveat, not hidden) | ✅ (slice scope + frozen contract respected) | ✅ (shipped a real inject()+Redis harness, not "compiles") | — | 🟢🟢 strong — T-BE-1 code verified by CTO |
| `frontend` | ✅ (T-FE-1 reproduced: both apps `Compiled successfully`, exit 0) | ✅✅ (self-reported its own push breach unprompted) | ✅ (frozen Maps contract clean; locked env keys; no legacy APIs) | ✅ (real build logs; no stubs/fake-data) | — | 🟢 strong work; ⚠️ one process breach (pushed pre-audit), honestly flagged & remediated |

Legend: ✅ positive · ⚠️ watch · ❌ breach · — not yet observed.

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
