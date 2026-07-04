# bt-booking-service — Development Roadmap

> **Part of [BharatTruck](https://github.com/CodeMongerrr/LogisticOS-pathway).** Owns **Load posting, Booking (auction + contract), Negotiation, trip lifecycle, and live GPS ingest** (PRD §5.2, §5.3, §6). Master PRD: `LogisticOS-pathway/docs/BHARATTRUCK_MVP_PRD.md`.
> **MVP deadline:** 31 Aug 2026 · **North Star:** Completed Paid Trips · _Living doc — update checkboxes as work lands._

**Role:** The marketplace core — a shipper posts a point-to-point FTL/LTL load; drivers bid (auction) or accept a direct contract; both sides negotiate; the trip runs through its lifecycle to paid.

**Status legend:** ✅ done · 🟡 partial · ⬜ to do · ⛔ stub · `(Wx-y)`/`(D-z)` tags = Entropy PMO work-item refs (auto-synced to the tracker — keep them on the line when you flip a checkbox)

---

## ✅ What's done
- ✅ Two booking modes in the data model: `direct` (1:1, optional `target_driver_id`) vs `auction` (1:many, `auction_deadline`, `min_acceptable`). (D-3)
- ✅ **Bilateral negotiation** — both shipper and driver can counter (`PATCH .../counter`); append-only `negotiations` table as immutable offer log. (D-4)
- ✅ **Blind auction** at the repository layer (drivers see only their own quote; shipper/admin see all).
- ✅ Optimistic-concurrency accept/award (conditional UPDATEs so only one racer wins). (D-5)
- ✅ Server-trusted identity (shipper_id/driver_id from JWT, never request body).
- ✅ **Redis GPS ingest:** `POST /location/update`, `GET /location/booking/:id` (30s TTL, driver↔booking index keys). (D-6)
- ✅ Quote uniqueness `UNIQUE(booking_id, driver_id)` → clean `DUPLICATE_QUOTE` 409.

## ⛔ Critical gaps (lifecycle is half-built)
- ⛔ **Lifecycle dead-ends at `accepted`** — `accepted→in_transit` and `in_transit→completed` are valid in `state.ts` but have **no endpoints**. The fulfillment half doesn't exist.
- ⛔ **No outbound calls** to pricing / payment / cargo-ledger (URLs declared, never used) — no quote-lock, no escrow release, no ledger write.
- ⛔ Notifications all stubbed (`jobs.ts`) — no SMS/push on new quote, counter, award, status.
- ⛔ Auctions never expire (`expireAuction()` stub; no `expired` status).

## ⬜ To do (MVP / P0)
- ⬜ **Pickup-confirm endpoint** (`accepted → in_transit`). (W3-1)
- ⬜ **Delivery endpoint** (`in_transit → completed`) triggered by **receiver POD-OTP** (see bt-cargo-ledger). (W3-2)
- ⬜ Auction **expiry job** + add `expired` to the status enum. (W3-3)
- ⬜ Enforce **5-round negotiation cap** + deadline expiry. (W3-4)
- ⬜ Wrap `awardBooking` (3 writes) in a transaction/RPC (currently risks partial state). (W3-5)
- ⬜ Wire integrations: on create → **pricing quote-lock**; on delivery → **payment release**; on checkpoint/delivery → **cargo-ledger**. (W3-6)
- ⬜ Real notifications via MSG91 / push (BullMQ workers).
- ⬜ Enforce cancellation window (only before `in_transit`; README's "2h before pickup" rule unenforced). (W3-7)
- ⬜ Persist GPS **breadcrumbs** (currently Redis-only, 30s TTL — no audit trail); idempotency/rate-limit on `/location/update`. (W5-1)
- ⬜ **Commit DB migrations** (new bookings columns, quotes, negotiations) — currently only a comment block in `quote-repository.ts`. (W1-3)
- ⬜ Sync README/API contract with code (lifecycle names, location body shape).

## 🔮 Deferred / out of MVP
- WebSocket live tracking + Redis-geo automated driver-matching (shippers poll for MVP).
- Multi-pickup/multi-drop, partial delivery, mid-trip price changes (booked price is final).
- Blockchain anchoring of the AWARDED event (handled in bt-cargo-ledger instead).

## 🎯 Definition of done (this service)
Shipper posts a point-to-point FTL/LTL load → ≥2 drivers bid (or a direct contract is sent) → negotiation respects 5-round cap + deadline → shipper picks → trip progresses `accepted → in_transit → completed → paid`, with pricing/payment/ledger wired in.

_Last updated: 2026-07-01_
