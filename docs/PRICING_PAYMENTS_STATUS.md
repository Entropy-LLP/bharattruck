# Pricing & Payments — Status (for the pricing/payments coder)

> Keep this current. Purpose: the coder who owned `bt-pricing-service` + `bt-payment-service` must know
> everything happening on those two services. Updated 2026-07-15 by the CTO node.

## Decision of record
- The **TypeScript** `bt-pricing-service` and `bt-payment-service` are the **MVP anchor** and what
  deploys to Cloud Run (Node). The **Python** engines (`feat/python-engines`: LinUCB RL pricing +
  Razorpay/escrow FastAPI) stay **quarantined** — they must NOT re-enter the Node deploy (they'd break
  it: second runtime + second DB). They remain the seed for post-feasibility (RL behind `PRICING_MODE=ml`;
  escrow when it gains real payout+auth+schema).
- Founder call (2026-07-12): **pilot = cash-recorded payments + deterministic pricing** (escrow + RL are
  IN the PRD v3.1 but deferred). Reconfirmed.

## Pricing — what changed (live on `main` @ a24401f)
- **Quote-lock added** (migration `0013_price_quotes`, APPLIED): `POST /pricing/quote` now derives
  distance server-side from coords (haversine ×1.3, no maps key — server key stays in tracking),
  persists a `price_quotes` row, returns `quote_id`. Internal `GET /pricing… /internal/quote/:id` +
  `/consume` (INTERNAL_SERVICE_SECRET, constant-time). `bt-booking-service` create now **binds** the
  booking's route+weight+load+vehicle_type to the locked quote (shown price == charged price).
- Service now mounts under `/pricing` (was root) so the gateway `/api/pricing/*` resolves.
- Placeholder cost constants NOT yet harvested from `cto_data.py` (open PRD item; RL still deferred).

## Payments — what changed
- **Cash-recorded settle** is the pilot path: `POST /payments/settle {booking_id,amount,mode}` →
  records + calls booking internal `mark-paid` → `completed→paid`. `GET /payments/status/:id`.
  Outbox saga `/internal/trip-completed` pre-creates a payout row. **No Razorpay/escrow yet.**
- `payment/.env.example` is stale (dead `RAZORPAY_*`; missing `JWT_SECRET`/`INTERNAL_SERVICE_SECRET`/
  `BOOKING_SERVICE_URL`) — cleanup queued.

## Open / coming
- Wave-2: pricing constant-harvest; escrow (self-custody TS mode) + RL — only when the founder provides
  Razorpay/Surepass and re-prioritizes. Any change to these two services will be flagged here + via PR.
