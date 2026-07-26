# Task: `feat/fleet-owner` — the fleet-owner persona

Branch task file per `docs/BIBLE.md §0.4`. Delete on merge.

**Founder decisions locked 2026-07-26** (Q&A in session). This file is the contract for
the slice; where it disagrees with any older doc, this file wins for fleet work only.
The frozen Maps contract (`docs/BIBLE.md §3.1`) is untouched by this slice.

---

## 0. Live-schema baseline (introspected 2026-07-26, NOT from the .sql files)

Founder rule: **what is live is the source of truth; migration files only record intent.**
Introspected via PostgREST OpenAPI (`scripts/db/verify-fleet-schema.mjs`).

The live DB has **48 tables** — far more than `supabase/migrations/0009..0013` describe.
Migrations 0001–0008 were never applied as written. Facts that constrain this slice:

| Fact | Consequence |
|---|---|
| `users.role` enum = `shipper\|driver\|admin` | no `fleet_owner`, **no `ops`** either. Auth already accepts `fleet_owner` in Zod → 500s today. |
| `vehicles.driver_id` **NOT NULL** → `drivers.id` | must become nullable for fleet-owned trucks |
| `quotes.driver_id` **NOT NULL** → `drivers.id` | must become nullable for fleet bids |
| `bookings` has no `vehicle_id` / `fleet_owner_id` | added in 0016 |
| `trips`, `trip_expenses`, `fuel_estimates`, `saved_lanes`, `trip_routes` **already exist** | reuse, do NOT recreate |
| `trip_expenses` = `(driver_id NOT NULL, trip_id, category, amount, receipt_path, expense_date)` | extend for driver fuel entry |
| RPCs `accept_booking`, `start_trip`, `complete_trip` exist | do not duplicate their logic |
| **PostGIS is installed** (contradicts `CLAUDE.md`'s "no PostGIS") | still use plain lat/lng decimals per contract; just don't assert it's absent |
| `bookings.status` enum has **no `expired`** | migration 0004 was never applied |

---

## 1. Product model (locked)

- A **fleet owner never drives** and never has a `drivers` row.
- A **solo driver stays hardcoded to their own truck** (`vehicles.driver_id`) — untouched.
- A **fleet driver owns no truck.** The truck they ran is recorded per-order
  (`vehicle_assignments` + `bookings.vehicle_id`) — that *is* their truck history.
- **Drivers and trucks are independent assets.** Any driver may pair with any truck.
- Owner invites an **existing** driver account → `fleet_drivers.status='pending'` → driver
  accepts → `'active'`. We never create driver identities on the owner's behalf.
- Drivers still KYC individually (Q6). A driver may leave a fleet (Q7).
- Fleet may bid on **unlimited auctions** (Q9), and **may bid with no free truck** (Q10).
  One live bid per booking per fleet.
- **Award → assign(driver, vehicle) → the trip runs exactly as the solo-driver flow does.**
  No fork in the booking state machine.
- **Payout goes to whoever bid** (Q15): fleet bid → fleet owner is payee.
- **Fleet drivers cannot see trip price** (Q16) and **cannot reject an assignment** (Q12).
- Fleet drivers lose the load board only; everything else in the driver app is unchanged (Q14).
- **Not in v1:** shipper directly targeting a fleet (Q11), mid-trip reassignment (Q13),
  deadhead/empty-km attribution (Q22 — my call; fields exist so it is derivable later).

---

## 2. Migrations `0014`–`0018`

Written, **not yet applied** — see §6. Forward-only and additive; no `DROP COLUMN`.

- `0014_fleet_owner_role.sql` — `alter type user_role add value 'fleet_owner'`.
  **Own file**: the label must COMMIT before 0015 references it.
- `0015_fleet_owner_core.sql` — `fleet_owners`, `fleet_drivers`, vehicle-ownership pivot
  (`vehicles.fleet_owner_id`, `driver_id` nullable, `CHECK num_nonnulls(...)=1`,
  `model_category`, `emission_norm`, `manufacture_year`, `volume_cuft`, `current_odometer_km`).
- `0016_fleet_assignment_and_auction.sql` — `quotes.fleet_owner_id` (+ nullable `driver_id`,
  one-live-bid index), `bookings.fleet_owner_id/vehicle_id`, `vehicle_assignments`
  (3 partial-unique indexes), `payouts.payee_type/fleet_owner_id`,
  `location_history.vehicle_id`, `trips.vehicle_id`.
- `0017_fleet_asset_economics.sql` — `vehicle_finance` (EMI), `vehicle_permits`,
  `vehicle_lanes` (corridor), `trip_expenses` extensions, `trip_economics` roll-up.
- `0018_vehicle_cost_norms.sql` — `vehicle_cost_norms` + `vehicle_service_cost_by_age`
  + `fleet_cost_settings`, seeded from the founder's `CV_Parc_Tables.xlsx`.

---

## 3. The P&L model (Q18) — derived from `CV_Parc_Tables.xlsx`

Replaces the `ASSUMPTION (Q9)` constants in `bt-pricing-service/src/lib/cto-cost.ts`.
All of these are per-trip, keyed on the truck's `model_category`, `emission_norm`, and age.

```
diesel_l   = distance_km / kmpl(model_category, emission_norm)
fuel       = diesel_l * diesel_price
def        = diesel_l * def_pct(model, norm) * def_price
engine_oil = distance_km / eng_oil_km(model, norm) * eng_oil_l(model, norm) * engine_oil_price
gear_oil   = distance_km / gear_oil_km(model, norm) * gear_oil_l(model, norm) * gear_oil_price
service    = annual_cost(super_category, age_years) / kms_per_year * distance_km
tyres      = distance_km * tyre_cost_per_km
driver_wage_alloc  (see below)
running_cost = fuel + def + engine_oil + gear_oil + service + tyres + driver_wage_alloc
net_profit   = revenue - running_cost          # revenue = payouts.amount for the booking
```

**Service cost is age-dependent and non-linear** — it peaks at age ~3 and falls off
(MHCV Cargo: ₹108k yr1 → ₹209k yr3 → ₹61k yr10). A flat per-km maintenance number, which
`cto-cost.ts` uses today, is wrong at both ends of that curve.

**Driver wage allocation (Q18, "weighted by type of vehicle"):** a driver's monthly salary
is spread over the trucks they actually ran that month, pro-rata by
`km_on_that_truck × wage_weight(model_category)`. Weights seeded SCV 1.0 → HCV 2.0.

**Monthly fixed charges** (NOT allocated per trip — Q19): `vehicle_finance.emi_amount_inr`
plus insurance/permit/fitness annuals ÷ 12, plus `fleet_owners.monthly_overhead_inr` spread
across active vehicles. Reported as *"this truck cleared its EMI by ₹X this month"*.

### Market benchmark (fr8.in, read 2026-07-26) — context for the rate-card finding
Live market rates: Mumbai–Delhi 1414 km 32ft MXL ₹83,500 (**₹59/km**); Delhi–Kolkata
1480 km ₹88,600 (**₹60/km**); Bangalore–Chennai 346 km ₹20,000 (**₹58/km**). Published
band for a 32ft MXL is **₹45–85/km**.
BharatTruck's `RATE_PER_KM.hcv` is **₹22/km** — roughly a third of the market floor, and
below its own computed operating cost of ₹36.71/km. **The cost engine is realistic; the
rate card is what is wrong.** Not changed in this slice — flagged for the founder.

**Observed corridors** (seed `vehicle_lanes` defaults): Mumbai–Delhi 1414, Delhi–Kolkata
1480, Pune–Bangalore 840, Hyderabad–Mumbai 706, Ahmedabad–Mumbai 530, Chennai–Coimbatore
496, Bangalore–Chennai 346, Delhi–Jaipur 280.

---

## 4. `bt-fleet-service` (new, port **3007**, gateway `/api/fleet/*`)

Follows the existing microservice recipe (`bt-pricing-service` is the cleanest template):
Fastify + Zod + `{success,data}` / `{success,error,code}` envelope, snake_case JSON,
custom HS256 JWT plugin, `INTERNAL_SERVICE_SECRET` plugin for service-to-service, Dockerfile.

```
POST   /fleet/owners                      register the fleet profile (role=fleet_owner)
GET    /fleet/owners/me
PATCH  /fleet/owners/me

POST   /fleet/drivers/invite              { driver_phone } -> pending affiliation
GET    /fleet/drivers                     roster + status
PATCH  /fleet/drivers/:id                 { monthly_salary_inr | status: suspended }
DELETE /fleet/drivers/:id                 -> status='left' (blocked if live assignment)
POST   /fleet/drivers/invites/:id/respond driver-side accept/reject (role=driver)
GET    /fleet/drivers/invites/mine        driver-side pending invites (role=driver)

POST   /fleet/vehicles                    add one truck
POST   /fleet/vehicles/bulk               bulk onboarding, xlsx/csv/pdf -> OCR (stubbed, Q19)
GET    /fleet/vehicles                    list + live status
GET    /fleet/vehicles/:id
PATCH  /fleet/vehicles/:id
PUT    /fleet/vehicles/:id/finance        EMI + annual carrying costs
PUT    /fleet/vehicles/:id/permits
PUT    /fleet/vehicles/:id/lanes          corridor (changeable, not hardcoded)

POST   /fleet/bookings/:id/assign         { driver_id, vehicle_id }  <- the pairing step
GET    /fleet/bookings                    fleet-scoped booking list

GET    /fleet/live                        ALL vehicle positions in ONE Redis MGET
GET    /fleet/analytics/summary
GET    /fleet/analytics/vehicles          per-asset P&L + EMI coverage + utilization
GET    /fleet/analytics/vehicles/:id
GET    /fleet/analytics/drivers
GET    /fleet/analytics/fuel              estimated vs actual

POST   /internal/trip-economics/:bookingId   roll-up hook, called on completed->paid
```

**`GET /fleet/live` must not fan out.** Maintain a Redis set `fleet:{id}:drivers`; serve
with one `SMEMBERS` + one `MGET` over `loc:driver:{driverId}` — the exact key
`bt-booking-service/src/lib/redis.ts` writes, which is its only writer. Never loop `/location/driver/:id`,
and never call Google-backed `/tracking/*` per vehicle — route/ETA stay lazy, one selected
vehicle at a time. At 1000 trucks on a 10s poll the fan-out version is 100 req/s.

### Utilization (Q20) — three distinct metrics, per vehicle and fleet-wide
- **Tonnage** = Σ`laden_weight_kg` ÷ Σ(`capacity_kg` × trips)
- **Volume** = Σ`volume_used_cuft` ÷ Σ(`capacity_cuft` × trips)
- **Distance** = Σ`distance_km_actual` ÷ (`kms_per_year` ÷ 365 × days in period)
- **Running-cost score** = the headline: did this asset cover its own running cost +
  EMI over the period? Accumulated historically per vehicle.

---

## 5. Cross-service wiring

| Service | Change |
|---|---|
| `bt-auth-service` | accept `role='fleet_owner'` end-to-end (Zod already does); create the `fleet_owners` row on register; keep driver KYC unchanged |
| `bt-booking-service` | `resolveBidder(actor)` → `{kind:'driver'\|'fleet'}` threaded through `submitQuote`/`counter`/`withdraw`/`listQuotes`; award sets `bookings.fleet_owner_id`; **`accepted→in_transit` blocked without a live `vehicle_assignments` row**; strip price fields from booking payloads for fleet-affiliated drivers; 403 the load board for fleet drivers |
| `bt-payment-service` | payout payee = bidder (`payee_type`); emit the `trip-economics` roll-up on `completed→paid` |
| `bt-tracking-service` | `assertCanAccess` gains a fleet branch |
| `bt-gateway` | `/api/fleet/` → `bt-fleet-service:3007` |
| `packages/shared` | one `resolveFleetContext` / `canFleetAccessBooking` helper — **not** copied per service |

**Top risk: tenant isolation.** Every existing auth check is a binary `shipper｜driver`.
One missed fleet branch leaks one fleet's assets to another. Centralize in `shared`.

---

## 6. Status

- [x] Live schema introspected; `scripts/db/verify-fleet-schema.mjs` written and proven
      against live (correctly reports the pre-migration state)
- [x] Migrations `0014`–`0018` written
- [ ] **BLOCKED: migrations not applied.** Cloud Run holds only the Supabase *service-role*
      key, which speaks PostgREST — rows yes, **DDL no**. No DB password and no Supabase
      access token exists in Cloud Run, the repo, or the local CLI config. Unblock with
      **either** `supabase login` **or** `export SUPABASE_DB_PASSWORD=…`, then run
      `scripts/db/apply-fleet-migrations.sh` (applies, then verifies).
- [x] `bt-fleet-service` implemented (port 3007, 40/40 unit tests on the P&L engine)
- [x] Cross-service wiring: auth, booking, payment, tracking, gateway, `packages/shared`
- [x] Builds green — every touched package typechecks; `bt-fleet-service` verified from a
      clean-room `npm ci`. `bt-payment-service` e2e 23/23, booking `ops`/`paid`/`pod` e2e
      16/9/11. CI gained a `bt-fleet-service` filter and, separately, a real fix: services
      consuming `@bharattruck/shared` via a `file:` dep now rebuild when `packages/shared`
      changes (they previously did not).
- [x] Driver-persona regression review — 5 lenses, 12 findings raised, 8 confirmed after
      adversarial verification, 4 refuted. The 8 deduped to **3 real defects, all fixed**:

  1. **CRITICAL — solo settlement lost the driver's payout row, permanently.**
     `payment-service.ts` sent `payee_type`/`fleet_owner_id` on EVERY payout, including
     solo. Those columns arrive in 0016, so pre-migration PostgREST rejected the write
     (PGRST204) *after* the `payments` row had committed — and the retry then found that
     row, skipped the whole block, flipped the booking to `paid`, and returned 200 with
     no payout. Unrecoverable without manual SQL. Fixed two ways: `wirePayout()` sends a
     driver payout with exactly the pre-fleet column set, and `settle()` now writes the
     **payout before the payment** so a failure leaves no committed payment to suppress
     the retry. That ordering bug was latent regardless of the fleet work.
  2. **HIGH — every tracking endpoint 500'd for shippers and solo drivers.**
     `bt-tracking-service/src/lib/repository.ts` had `fleet_owner_id, vehicle_id` added to
     the shared booking select, which is on the hot path of `/route`, `/eta`, `/track` for
     all roles. Pre-0016 that is a 42703 and the live map dies for 100% of trips. Fixed:
     the select is back to its original column list; the fleet columns are fetched by
     `getBookingFleetColumns()` only inside the `fleet_owner` branch, tolerating a missing
     column as "no access" rather than 500.
  3. **HIGH — an owner could conscript a driver without consent.**
     `PATCH /fleet/drivers/:id` accepted `status:'active'` on a `pending` invitation,
     bypassing the driver's accept step and silently stripping a solo driver's load board
     and right to bid. Fixed: only the driver's `/invites/:id/respond` may move a row out
     of `pending`; the owner may still set salary on a pending row.

  Added `bt-payment-service/test/payout-wire-shape.mts` (7 checks). The existing e2e
  drives a Map-backed fake store that accepts any key, so it structurally could not catch
  defect 1 — it asserted the broken shape and passed.
- [ ] **Known pre-existing failure, NOT caused by this slice:** `bt-booking-service`
      `test/lifecycle.e2e.mts` fails 3 checks against `PATCH /bookings/:id/complete`.
      That route does not exist on `main` either (verified with `git show main:`) — the
      test is stale. Worth fixing, but out of scope here.
