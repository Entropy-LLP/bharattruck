# BharatTruck — Execution Roadmap

> The committed, decision-baked plan to move BharatTruck from "everything 30% built" to a **Completed Paid Trip**. This is the operational plan; `ROADMAP.md` is the umbrella index and `docs/BHARATTRUCK_MVP_PRD.md` is the product spec. On any conflict about *how we work or what we cut*, **this doc wins**; the frozen `docs/MAPS_TRACKING_CONTRACT.md` still wins on tracking/maps specifics.
>
> **The bar (definition of done for the whole MVP):** one shipper → one driver → one **tracked, proven, PAID** interstate trip, completed end-to-end by a real external user who is not on the team.
> **Deadline:** 31 Aug 2026 · **North Star:** Completed Paid Trips.

**Decisions locked 2026-07-04** (do not silently reverse; log a dated change here if you must):
1. **Repo model → one fresh monorepo.** Consolidate from the scattered Entropy-LLP standalones; retire the standalones, the stale `Entropy-LLP/LogisticOS` aggregate, and the dead `deltaos1997/*` mirrors.
2. **Team → small (2–4 engineers).**
3. **First paid trip → cash-recorded / direct settlement.** Razorpay escrow is a *later upgrade*, not MVP.
4. **Scope → cut-order committed now** (see §3). RL pricing, escrow, blockchain ledger, fleet reviews, detention, and halt alerts are **OUT** of the first Completed Paid Trip.

---

## 1. Operating principles (how a senior team runs this)

1. **One source of truth, one working tree.** Until `git clone && git pull` yields the real code and `git push` lands it where CI reads, every status is fiction. This is the highest-leverage fix and it goes first.
2. **Walking skeleton before deep features.** Get the *thinnest* end-to-end thread running locally — apps build, gateway routes to every service, a dummy booking travels shipper → gateway → booking-service → DB → back. Then thicken it. Never integrate at the end.
3. **Vertical slices, not horizontal layers.** The unit of progress is "can booking #1 reach `paid`?", not "is bt-payment done?". **Definition of Done = demoable through the UI on the pilot corridor.**
4. **Ruthless triage against the North Star.** Anything not load-bearing for the one trip is cut or faked-by-Ops (manual KYC approve, cash-recorded payment). Cuts are committed in §3, not rediscovered in week 7.
5. **Trunk-based, PR-reviewed, CI-green, production-ready only.** Short-lived `feat/*` branches → one PR → CI must pass → merge to `main`. No stubs, TODOs, or `throw new Error('not implemented')` left in `main`.
6. **Progress is visible and honest.** One board tracks the *slice*, not per-service %. Weekly ritual: demo the thread end-to-end (GPS-simulated is fine). If it can't be demoed, it isn't done.

---

## 2. Week 0 — Stabilize & Connect (this week, blocks everything)

No feature work until the walking skeleton walks. Owner in brackets is a suggestion for a 2–4 team.

- **Consolidate the monorepo [lead].** Create the fresh monorepo from current standalone HEADs (`bt-auth`, `bt-booking`, `bt-pricing`, `bt-payment`, `bt-cargo-ledger`, `bt-ops-web`, `bt-tracking-service`, `driver`, `shipper`, `bt-gateway`, `supabase/`, `docs/`, `infra/`, `k8s/`). Archive the standalones and the old aggregate; **delete the `deltaos1997/*` remotes** so nobody pushes into the void. One CI matrix, one branch model.
- **Fix both app builds [frontend].** `driver/` fails `next build` (onboarding imports ~11 undefined fns/6 types) and `shipper/` fails (missing `LiveTrackMap`/`getRoute`/`@vis.gl/react-google-maps`). Green `next build` on both is the gate.
- **Wire the gateway to every service, including tracking [backend].** `bt-gateway` exists but doesn't route `/api/tracking/*` yet; apps hit `NEXT_PUBLIC_API_URL` (`/api/*`). Every service reachable through the gateway locally + on Cloud Run.
- **DB migrations into version control [backend].** Supabase schema is currently code-comments/ad-hoc. Capture a baseline migration + the pending ones (incl. `location_history` migration 009) under `supabase/migrations/`.
- **Real env URLs + secrets hygiene [lead].** Per-service prod URLs, `ENCRYPTION_KEY` (auth bank-account), the locked Google Maps keys, `JWT_SECRET` shared across services. No secret behind a `NEXT_PUBLIC_` prefix.

**Exit criteria:** fresh clone → `npm install` → both apps build → full stack runs locally → a dummy booking flows shipper → gateway → booking-service → Supabase → back, and the shipper sees it. CI green on `main`.

---

## 3. The committed scope

### IN — the spine (nothing ships the MVP without these)
Sign-up/login (all 3 surfaces) · truck-derived roles + truck CRUD · **KYC gate** (manual ops approval is acceptable early; real Surepass/Vahan by W5) · point-to-point load posting · auction + direct contract · bilateral negotiation (≤5 rounds, deadline) · CTO cost-breakdown pricing with quote-lock · **full trip lifecycle `accepted → in_transit → completed`** · live GPS + shipper live map + geofence · deep-link nav · **POD = receiver-email OTP that closes the trip** · **cash-recorded/direct payment + payout record** · Ops live-trip board + override · ≥1 notification channel · API gateway + DB migrations in VC · Capacitor Android wrap of the driver app for the on-road pilot.

### OUT — cut now to protect the spine (bring back only if the spine finishes early)
RL / LinUCB dynamic pricing · Razorpay escrow + milestone split (cash-recorded first) · blockchain hash-anchor ledger (checkpoint photos may still be captured; the on-chain anchor is deferred) · fleet-owner reviews · per-hour detention · >1hr halt alerts · multi-pickup/multi-drop · mid-trip renegotiation · in-app turn-by-turn (deep-link only).

---

## 4. The one vertical slice (drive this to 100% first)

**Booking #1, on the pilot corridor, from post to paid.** Build in dependency order:

1. **Lifecycle closure** — the missing spine. Add the endpoints/transitions that move a booking `accepted → in_transit → completed` in `bt-booking-service` (today it dead-ends at `accepted`). Also write the throttled `location_history` breadcrumb on the ingestion path.
2. **Live tracking rendered end-to-end** — pull the built `bt-tracking-service` `/track` aggregate + copy `<LiveTrackMap/>` into `shipper/`; shipper watches the truck move (GPS simulator first).
3. **POD closes the trip** — receiver-email OTP that drives `in_transit → completed` and triggers the payout record.
4. **Payment (cash-recorded)** — mark the trip `paid` via a recorded direct/UPI settlement; record the driver payout. No escrow.
5. **Ops can see + override** — real login/RBAC, the live-trip board shows the real trip, manual force-complete/reassign.

**Slice DoD:** a team member playing an external shipper posts a real interstate load, a KYC-approved driver wins and runs it, the shipper watches it live, the receiver's OTP closes it, and money is recorded as settled — **through the UI, no manual DB edits.**

---

## 5. Weeks 1–8 (re-baselined)

| Wk | Theme | Exit criteria |
|---|---|---|
| **0** | Stabilize & Connect | Walking skeleton walks; CI green; monorepo live |
| **1** | Lifecycle spine | Booking moves `accepted → in_transit → completed` via API + driver UI; breadcrumbs written |
| **2** | Tracking rendered | Shipper live map shows a (simulated) moving truck end-to-end via `/track` |
| **3** | Close the loop | Receiver-OTP POD closes the trip; cash-recorded payment marks it `paid`; **first end-to-end slice green (simulated GPS)** |
| **4** | Ops + hardening | Real ops auth/RBAC, live-trip board on real data, force-complete/reassign; smoke tests on money/booking/POD |
| **5** | Real identity | Un-stub KYC (Surepass PAN/Aadhaar/bank + Vahan/RC), Verified badge, ops approval queue real |
| **6** | Go native | Capacitor Android wrap (background GPS, wake lock, store-and-forward); ≥1 notification channel |
| **7** | Pilot dry-run | Real driver on the corridor, real device, real GPS; bug-bash the money/POD path |
| **8** | The proof | External non-team user completes one tracked, proven, paid trip unaided; harden + wrap |

**If the spine finishes early**, pull from the OUT list in this order: escrow → halt alerts → detention → reviews. **Never** cut: lifecycle closure, tracking map, POD-OTP, KYC gate.

---

## 6. Cadence & rituals

- **Daily:** trunk-based; PR per change; CI green before merge; keep `main` demoable.
- **Weekly:** demo the vertical slice end-to-end on the corridor (simulator ok). Update the slice board. Re-confirm the cut-list still holds.
- **Definition of Done (per feature):** merged to `main`, CI green, reachable + demoable through the UI, no stub left behind.
- **Open founder questions that still gate work** (from PRD Part 13): registered entity for Surepass/Razorpay onboarding; GPS transport (Redis pub/sub recommended for MVP); notification channel (WhatsApp + push recommended); confirm the 2–3 supported truck classes. Resolve before W5–W6.

_Last updated: 2026-07-04._
