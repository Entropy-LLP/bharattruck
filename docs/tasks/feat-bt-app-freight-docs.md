# Task: `feat/bt-app-freight-docs`

**Relates to:** `docs/ARCHITECTURE_UNIFIED_IDENTITY.md §6.4` (documents), `INDIA_FREIGHT_COMPLIANCE.md`
(the LR / invoice / e-way-bill rules), and the memory note `bharattruck-unified-app-live-2026-08-08`
("Phase 4 — in-app document surfaces (LR/invoice/e-way-bill)"). Wires the live migration-0024
backend (`document_series`, `lorry_receipts`, `freight_invoices`, `eway_bill_records`), verified
applied to prod 2026-08-08.

## What this branch adds

The first **in-app freight-documents surface**, on the driver/carrier trip screen:

- **Read** (`GET /bookings/:id/documents`) — a "Freight documents" card that shows what's on file:
  the consignment note (LR), the shipper's tax invoice, and the recorded e-way bill(s) with their
  **standing** and **expiry** status. Relation-gated server-side (shipper / carrier / driver / ops).
- **Issue LR** (`POST /bookings/:id/documents/lr`) — the CARRIER raises the consignment note,
  **prefilled from the booking** (consignor/consignee, origin/dest, weight, description, freight
  charge) so the driver confirms rather than re-types. The issuer identity is derived server-side
  from the booking + actor and is never sent (red line 1, §1.3). Idempotent per booking (a repeat
  returns the LR already issued rather than burning a second serial); issuable only while the
  booking is `accepted` or `in_transit`.

The card sits at the trip-page level (not inside the in_transit-only section), so it is visible
across `accepted` / `in_transit` / `delivery_asserted` / `completed`. No new migration, no backend
change — pure frontend wiring to an already-deployed, already-verified contract.

## Files

- `bt-app/src/lib/types.ts` — `BookingDocuments`, `LorryReceipt`, `FreightInvoice`,
  `EwayBillRecord`, `EwayBillExpiry`, `IssueLorryReceiptInput` — mirrored from
  `bt-booking-service/src/lib/documents/{service,repository,rules}.ts`.
- `bt-app/src/lib/api.ts` — `getBookingDocuments`, `issueLorryReceipt`.
- `bt-app/src/components/freight-documents.tsx` — the self-contained card (read + carrier LR issue).
  Never blanks: loading / error / empty / content, and a clear message on every failure path.
- `bt-app/src/app/(app)/my-trips/[id]/page.tsx` — renders it for non-cancelled bookings.

## Out of scope (follow-up slices)

- Shipper **invoice** issuance UI (`POST /documents/invoice`) and the shipper load-detail read view.
- **E-way bill** record + status UI (`POST /documents/eway-bill`, `PATCH …/:ewbNumber`).
- PDF rendering / download of a document (the rows carry the data; a printable view is separate).

## Verification

- `bt-app npm run build` → clean (tsc + next build).
- Live smoke test through the gateway with a demo-driver token: `GET /documents` (confirmed
  deployed + gateway-routed, returns the empty shape for a booking with none), and a NON-mutating
  guard probe of `POST /documents/lr` (invalid body → 400 before any serial is allocated) to prove
  the route is deployed and validates — WITHOUT burning a non-voidable statutory serial on demo
  data. The happy path is covered by build + the read contract.
- API-contract + build verification, not browser-automation UI checks (founder's rule).
