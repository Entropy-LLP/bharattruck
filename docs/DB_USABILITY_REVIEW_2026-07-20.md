# DB + usability review (2026-07-20)

Read-only review of the live Supabase schema (`rxbdzbcndpzznvqcbimg`) and the app code, covering
useless tables, misconfiguration, and usability. Nothing here was changed, these are findings.

## 1. Dead tables (zero code references, safe to drop after a glance)

These tables exist in the DB but are referenced nowhere in `bt-*` code or migrations, and are empty.
They look like leftovers from an early, over-broad schema draft:

`trips`, `trip_locations`, `trip_events`, `trip_documents`, `trip_expenses`, `booking_responses`,
`saved_lanes`, `driver_reviews`, `support_tickets`, `eway_bills`, `fuel_estimates`, `messages`,
`user_settings`, `kyc_documents`.

Notable redundancy: the whole `trip*` family duplicates concepts that are actually implemented as
`bookings` + `location_history`, and `booking_responses` duplicates `quotes`. Recommend dropping
these to cut schema noise (confirm nothing external reads them first). This is a `DROP TABLE`, a
prod DDL change, so it needs the founder or an allow-rule, not the agent.

## 2. PostGIS artifact vs the "no PostGIS" decision

`spatial_ref_sys` is present, which is a PostGIS table. The frozen decision is no PostGIS, and
lat/lng are plain `numeric`/`double precision` columns (confirmed), so PostGIS is not actually used.
Either the extension was enabled and abandoned or it is a template leftover. If nothing uses it,
`DROP EXTENSION postgis` cleans it up. Low priority, but it contradicts a frozen contract.

## 3. Empty but legitimately planned (keep, do not drop)

These are empty only because the feature is built-but-not-exercised or built-on-a-branch:
- `payments`, `payouts`, `pod_receipts`: the money and POD path (built in payment/cargo services,
  just not run end to end yet).
- `vehicles`, `driver_licenses`, `driver_insurance`, `bank_accounts`: the driver onboarding wizard.
  Empty because the wizard is not linked in the live app (see usability #2). `feat/driver-onboarding-live-rebased` wires it in.
- `price_quotes`: the pricing quote-lock table.
- `notifications`, `route_alerts`: partially referenced, feature not finished.

## 4. Shared database with a second product (architectural risk)

The `pmo_*` tables (`pmo_activity` ~406 rows, `pmo_items`, `pmo_projects`, etc.) belong to a separate
PMO app living in the same database. That means the two apps share one blast radius: a bad migration,
a `DELETE` without a `WHERE`, a restore, or a connection-limit spike on one affects the other. It is
survivable with strict discipline (additive-only, never touch `pmo_*`), but long term these should be
in separate schemas at least, ideally separate databases. Flagging so it is a conscious choice, not
an accident. Every seed/cleanup script in this repo must scope its deletes to BharatTruck tables only.

## 5. RLS is enabled everywhere but unpoliced on most tables

Every BharatTruck table has row-level security enabled, but policy coverage is uneven:
- `bookings` has 6 policies, `users` and `drivers` have 2 each.
- `quotes`, `negotiations`, `location_history`, `payments`, `payouts`, `pod_receipts`, `ops_overrides`
  have RLS on with **zero policies**.

This is not a live hole, because the backend services connect with the `service_role` key, which
bypasses RLS entirely. That is exactly the point worth deciding: the real access boundary is the
app + JWT layer, not RLS. So either (a) accept that and document RLS as not-the-boundary (and stop
half-writing policies), or (b) actually finish policies on every table. The current middle state
looks protective but is not, and it will bite the day anyone points the anon/publishable key at the
DB directly from a client.

## 6. Minor schema-config nits

- `negotiations.booking_id` and `negotiations.quote_id` have **no index**, even though negotiation
  history is fetched by both. Small now, but it is the per-booking chat that grows. Add two indexes.
- `quotes.status` is free `text` with no check constraint, while `bookings.status` is a proper enum.
  A bad status value can slip in. Either make it an enum or add a `CHECK`.

## 7. Usability (code review)

1. **Direct bookings are invisible to the assigned driver (highest impact).** The whole driver flow
   is quote-based: Browse lists open loads, My Quotes lists your bids, and the booking detail page
   (`driver/src/app/(app)/bookings/[id]/page.tsx`) decides what to render from whether you have a
   quote (`myQuote ? QuoteStatusSection : SubmitQuoteForm`). A direct booking assigned straight to a
   driver has no quote row, so: it never appears in any list, and opening it by URL shows the
   "Submit Your Quote" form instead of the active trip. Confirmed live on the seed booking. Fix:
   render the active-trip section for any booking where `booking.driver_id` is you and status is
   accepted/in_transit, independent of a quote, and add a driver-side "My Trips" list for assigned
   work.
2. **Driver onboarding wizard is orphaned.** `driver/src/app/onboarding/*` (personal, vehicle,
   license, insurance, bank-account, review) is built and renders, but nothing links to it. Post-login
   goes to `/available`, and the bottom nav is only Browse/My Quotes/Profile. The reachable Profile
   is a shallower form. Net: a real driver cannot enter insurance or bank details, which the payout
   path needs. `feat/driver-onboarding-live-rebased` fixes it, not yet merged.
3. **Shipper map degraded only on a missing key, not an invalid one** (fixed the key this session;
   the graceful-fallback gap in `LiveTrackMap` is still worth a follow-up so an invalid key shows the
   app's own placeholder instead of Google's error modal).
4. **Shipper Quotes panel on direct bookings** (fixed this session, gated on `booking_type`).

## Priority

1. Direct-booking driver flow (#7.1) - breaks the flow you care about most.
2. Finish/merge driver onboarding (#7.2).
3. Decide the RLS story (#5) - security clarity.
4. Drop dead tables + PostGIS (#1, #2) - hygiene.
5. negotiations indexes + quotes.status constraint (#6) - quick wins.
