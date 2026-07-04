# bt-payment-service — Development Roadmap

> **Part of [BharatTruck](https://github.com/CodeMongerrr/LogisticOS-pathway).** Owns **Payments, Escrow & Settlement** (PRD §5.5 + Pricing/Escrow blueprint v1.1 Module 9). Master PRD: `LogisticOS-pathway/docs/BHARATTRUCK_MVP_PRD.md`.
> **MVP deadline:** 31 Aug 2026 · **North Star:** Completed Paid Trips · _Living doc — update checkboxes as work lands._

**Role:** Move money for a real trip — multi-mode (escrow / direct / cash), with a milestone payout split that insulates the owner-operator from cash-flow defaults.

**Status legend:** ✅ done · 🟡 partial · ⬜ to do · ⛔ stub · `(Wx-y)`/`(D-z)` tags = Entropy PMO work-item refs (auto-synced to the tracker — keep them on the line when you flip a checkbox)

---

## ⛔ Current state — STUB (no real money movement)
- ✅ Fastify boots, `/health` works, route scaffolds with Zod shapes exist.
- ⛔ `razorpay` package is in `package.json` but **imported nowhere**; keys read nowhere.
- ⛔ `POST /payments/order` returns hardcoded `rzp_stub_order_id`.
- ⛔ `POST /payments/release` returns `{status:'payout_initiated', note:'Sprint 7'}` — no real payout.
- ⛔ Webhook only logs body — **no `X-Razorpay-Signature` HMAC verification**.
- ⛔ No persistence, no escrow state machine, no refund route, no auth on endpoints.

## ⬜ To do (MVP / P0 — the Milestone Payout Split pipeline)
- ⬜ **First-stage escrow lock:** at order confirmation, lock **100% of Gross Quoted Freight** into a virtual account via **Razorpay Smart Collect**. (W6-7)
- ⬜ **20–30% UPI advance split:** on successful escrow capture (webhook), dispatch upfront fuel/driver opex to the carrier's UPI handle. Config `advance_payout_ratio` ∈ [0.20, 0.30]. (W6-10)
- ⬜ **Balance payout on POD:** when delivery is verified (signed LR photo / receiver OTP via bt-cargo-ledger), release the remaining escrow balance to the operator. (W6-11)
- ⬜ **GST + 2% TDS** in settlement math: GTA 5% no-ITC / 12% with-ITC; retain 2% TDS (Sec 194C). Track `tds_deduction_amount_inr`.
- ⬜ **Escrow state machine:** `PENDING → FUNDS_LOCKED → ADVANCE_RELEASED → FULLY_SETTLED` per booking (`escrow_status`). (W6-9)
- ⬜ Real Razorpay: order create, **webhook HMAC verification + idempotency**, capture, **RazorpayX payout**, refund. (W6-8)
- ⬜ Persistence (Supabase) of payment/escrow/payout rows; auth on money endpoints. (W6-12)
- ⬜ Other modes: **direct** + **cash** (recorded off-platform).
- ⬜ **Detention** charge per hour (delay beyond pickup/drop window). (W6-18)
- ⬜ Refund route: full before pickup, partial after. (W6-13)
- ⬜ GATE before the advance split: confirm a pre-POD advance is a permitted RBI PA-MD escrow debit; else Plan B (NBFC advance) / Plan C (shipper pays advance direct). (W6-19)

## 🔮 Deferred / out of MVP
- TReDS financing / working-capital credit (Module 9 depth) — Phase 1-2.
- Full RBI PA/escrow legal compliance — **explicitly deferred for the feasibility test** (prefer Razorpay-held custody / Route over self-custody; tiny volumes).

## 🔑 External dependencies (lead-time risk — start now)
- **Registered entity** (Pvt Ltd + GST + bank) for merchant onboarding.
- **Razorpay** merchant account + **Smart Collect** + **RazorpayX** payout activation (business verification can take days–weeks).

## 🎯 Definition of done (this service)
For at least **escrow** mode: shipper funds a booking → 100% locked → 20–30% UPI advance auto-released to carrier → on POD the balance pays out (minus GST/TDS) → state reaches `FULLY_SETTLED`. Cash/direct modes recorded correctly. Webhooks HMAC-verified + idempotent.

_Last updated: 2026-07-01_
