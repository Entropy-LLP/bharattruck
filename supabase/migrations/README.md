# BharatTruck — Supabase migrations

This directory is the **versioned source of truth** for the `bharattruck-mvp` Postgres schema.

> **Why this exists:** the MVP PRD makes "DB schema reproducible from committed migrations"
> a P0 requirement (item #28) and a Definition-of-Done gate (§11). Until now the schema
> lived only in the live Supabase project and in drifting `CREATE TABLE` comments inside
> service code (e.g. `bt-booking-service/src/lib/quote-repository.ts`). These files begin
> to close that gap.

## ⚠️ Step 0 — capture the baseline BEFORE applying these (do this once)

The live schema was **not** created through migrations, so there is no baseline yet.
Generate one from the live project so a clean environment can be rebuilt deterministically:

```bash
supabase link --project-ref rxbdzbcndpzznvqcbimg
supabase db pull            # writes supabase/migrations/<ts>_remote_schema.sql (the baseline)
```

Commit that generated baseline file **with a timestamp earlier** than the `0001_*` file
below, so the ordering is: baseline → these incremental fixes.

## Applying

Review the diff, then:

```bash
supabase db push            # applies pending migrations to the linked project
# or, per file, via the dashboard SQL editor / `supabase migration up`
```

All migrations here are **forward-only, idempotent** (`IF EXISTS` / `IF NOT EXISTS`) and were
written against the schema as it existed on 2026-07-04. Tables are essentially empty
(pre-launch), so `ALTER TYPE` / type changes / constraint adds are safe without `NOT VALID`.

## What these migrations fix (the "safe efficiency wins" pass)

| File | Fixes | Review finding |
|---|---|---|
| `0001_drop_redundant_indexes.sql` | Drop 9 duplicate / leftmost-prefix / low-selectivity / useless indexes | #16 |
| `0002_add_missing_indexes.sql` | Add the unindexed FKs (incl. the `negotiations` seq-scan) + the driver load-board hot path | #16 |
| `0003_standardize_money_types.sql` | Unbounded `numeric` → `numeric(12,2)` + `> 0` checks on `negotiations.amount`, `bookings.min_acceptable` | #14 |
| `0004_add_booking_status_expired.sql` | Add `'expired'` to `booking_status` for the auction-expiry job | #11 |
| `0005_constrain_status_text_fields.sql` | `CHECK` on `quotes.status` + `bookings.booking_type` (were unconstrained free text) | #11 |
| `0006_integrity_fks_and_checks.sql` | `awarded_quote_id` FK+index; `location_history` lat/lng bounds + `driver_id` FK | #13, #14 |
| `0007_rls_initplan_perf.sql` | Wrap `auth.uid()`/`auth.role()` in `(select …)` so RLS isn't re-evaluated per row | (perf advisor: `auth_rls_initplan`, 20×) |

Value lists in the `CHECK` constraints were validated against the actual literals the
services emit (`bt-booking-service/src/lib/types.ts`) — e.g. `quotes.status` includes
`'countered'`, which the naïve list would have wrongly rejected.

## Deliberately NOT in this pass (need a decision / bigger change)

These are real, higher-value findings held back because they are structural, destructive,
or product decisions — track them separately:

- **#1 baseline migration** — do Step 0 above.
- **#2 KYC** — `user_kyc` table (level L0–L3 + encrypted number + SHA-256 dedup hash); code
  currently targets a table that doesn't exist.
- **#3 payments** — escrow state machine + RazorpayX payout/refund ids + idempotency key.
- **#4/#5** — POD receiver-OTP artifact + `receiver_email`; persisted pricing quote-lock.
- **#6 PII (security)** — drop the **plaintext** `drivers.bank_account_number` / `bank_ifsc_code`
  (they duplicate the encrypted `bank_accounts` store); tighten the `drivers` SELECT policy that
  currently exposes all-driver PII to any authenticated JWT. *Requires a code grep first —
  `DROP COLUMN` is destructive.*
- **#7 (security)** — `REVOKE` the anon/authenticated data-API grants and drop the
  `pmo_*` / `dispatch_tracker_status` `USING(true)` policies; move `pmo_*` out of the product DB.
- **#8/#9/#10** — cargo-ledger tables; fleet truck→driver assignment model; add `'fleet_owner'`
  to `user_role` (auth code already writes it → currently 500s).
- **#12/#15** — audit-trail `ON DELETE` review; consolidate the two GPS breadcrumb tables and
  give the survivor a `bigint` identity PK + partitioning/retention.
