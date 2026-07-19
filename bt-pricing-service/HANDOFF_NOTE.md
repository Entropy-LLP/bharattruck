# Note for the pricing/payments owner

Quick handoff on `bt-pricing-service` as of 2026-07-19, since you owned this before we merged your
work into the monorepo as TypeScript. Written by the tooling/infra pass, not to step on your design.

## Where it stands right now
- It is deployed to Cloud Run and returns 200 on `/health`. It runs a fresh image built from the
  current monorepo source (Artifact Registry tag `monorepo-fee1677`). The old pre-monorepo image it
  was running before has been superseded.
- One thing to know: the Cloud Run env vars on this service are currently blank (`JWT_SECRET`,
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INTERNAL_SERVICE_SECRET`). Health passes because none
  of those are read at boot, but the real quote-lock path (the part that hits Supabase and checks the
  internal secret) will fail until they are populated. There is a one-shot command that copies them
  from the healthy `bt-booking-service` in `docs/SESSION_HANDOFF_2026-07-19.md`, section 3. A GitHub
  issue is open for this so it does not get lost.

## What would help from you
- Sanity check that the merged TypeScript cost-breakdown matches what your Python engine was doing.
  The mapping and current status are in `docs/PRICING_PAYMENTS_STATUS.md`.
- Your original Python engines are parked on the `feat/python-engines` branch, quarantined so they do
  not break the Node deploy. If any of that logic needs to come back, it has to be ported into this TS
  service, not merged as Python.

Nothing here is urgent to the point of blocking a demo, but the env gap does make live quotes
non-functional, so it is worth doing before anyone tests pricing end to end.
