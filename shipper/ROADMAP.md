# Shipper App (bt-shipper-app) — Development Roadmap

> **Part of [BharatTruck](https://github.com/CodeMongerrr/LogisticOS-pathway).** The **Shipper** PWA (PRD §6.1). Master PRD: `LogisticOS-pathway/docs/BHARATTRUCK_MVP_PRD.md`.
> **MVP deadline:** 31 Aug 2026 · **North Star:** Completed Paid Trips · _Living doc — update checkboxes as work lands._

**Role:** The demand side — an SME posts point-to-point FTL/LTL loads, runs auctions or direct contracts, negotiates, pays, and **watches the truck live on a map**. Promise = transparency & trust.

**Status legend:** ✅ done · 🟡 partial · ⬜ to do · ⛔ broken · `(Wx-y)`/`(D-z)` tags = Entropy PMO work-item refs (auto-synced to the tracker — keep them on the line when you flip a checkbox)

---

## ✅ What's done
- ✅ Login (JWT access+refresh, refresh mutex, 401 retry), auth/callback (magic link).
- ✅ Dashboard, new booking, booking detail with **negotiation UI** (`CounterModal`, `NegotiationHistory`). (D-10)
- ✅ Auction (open, optional deadline) vs Direct (target driver UUID) creation; accept/counter/reject with persisted history.
- ✅ Lifecycle states wired in UI: `pending → negotiating → accepted → in_transit → completed → paid` (+ cancelled).

## ⛔ Broken / in-progress
- ⛔ **`next build` fails** — `bookings/[id]/page.tsx` imports `getRoute`/`RouteData` (not exported) + `LiveTrackMap` (no `components/maps/`); `maps-test/` imports `@/lib/maps` (missing). The journey breaks at the **booking-detail** screen.
- ⛔ Payments are **trust-based** — disabled "Coming Soon" card + manual "Mark as Paid" (no real money).
- 🟡 New Booking requires hand-typed **raw lat/lng** + pasting a **driver UUID** (no geocoding/driver picker).

## ⬜ To do (MVP / P0)
- ⬜ **Fix the build:** create `@/lib/maps` + `<LiveTrackMap>` (from bt-tracking-service work) so booking-detail/tracking render. (W1-1)
- ⬜ **Live tracking map:** moving truck marker + route polyline + ETA + **>1hr halt** indicator (reads tracking endpoints). (W5-4)
- ⬜ **Real payments:** replace "Mark as Paid" with escrow/direct/cash via bt-payment-service. (W6-14)
- ⬜ **Geocoding/address autocomplete** for pickup/drop + a **driver picker** for direct contracts (replace raw lat/lng + UUID paste). (W3-8)
- ⬜ Show **driver/fleet identity** on quotes (Verified badge, trips-completed, vehicle) — currently only an 8-char id prefix. (W3-10)
- ⬜ Full **load form** fields (material type, weight basis, truck type, pickup schedule, auction end, e-way bill optional) + saved/secure per-user data (addresses, templates). (W3-9)
- ⬜ Dashboard: poll `negotiating/accepted` states (counters currently don't appear without reload); filter/sort/search. (W3-11)
- ⬜ Receiver-OTP delivery confirmation surfacing; trip timeline.

## ⬜ To do (P1)
- ⬜ PWA manifest + service worker + push notifications (new quote / status / payment).

## 🔮 Deferred / out of MVP
- Multi-pickup/drop, partial delivery, ratings for drivers, intracity loads.

## 🎯 Definition of done (this app)
A shipper posts a point-to-point load → receives auction bids / sends a direct contract → negotiates → picks a winner → funds the trip → **watches the truck live on a map** with halt/checkpoint signals → trip closes on receiver OTP → settlement recorded.

_Last updated: 2026-07-01_
