# BLOCKERS — things only a human can unblock

> **The single list of what needs you.** Absorbed the old root `FOUNDER_ACTIONS.md` (2026-08-03) —
> everything in it was either done or is carried below. Nothing here is waiting on more engineering:
> each item needs a credential, an account, a console click, or a decision.
>
> **Every claim below was verified against prod on 2026-08-03**, not carried forward from a handoff.
>
> Last verified: **2026-08-03**

| | |
|---|---|
| 🔴 | A shipped feature is inert or unsafe in production until this is done |
| 🟠 | Blocks a feature from being finished; code is built and inert |
| 🟡 | Not blocking today; will block before the pilot |

---

## 🔴 B-0 · Migration `0023_payout_split.sql` is NOT applied

**Verified:** the migration ledger's newest row is `0022_unified_identity`, and
`payouts_booking_id_key` (the old `UNIQUE(booking_id)`) is still present on the live table.
The file exists at `supabase/migrations/0023_payout_split.sql` and the **code is merged and deployed**.

**Why it is safe right now:** the shipped write path deliberately uses **no `ON CONFLICT`**, so it
works against both the pre- and post-0023 schema. Settlement is not broken. Additionally all 8 live
`fleet_drivers` rows sit at `revenue_share_pct = 0.00`, so no split can currently arise.

**Why it still matters:** a split needs **two payout rows per booking**, which the surviving
`UNIQUE(booking_id)` forbids. **The first fleet owner who sets a real revenue share will hit a
constraint violation on settlement.**

**To unblock:** apply `0023` via the Supabase MCP (`execute_sql`, then write the
`supabase_migrations.schema_migrations` ledger row by hand — `apply_migration` is classifier-blocked
in this project; the procedure is in `BIBLE.md`).

---

## 🔴 B-1 · Geofencing is inert — ONE missing env var

**Verified:**

| Service | Var | State |
|---|---|---|
| `bt-booking-service` | `TRACKING_SERVICE_URL` | ✅ set |
| `bt-booking-service` | `INTERNAL_SERVICE_SECRET` | ✅ set |
| `bt-tracking-service` | `INTERNAL_SERVICE_SECRET` | ❌ **MISSING** |

`bt-tracking-service/src/plugins/internal-auth.ts:18` reads it and **refuses every internal request**
without it. So booking-service sends the geofence evaluation and tracking-service rejects it.
Geofencing is merged, deployed, and doing nothing.

```bash
gcloud run services update bt-tracking-service --region=asia-south1 \
  --update-env-vars INTERNAL_SERVICE_SECRET=<same value as the other services>
```

> ⚠️ **`--update-env-vars`, never `--set-env-vars`.** `--set` wipes every unlisted var — that is the
> exact fault that crash-looped payment and pricing on 2026-07-28.

---

## 🟠 B-2 · DLT registration — phone OTP

**The longest-lead item on the project. Nothing else on this list costs calendar days the way this
does.**

TRAI **DLT** registration (entity ID, registered header, pre-approved SMS templates) plus an SMS
provider account (MSG91 / Twilio / Gupshup). Template approval takes **days to weeks** and cannot
start until the entity is registered.

**State:** `POST /auth/send-otp` generates a real OTP and **console-logs it** — no provider is wired.
Phone login is a dead end for real users; email OTP works.

---

## 🟠 B-3 · Razorpay credentials — automated payouts

**Verified:** `bt-payment-service` has **no** `RAZORPAY_*` vars set in prod. They are declared and
empty in `.env.example`. GCP Secret Manager holds only unrelated `anvaya-*` secrets.

Needs a Razorpay account with **Route** enabled — Route is the product that moves money to
*stakeholder-owned* linked accounts rather than letting it rest with the platform. That is the design,
and it is also what keeps us clear of GTA classification (`INDIA_FREIGHT_COMPLIANCE.md §1.3`).

**Consequence while blocked:** settlement stays **record-only**, which is a legitimate MVP mode.
Nothing is broken.

---

## 🟠 B-4 · Legal opinion — GTA exposure

A written opinion from Indian indirect-tax counsel. Checklist in
`INDIA_FREIGHT_COMPLIANCE.md §10`.

Issuing a consignment note in your own name is what makes a platform a **GTA** under GST — two
2025-26 rulings held an e-commerce platform to be the GTA on exactly that basis despite owning no
trucks. Our design (LR in the fleet owner's name and series) is the right structure and well
supported, but **no court has decided the case where the document names one party and the commercial
substance points at another, and that case is ours.**

Sharpest item: **Carriage by Road Act s.3 registration.** s.2(a) defines "common carrier" to include
*"a goods booking company, contractor, agent, broker"* — broad enough to reach a freight marketplace —
and operating unregistered is still a punished act after the 2026 Jan Vishwas amendment. **That
exposure is not solved by keeping our name off the LR.**

---

## 🟠 B-5 · GSP contract — in-platform e-way bill generation

Deliberately **out of MVP** (D-17): we record and attach an externally-generated e-way bill instead.
Needs a GST Suvidha Provider contract and likely **ISO 27001:2013** (3–6 months; at least one GSP
requires it within 90 days of go-live).

Also, per customer and **not automatable**: every shipper *and* fleet owner must log into the e-way
bill portal → Registration → For GSP → OTP → pick the GSP → create an API username/password.
~2 minutes each, and the biggest onboarding-funnel drop-off risk.

---

## 🟡 B-6 · Confirm the leaked Maps **server** key was rotated

The code fix has landed — **verified: no `AIzaSy` value exists anywhere in the working tree**, and the
app Dockerfiles now take the browser key as a build ARG. But the previously-committed **server** key
is still in **git history**, so the exposed value must be dead.

**Only you can confirm:** Cloud Console → Google Maps Platform → Keys → regenerate the
`bt-tracking-server` key, update `GOOGLE_MAPS_SERVER_KEY` on `bt-tracking-service`, and confirm it is
API-restricted to Routes + Places (New).

---

## 🟡 B-7 · Surepass credentials — real KYC

To replace the KYC **stub** with real verification. Post-pilot; KYC deliberately does not gate use at
MVP (D-5).

---

## 🟡 B-8 · Gateway returns HTML on 429

`bt-gateway` rate-limits `/api/auth/` and returns nginx's stock HTML error page. Both apps call
`res.json()` on every response, so it throws and the user sees *"Server error — please try again"*
instead of anything about rate limiting. Reachable by mistyping a password a few times.

Fix is an `error_page 429` in the gateway returning the `{success, code}` envelope. Every service
behind the gateway shares the exposure, so it is worth doing once, deliberately.
Recorded in `BIBLE.md §5.4`.

---

## 🟡 B-9 · `SMTP_DAILY_BUDGET` is unset (defaults to 500/day)

**Verified:** `bt-auth-service` has `SMTP_HOST/PORT/USER/PASS/FROM` set but **no**
`SMTP_DAILY_BUDGET`, so the code default of 500/day applies across all auth mail.

Fine at pilot scale. **Raise it before any campaign** — hitting it also stops real verification codes.

```bash
gcloud run services update bt-auth-service --region=asia-south1 --update-env-vars SMTP_DAILY_BUDGET=2000
```

---

## 🟡 B-10 · West Bengal e-way bill threshold unverified

Two independent research passes reached **different conclusions** about when WB's intra-state
threshold changed. The threshold table is built effective-dated with per-row notification provenance
precisely so this stays answerable — but confirm the WB row against the state gazette before anyone
relies on it. `INDIA_FREIGHT_COMPLIANCE.md §0.2`.

---

## ✅ Resolved

| Item | Resolution |
|---|---|
| Migration 0022 could not be applied (`apply_migration` classifier-blocked) | Founder authorised `execute_sql`; applied + verified 2026-08-03, ledger row written by hand |
| CI/CD IAM + Workload Identity | Done — CD green, last 3 runs successful |
| Maps server key committed in Dockerfiles | Code fixed; no key value in the tree. Rotation confirmation is B-6 |
| "Get a testable app live" | Done — all 12 Cloud Run services healthy |
