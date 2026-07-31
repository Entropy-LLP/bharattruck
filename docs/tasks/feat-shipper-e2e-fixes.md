# feat/shipper-e2e-fixes

**Status:** in review · **Opened:** 2026-07-31 · **Delete this file on merge.**

## Why

A fleet owner bid on a shipper's auction booking and the shipper's booking page
went white:

```
Uncaught TypeError: Cannot read properties of null (reading 'slice')
```

`shipper/src/app/bookings/[id]/page.tsx` read `quote.driver_id.slice(0, 8)` to
label a bid. Migration 016 made `quotes.driver_id` nullable and added
`fleet_owner_id` under `num_nonnulls(driver_id, fleet_owner_id) = 1`, so a fleet
bid leaves `driver_id` NULL. Reproduced against the live gateway before any
change — `GET /bookings/9748a23b…/quotes` returns `driver_id: null` with
`fleet_owner_id` set.

## What changed

| Area | Change |
|---|---|
| `bt-booking-service` | `listQuotesForBooking` resolves the bidding party in the same embedded read and returns it as `carrier` (`kind` + `name` + truck/rating for a solo driver). New `QuoteCarrier` / `QuoteWithCarrier` types. |
| `shipper` types | `Quote.driver_id` is nullable (it always was on the wire); added `fleet_owner_id`, `carrier`. `Booking` gains `fleet_owner_id`/`vehicle_id`. `NegotiationEntry.actor_role` gains `'fleet_owner'`. |
| Booking page | Renders the carrier name instead of a uuid prefix. Kind falls back to the id columns when `carrier` is absent (the app-ships-first deploy window). |
| Negotiation history | Was labelling every non-shipper message "Driver" — a fleet's counter-offer was misattributed. Now mapped by `actor_role`. |
| Trip panel | An accepted fleet booking keeps `driver_id` NULL until the owner pairs a truck in bt-fleet-service, but the panel announced "Driver Assigned". Now "Carrier Booked" / "Awaiting Truck" until a driver exists. |

## Verification

- `bt-booking-service`: 205 checks green across 10 files, incl. new
  `test/quote-carrier.unit.mts` (17 checks — the crashing fleet bid, solo
  drivers, unnamed driver, deleted party row, PostgREST numeric-as-string).
- PostgREST embed proven against the live DB: the three FK hints resolve
  (HTTP 200); a deliberately bogus hint returns `PGRST200`.
- Browser QA against a mock replaying the captured live payload (the live
  gateway sends no `Access-Control-Allow-Origin`, so local dev cannot reach it —
  BIBLE §6.3). Four carrier shapes, the old-backend payload with no `carrier`
  key, fleet-accepted, and solo-accepted all render with zero console errors.

## Not covered here

The shipper still has no "who is carrying this load" panel once a booking is
awarded — the carrier is visible only in the quotes list. Worth a follow-up.
