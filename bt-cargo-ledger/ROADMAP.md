# bt-cargo-ledger — Development Roadmap

> **Part of [BharatTruck](https://github.com/CodeMongerrr/LogisticOS-pathway).** Owns **Proof of Delivery, Checkpoints & the tamper-evident Cargo Ledger** (PRD §5.7). Master PRD: `LogisticOS-pathway/docs/BHARATTRUCK_MVP_PRD.md`.
> **MVP deadline:** 31 Aug 2026 · **North Star:** Completed Paid Trips · _Living doc — update checkboxes as work lands._

**Role:** Make delivery and chain-of-custody **tamper-evident and trip-closing**. This is the legal/trust backbone — **kept in MVP** (on-chain anchoring stays real). Receiver-OTP closes the trip; every checkpoint photo is hashed and anchored.

**Status legend:** ✅ done · 🟡 partial · ⬜ to do · ⛔ stub · `(Wx-y)`/`(D-z)` tags = Entropy PMO work-item refs (auto-synced to the tracker — keep them on the line when you flip a checkbox)

---

## ✅ What's done
- ✅ SHA-256 canonical-JSON leaf hashing + **Merkle tree** in-process (Node crypto). (D-7)
- ✅ Typed checkpoints modeled: `pickup / handoff / waypoint / delivery` with party-handoff fields (`outgoing_driver_id`, `incoming_party_id`).
- ✅ Route shapes for recording checkpoints + a `/proof` endpoint.
- ✅ Two-phase design: Phase-1 Merkle root in DB, Phase-2 on-chain anchor (gated by `BLOCKCHAIN_ENABLED`).

## ⛔ Stubbed / missing
- ⛔ **No persistence** — checkpoints/shipments/hashes never saved; no ledger exists between requests.
- ⛔ Merkle root computed over a stub single-element array (not real checkpoint set).
- ⛔ `GET /shipments/:id/proof` returns placeholder — can't recompute/verify a root.
- ⛔ **No chain write** — `writeHashToChain` is a console.log/throw stub; ethers.js not installed.
- ⛔ No photo/EXIF storage; `photo_urls` accepted but discarded.
- ⛔ Not called by bt-booking-service (integration is config/docs only); no auth.

## ⬜ To do (MVP / P0)
- ⬜ **Persist** checkpoints + shipments (Supabase); assemble the real Merkle tree per shipment. (W6-1)
- ⬜ **Checkpoint capture:** photo upload + **EXIF GPS extraction** → store in the **data sink** (R2 / Supabase Storage). (W6-2)
- ⬜ **Receiver-email OTP flow:** OTP sent to the receiver's email (receiver ≠ shipper, no account); entering the correct OTP **closes the trip** (`in_transit → completed`) and triggers payout. (W6-3)
- ⬜ **On-chain anchoring** (your home turf): install ethers, fund wallet/RPC, write per-checkpoint/POD hash (or Merkle root) on the chosen chain (Polygon design). Decide: per-checkpoint vs one root per shipment. (W6-5)
- ⬜ **Per-order ledger** clubbed to the booking = the legal record.
- ⬜ `/proof` endpoint that recomputes the root and verifies against the on-chain anchor. (W6-6)
- ⬜ Wire bt-booking-service: `POST /shipments` on booking create; checkpoints during trip; delivery finalize. (W6-4)
- ⬜ Auth on all endpoints.

## 🔮 Deferred / out of MVP
- Multi-leg handoff chains beyond point-to-point (typed checkpoints exist but MVP is single pickup→drop).

## 🔑 External dependencies / data
- Object storage bucket (R2 / Supabase Storage) for checkpoint photos (the data sink).
- Chain RPC endpoint + funded wallet (Polygon or chosen chain) for anchoring.

## 🎯 Definition of done (this service)
Delivery completes only when the receiver enters the emailed OTP; each checkpoint photo is stored with its GPS EXIF; each checkpoint/POD hash is anchored on-chain; the per-order `/proof` returns a verifiable chain-of-custody.

_Last updated: 2026-07-01_
