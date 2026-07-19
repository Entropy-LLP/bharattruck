# Note for the pricing/payments owner

Quick handoff on `bt-payment-service` as of 2026-07-19, since you owned this before we merged your
work into the monorepo. Written by the tooling/infra pass, not to step on your design.

## Where it stands right now
- It is deployed to Cloud Run and returns 200 on `/health`. It runs a fresh image built from the
  current monorepo source (Artifact Registry tag `monorepo-fee1677`). The old pre-monorepo image is
  superseded.
- Same caveat as pricing: the Cloud Run env vars are currently blank (`SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `INTERNAL_SERVICE_SECRET`, `BOOKING_SERVICE_URL`).
  Health passes, but the settle-to-paid path and the payout record both need Supabase and the
  internal secret, so settlement will fail live until the env is set. The fix command is in
  `docs/SESSION_HANDOFF_2026-07-19.md`, section 3, and there is a GitHub issue tracking it.

## What would help from you
- Confirm the merged TypeScript settlement flow (cash-recorded settle marks the trip `paid` and
  records the driver payout through the idempotent outbox saga) matches your intent. Background is in
  `docs/PRICING_PAYMENTS_STATUS.md`, and the payout atomicity approach is documented there too.
- Escrow was cut from the first pass, so the Razorpay stubs were removed and the dep dropped. Note
  that the founder later put escrow back in scope, so if we build it, it is a fresh addition here, not
  a revert.

Not demo-blocking on its own, but settlement is non-functional live until the env is in place.
