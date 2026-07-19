# W1-8 — 503 fix runbook (env) + migrations reconcile

> Owner: infra node. Target: restore `bt-cargo-ledger`, `bt-payment-service`, `bt-pricing-service`
> to healthy on Cloud Run, and reconcile `supabase/migrations` against the live DB.
> **No secret values are written in this doc** — the env fix copies values from the already-healthy
> `bt-booking-service` at run time. Requires an operator with `gcloud` + deploy auth.

## 0. Facts

- **Project:** `project-aa0faf06-c115-438a-a36`  · **Region:** `asia-south1`
- **Image registry:** `asia-south1-docker.pkg.dev/project-aa0faf06-c115-438a-a36/bt/<service>`
- **Root cause of the 503s:** the deploy workflow runs only `gcloud run deploy --image` with the
  comment *"existing env + runtime SA preserved"* — it **never sets env vars**. On services whose
  Cloud Run env was never populated, a required var is missing, the container throws at boot
  (`throw new Error('… must be set')`) and Cloud Run serves 503. Reference: the healthy
  `bt-booking-service` already has the shared env set.

```bash
export PROJECT=project-aa0faf06-c115-438a-a36
export REGION=asia-south1
```

## 1. Required env — VERIFIED AGAINST CODE (not the ticket text)

Derived from `grep process.env` + the boot-time `throw new Error('… must be set')` guards in each
service. **This differs from the W1-8 ticket's list** (see §4 discrepancies):

| Service | HARD-required at boot (throws → 503 if missing) | Also used |
|---|---|---|
| `bt-cargo-ledger` | `BOOKING_SERVICE_URL`, `INTERNAL_SERVICE_SECRET`, `REDIS_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | POD email (optional): `RESEND_API_KEY`, `POD_OTP_PEPPER`, `POD_EMAIL_FROM`, `RECEIVER_APP_BASE_URL`; `BLOCKCHAIN_ENABLED=false` |
| `bt-payment-service` | `BOOKING_SERVICE_URL`, `INTERNAL_SERVICE_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET` | — |
| `bt-pricing-service` | `JWT_SECRET` (per-request in `plugins/auth.ts`; not a boot throw) | `DIESEL_PRICE_INR` (default 90) |

Guards: `bt-cargo-ledger/src/lib/{booking-client,supabase,redis}.ts`,
`bt-payment-service/src/lib/{booking-client,supabase}.ts`, `packages/shared/src/db.ts`.

## 2. Copy-from-booking (source of truth for values)

`bt-booking-service` is healthy and already holds the shared values. Read them (plain env vars are
readable via `describe`; requires `run.services.get`):

```bash
# Booking's internal URL (feeds BOOKING_SERVICE_URL on the others)
BOOKING_URL=$(gcloud run services describe bt-booking-service \
  --region "$REGION" --project "$PROJECT" --format='value(status.url)')

# Helper: pull one env var's value from booking
bookenv() { gcloud run services describe bt-booking-service --region "$REGION" --project "$PROJECT" \
  --format="json" | jq -r --arg k "$1" '.spec.template.spec.containers[0].env[] | select(.name==$k) | .value'; }

INTERNAL_SERVICE_SECRET=$(bookenv INTERNAL_SERVICE_SECRET)
JWT_SECRET=$(bookenv JWT_SECRET)
REDIS_URL=$(bookenv REDIS_URL)
SUPABASE_URL=$(bookenv SUPABASE_URL)
SUPABASE_SERVICE_ROLE_KEY=$(bookenv SUPABASE_SERVICE_ROLE_KEY)

# Sanity: every value below must be non-empty. If any is empty, booking stores it in Secret
# Manager (not plain env) or you lack read access → see §5 (founder).
for v in INTERNAL_SERVICE_SECRET JWT_SECRET REDIS_URL SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY BOOKING_URL; do
  [ -n "${!v}" ] || echo "MISSING FROM BOOKING: $v"; done
```

## 3. Apply env + redeploy (one command per service)

`gcloud run services update --update-env-vars` **merges** (does not wipe other vars) and creates a
**new revision automatically** — that is the redeploy. Do NOT use `--set-env-vars` (it replaces the
whole env and would wipe anything already correct).

### 3.0 Minimal deltas — LIVE-VERIFIED (only what is actually missing)

Verified via `gcloud run services describe` on 2026-07-12: all three are `/health` **503**; booking is
**200**. The `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` pair is **already set** on cargo + payment, so
set ONLY the missing vars below (the §3.1 full sets are also fine — merge is idempotent):

```bash
gcloud run services update bt-cargo-ledger  --region "$REGION" --project "$PROJECT" \
  --update-env-vars "^@^BOOKING_SERVICE_URL=$BOOKING_URL@INTERNAL_SERVICE_SECRET=$INTERNAL_SERVICE_SECRET@REDIS_URL=$REDIS_URL"
gcloud run services update bt-payment-service --region "$REGION" --project "$PROJECT" \
  --update-env-vars "^@^BOOKING_SERVICE_URL=$BOOKING_URL@INTERNAL_SERVICE_SECRET=$INTERNAL_SERVICE_SECRET@JWT_SECRET=$JWT_SECRET"
gcloud run services update bt-pricing-service --region "$REGION" --project "$PROJECT" \
  --update-env-vars "^@^JWT_SECRET=$JWT_SECRET@DIESEL_PRICE_INR=90"
```
`^@^` sets `@` as the delimiter so secret values containing commas are not mis-split.

> **Execution note:** an automated agent cannot run these — the harness (correctly) blocks prod Cloud
> Run mutations authorized only by a peer agent over IPC. A human/operator with `gcloud` (account
> `deltaos1997`, already authed on the infra box) runs the block above.

### 3.1 Full sets (safe fallback — merge is idempotent)

```bash
# cargo-ledger
gcloud run services update bt-cargo-ledger --region "$REGION" --project "$PROJECT" \
  --update-env-vars "BOOKING_SERVICE_URL=$BOOKING_URL,INTERNAL_SERVICE_SECRET=$INTERNAL_SERVICE_SECRET,REDIS_URL=$REDIS_URL,SUPABASE_URL=$SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY,BLOCKCHAIN_ENABLED=false"

# payment-service
gcloud run services update bt-payment-service --region "$REGION" --project "$PROJECT" \
  --update-env-vars "BOOKING_SERVICE_URL=$BOOKING_URL,INTERNAL_SERVICE_SECRET=$INTERNAL_SERVICE_SECRET,SUPABASE_URL=$SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY,JWT_SECRET=$JWT_SECRET"

# pricing-service
gcloud run services update bt-pricing-service --region "$REGION" --project "$PROJECT" \
  --update-env-vars "JWT_SECRET=$JWT_SECRET,DIESEL_PRICE_INR=90"
```

## 4. Verify (against the live target)

```bash
for s in bt-cargo-ledger bt-payment-service bt-pricing-service; do
  URL=$(gcloud run services describe "$s" --region "$REGION" --project "$PROJECT" --format='value(status.url)')
  echo -n "$s /health -> "; curl -s -o /dev/null -w "%{http_code}\n" "$URL/health"
  gcloud run services describe "$s" --region "$REGION" --project "$PROJECT" \
    --format='value(status.conditions[0].type, status.conditions[0].status)'
done
# PASS = each /health returns 200 and Ready=True. Then re-check the gateway routes for each.
```

## 4b. Ticket-vs-code discrepancies (flagged to cto)

- Ticket said **cargo** = `REDIS_URL, INTERNAL_SERVICE_SECRET, BOOKING_SERVICE_URL`. Code ALSO
  hard-requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (cargo throws in `supabase.ts`). Added.
- Ticket said **payment** = `JWT_SECRET, INTERNAL_SERVICE_SECRET, BOOKING_SERVICE_URL`. Code ALSO
  hard-requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. Added. (payment does NOT use Redis.)
- Ticket said **pricing** = `SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTERNAL_SERVICE_SECRET`.
  Code shows pricing reads **none** of those — its only env dep is `JWT_SECRET` (+ optional
  `DIESEL_PRICE_INR`). Runbook corrected to `JWT_SECRET`.

## 5. Which values need the founder

If every value in the §2 sanity check is non-empty, **nothing needs the founder** — all five shared
values (`INTERNAL_SERVICE_SECRET`, `JWT_SECRET`, `REDIS_URL`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`) copy from the healthy booking service, and `BOOKING_SERVICE_URL` is
derived from booking's Cloud Run URL. Founder input is needed ONLY if the sanity check reports a
value MISSING FROM BOOKING (i.e. it is stored in Secret Manager rather than plain env, or the
operator lacks read access). The secret-class vars that would then require the founder:
`INTERNAL_SERVICE_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`.

## 6. Migrations reconcile — `supabase/migrations` vs live DB (`rxbdzbcndpzznvqcbimg`)

Verified via live queries (object existence + `supabase_migrations.schema_migrations`):

| Repo file | Creates | Live DB | Status |
|---|---|---|---|
| `0009_location_history.sql` | `location_history` (+idx, RLS) | present | ✅ applied |
| `0010_pod_receipts.sql` | `bookings.receiver_email`, `pod_receipts` | present | ✅ applied |
| `0011_payments_payouts.sql` | `payments`, `payouts`, `booking_status='paid'` | present | ✅ applied |
| `0012_ops_overrides.sql` | `ops_overrides`, `user_role='admin'` | present | ✅ applied |
| `0013_add_booking_status_expired.sql` | `booking_status='expired'` | **ABSENT** | ❌ **NOT applied** |

Notes:
- The DB's migration tracking uses timestamped names; `0009–0012` were folded in via
  `20260709133648 reconcile_for_slice_demo_009_012`. `0013` has **no** tracking row and its enum
  value is missing live.
- **Impact:** any code writing `booking_status='expired'` (auction-expiry / the OTP_EXPIRED path
  from the recent commits) will error against prod until 0013 is applied.
- The repo README's planned baseline (Step 0 `supabase db pull`) + `0001–0007` efficiency
  migrations were never committed as files; they are a separate, still-open item (not part of the
  0009+ slice).

### 6.1 Fix for 0013 — NEEDS HUMAN AUTHORIZATION (prod DDL)

Idempotent, additive, forward-only. Applying prod schema DDL from an automated agent was (correctly)
blocked; an operator/founder must run it:

```sql
-- via Supabase SQL editor, or supabase migration up on the linked project
alter type booking_status add value if not exists 'expired';
```

Verify: `select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='booking_status' and e.enumlabel='expired';` returns a row.
