# Task: `feat/bt-app-pod-capture`

**Relates to:** `docs/ARCHITECTURE_UNIFIED_IDENTITY.md` **§6.3** (POD = OTP + evidence;
confirmed vs asserted proof), the memory note `bharattruck-unified-app-live-2026-08-08`
("Phase 3b — POD evidence-capture slice"), and the frozen backend from
`supabase/migrations/0025_pod_evidence.sql` (feat/pod-evidence, already merged +
**applied to prod**, verified 2026-08-08 via live introspection).

## What this branch adds

The **evidence-capture half** of POD in `bt-app`'s driver trip surface. Phase 3 (PR #103)
+ the OTP-entry fix (PR #104) already ship the **confirmed** tier — the receiver reads out
a code and the driver enters it to close the trip. This branch adds the layer that sits on
top of it (§6.3):

- **Camera evidence capture** (`POST /bookings/:id/pod-evidence`). A photo, taken with the
  device camera, **hashed on the device** (SHA-256 over the file's own bytes, Web Crypto),
  geo-stamped with the fix at capture, POSTed as **metadata only** — the bytes are never
  re-encoded and go to WORM storage separately (inert until the bucket is wired, so
  `storage_status: 'no_op'` today). Idempotent on (booking, hash).
- **Assert delivery** (`POST /bookings/:id/assert-delivery`) — the no-confirmation branch.
  When the receiver can't confirm (no smartphone, night drop, warehouse hand-off), the
  driver picks a typed reason and reports the delivery; the trip moves
  `in_transit → delivery_asserted` (ops closes it later, `pod_strength='asserted'`). The
  server **requires ≥1 captured photo first** and 400s otherwise — so the UI gates the
  action on evidence existing, rather than handing the driver a 400 (the founder's
  "don't half-wire" rule: assert-without-evidence must be impossible to trigger).
- **Discrepancy** (`POST /bookings/:id/discrepancy`) — a compact secondary form for
  shortage/damage. The driver reports ONLY the actual quantity (expected is server-held,
  §5.7); a captured photo is required.
- **POD ledger read** (`GET /bookings/:id/pod`) — loads any already-captured evidence so a
  reload shows prior captures, and surfaces proof strength.

No new migration (0025 is live). No backend change — this is pure frontend wiring to an
already-deployed, already-verified contract.

## Files

- `bt-app/src/lib/types.ts` — the POD-capture wire shapes, mirrored verbatim from
  `bt-booking-service/src/lib/pod/service.ts`.
- `bt-app/src/lib/api.ts` — `capturePodEvidence`, `assertDelivery`, `submitDiscrepancy`,
  `getPodRecord`.
- `bt-app/src/components/delivery-evidence.tsx` — the self-contained capture/assert/
  discrepancy card. Owns hashing, geolocation-at-capture, the evidence list, and both
  secondary actions. Never blanks: secure-context guard, geolocation fallback, clear
  errors on every failure path.
- `bt-app/src/app/(app)/my-trips/[id]/page.tsx` — renders the card in the `in_transit`
  branch (alongside the OTP flow, which stays the primary confirmed path) and in a new
  `delivery_asserted` branch (asserted banner + the ledger).

## Verification

- `bt-app  npm run build` → clean (tsc + next build).
- Live API smoke test through the gateway with a demo-driver token: `GET /bookings/:id/pod`
  and a `POST /bookings/:id/pod-evidence` (idempotent, non-destructive) against a
  demo-driver in-transit trip; confirm the deployed booking-service actually serves the
  routes (guards against a stale CD revision).
- Verification is **API contract + build**, NOT browser-automation UI checks (founder's
  explicit instruction).

## Out of scope

- The WORM bucket / real byte upload (`POD_EVIDENCE_GCS_BUCKET` unset → storage inert).
- Re-pointing the POD OTP at the consignee's phone (D-26, Twilio).
- Real camera-provenance enforcement (a native-app concern; `capture_method:'camera'` is
  the claim the contract records, and the DB CHECK is the enforceable half).
- The shipper-side `PATCH /expected-quantity` UI — the discrepancy flow reads whatever
  server-held expected quantity exists and is honest when there is none.
