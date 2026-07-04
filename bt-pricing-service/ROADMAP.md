# bt-pricing-service — Development Roadmap

> **Part of [BharatTruck](https://github.com/CodeMongerrr/LogisticOS-pathway).** Owns **Pricing** (PRD §5.4 + Appendix A; Pricing/Costing blueprint v1.1). Master PRD: `LogisticOS-pathway/docs/BHARATTRUCK_MVP_PRD.md`.
> **MVP deadline:** 31 Aug 2026 · **North Star:** Completed Paid Trips · _Living doc — update checkboxes as work lands._

**Role:** Given load parameters → return a **price with a transparent breakdown** (fuel / driver / per-km / handling), plus a demand-aware dynamic quote where data permits. The CTO cost-engine is the MVP anchor; LinUCB is the dynamic layer.

**Status legend:** ✅ done · 🟡 partial · ⬜ to do · ⛔ stub · `(Wx-y)`/`(D-z)` tags = Entropy PMO work-item refs (auto-synced to the tracker — keep them on the line when you flip a checkbox)

---

## ✅ What's done (current placeholder service — TS/Fastify)
- ✅ Rule-based static rate tables (`RATE_PER_KM`, `LOAD_MULT`), distance-based `/quote`, Zod validation.
- ✅ Marketplace economics: `shipper_pays = total`, `driver_receives = total − 10% platform_fee`.
- ✅ Load-risk multipliers (hazardous 1.5×, heavy_machinery 1.3×, fragile 1.2×, perishable 1.15×).

## ✅ Pricing-engine codebase (separate Python — "READY" per blueprint, not yet integrated)
- ✅ `cto_data.py` — market constants: truck categories **SCV/LCV/MCV/HCV**, mileage by BS norm (Kmpl6/Kmpl4), **Def6** AdBlue %, `vehicle_parc` counts, `service_cost` by age, `oil_cost` (engine+gear), defaults (diesel, driver wage, fixed cost, capacity, handling).
- ✅ `cto_engine.py` — `breakdown(category, distance, age)` → deterministic operating-cost breakdown. (D-8)
- ✅ `rl_agent.py` — **LinUCB** contextual bandit (one ridge model per pricing action); `LinearQAgent` present but **unused**.
- ✅ `pretrain.py` / `market_sim.py` — synthetic-data training (16-feature market env).

## ⬜ To do (MVP / P0)
- ⬜ Stand up the **Python/FastAPI** pricing service (replace the TS placeholder as system of record for quotes). (W4-1)
- ⬜ Port the **CTO cost-engine** → expose `/quote` returning **fuel / driver / per-km / handling** breakdown (the P0 anchor). (W4-2)
- ⬜ **Quantity basis by material** — tonnage vs volumetric. (W4-5)
- ⬜ **Special surcharges** from capacity + "object handling extra cost" keys (freight buffers).
- ⬜ **Persist quote IDs** so the quoted price is locked at booking (integrate with bt-booking-service). (W4-3)
- ⬜ **GST + 2% TDS math** (blueprint): GTA rates 5% no-ITC / 12% with-ITC; flag 2% TDS under Sec 194C. New `cto_data` fields: `gta_tax_class`, `tds_deduction_amount_inr`. (W4-4)
- ⬜ Wire **LinUCB on synthetic data** behind a flag (decoupled from live quotes until Phase-2 data feeds). (W4-6)
- ⬜ Market-context API: lane-asymmetry directionality + ≥1 external freight index (Rivigo NFI / Freight Index One). (W4-8)

## ⬜ To do (P1 — data-dependent, keep synthetic for now)
- ⬜ Replace synthetic market signals with real feeds: **weather/monsoon API, harvest calendar, demand–supply, real vehicle_parc, live diesel price** (see PRD Part 7). (W4-7)
- ⬜ Real road distance + tolls via Google Routes API (currently caller-supplied distance).

## 🔮 Deferred / out of MVP
- `LinearQAgent` (backhaul-aware) — explicitly bypassed for Phase 1.
- Dynamic monsoon/harvest overlays on **live** quotes — Phase 2.
- Per-lane/per-vehicle fee overrides; admin rate UI.

## 🔑 External dependencies / data
- Python/FastAPI runtime in the Cloud Run stack; trained LinUCB weights artifact.
- Phase-2 data: weather API, harvest calendar, diesel-price feed, real demand/supply + vehicle parc.

## 🎯 Definition of done (this service)
Posting a load returns a price with a line-item breakdown (fuel/driver/per-km/handling) + GST/TDS, and the quoted price (by quote ID) is the price charged at booking. LinUCB runs on synthetic data behind a flag.

_Last updated: 2026-07-01_
