# bt-ops-web — Development Roadmap

> **Part of [BharatTruck](https://github.com/CodeMongerrr/LogisticOS-pathway).** Owns the **Ops Console** (PRD §5.8, §6.3). Master PRD: `LogisticOS-pathway/docs/BHARATTRUCK_MVP_PRD.md`.
> **MVP deadline:** 31 Aug 2026 · **North Star:** Completed Paid Trips · _Living doc — update checkboxes as work lands._

**Role:** One operator, one web console, total visibility across all drivers/fleets/trips. Touches the flow only on exceptions (KYC approval, disputes, manual overrides). Self-serve everywhere else.

**Status legend:** ✅ done · 🟡 partial · ⬜ to do · ⛔ stub · `(Wx-y)`/`(D-z)` tags = Entropy PMO work-item refs (auto-synced to the tracker — keep them on the line when you flip a checkbox)

---

## ✅ What's done
- ✅ Next.js App Router shell serving **both** `/ops/*` (internal) and `/portal/*` (fleet-owner) from one codebase (shared sidebar switched by role prop).
- ✅ Screens render: ops dashboard, KYC queue, live trips, portal dashboard.
- ✅ Dark-first theming (next-themes), brand styling; theme toggle works.

## ⛔ Stubbed (biggest blockers)
- ⛔ **Fake login** — form GETs to `/ops/dashboard`; no credential check, no token/session, **no auth boundary or RBAC**. Anyone hitting `/ops/*` or `/portal/*` has full access.
- ⛔ **All data is mock** — no fetch/API/server actions anywhere; ops sees fictional trips/users/GMV.
- ⛔ KYC approve/reject buttons inert; status tabs inert.
- ⛔ Live trips = static SVG placeholder; Call/Flag/Track buttons inert.
- ⛔ No Users / Disputes / Vehicles / Drivers screens (sidebar links 404).
- ⛔ Portal hardcoded to one fleet ("Surya Fleet") — no tenant scoping.

## ⬜ To do (MVP / P0)
- ⬜ **Real auth + RBAC** (ops staff only) — middleware/route guards; separate the internal console from the external portal boundary. (W1-4)
- ⬜ **BFF/proxy layer** to the backend services (replace all mock data with real calls). (W2-10)
- ⬜ **KYC approval queue** with real handlers: see SurePass + Vahan results, approve/reject, issue **Verified** badge. (W2-9)
- ⬜ **Live trip board:** every in-progress trip with live position / status / ETA / halts (fed by bt-tracking-service). (W8-2)
- ⬜ **Users / Fleets / Trucks** management: search, view, suspend; show fleet→driver→truck affiliations. (W2-11)
- ⬜ **Exceptions / disputes view:** open a trip's full state (negotiation log + GPS trail + checkpoints + ledger + payment) and **manually override** — reassign on no-show/breakdown, trigger refund, force payout, edit a stuck booking.
- ⬜ Tenant scoping for the fleet portal (fleet identity from auth).
- ⬜ Fix standalone build (Dockerfile references missing `output:'standalone'`).

## ⬜ To do (P1)
- ⬜ Audit trail (who approved/overrode what); notifications inbox; pagination/search/empty-states.

## 🔮 Deferred / out of MVP
- Analytics dashboards, multi-operator roles, advanced reporting.

## 🎯 Definition of done (this service)
Ops can log in (real auth), **approve a real KYC**, watch a **real live trip**, and **manually intervene** (reassign / refund / force-complete) on a stuck trip — all against real platform data.

_Last updated: 2026-07-01_
