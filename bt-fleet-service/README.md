# bt-fleet-service

The fleet-owner persona. Port **3007**; gateway rewrite `/api/fleet/(.*)` → `/fleet/$1`.

Contract: `docs/tasks/feat-fleet-owner.md`. Schema: migrations `0014`–`0018`.
Where this README and the live database disagree, **the database wins**.

## What it owns

| Concern | Tables |
|---|---|
| The fleet party | `fleet_owners` |
| Roster (invite → accept) | `fleet_drivers` |
| Trucks + per-asset records | `vehicles` (fleet-owned rows), `vehicle_finance`, `vehicle_permits`, `vehicle_lanes` |
| Driver ↔ truck pairing per trip | `vehicle_assignments`, `bookings.driver_id` / `.vehicle_id` |
| Per-trip P&L roll-up | `trip_economics` (reads `vehicle_cost_norms`, `vehicle_service_cost_by_age`, `fleet_cost_settings`) |

It does **not** own GPS ingestion (that stays in `bt-booking-service`), the auction,
payouts, or anything Google-Maps-backed.

## The three rules a change here must not break

1. **Tenant isolation.** Every owner-scoped route starts with `requireFleetOwner(req.user)`
   and scopes every query by the `fleet_owner_id` it returns. A `fleet_owner_id` in a
   request body is never read. The two `/fleet/drivers/invites/*` routes are the mirror
   image: `requireDriver`, unreachable with an owner token.
2. **Identity.** The JWT's `userId` is `users.id`. `drivers.id` and `fleet_owners.id`
   are different rows. `bookings.driver_id`, `vehicle_assignments.driver_id` and the
   Redis `loc:driver:*` keys all mean `drivers.id`.
3. **`GET /fleet/live` must not fan out.** One `SMEMBERS fleet:{id}:drivers`, one `MGET`
   over `loc:driver:{id}`. At 1000 trucks on a 10s poll, a per-driver loop is 100 req/s.
   Route and ETA stay lazy — one selected vehicle at a time, from `bt-tracking-service`.

## Analytics read `trip_economics` and nothing else

`POST /internal/trip-economics/:bookingId` (internal-secret gated, fired by
`bt-payment-service` on `completed→paid`) is the ONLY place `bookings`, `payouts`,
`trip_expenses` and `location_history` are aggregated. It is idempotent on
`booking_id`, releases the vehicle assignment, and redistributes the driver's wage
across that calendar month. Dashboards then read one small table.

The P&L formulas are in `src/lib/economics.ts`; `computeTripEconomics()` is pure and
covered by `test/economics.test.mts` against the seeded norms.

## Known boundary

`POST /fleet/vehicles/bulk` implements CSV for real. `xlsx`, `pdf` and `image` return
a `501 NOT_IMPLEMENTED` naming the missing OCR/document parser (founder-authorised,
Q19) rather than importing nothing silently.

## Run

```sh
cp .env.example .env      # JWT_SECRET, SUPABASE_*, REDIS_URL, INTERNAL_SERVICE_SECRET
npm install
npm run dev               # or: npm run build && npm start
npm test                  # P&L model vs the seeded cost norms
```
