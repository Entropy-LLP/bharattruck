# BharatTruck Pricing Engine — Project Reference & Decision Log

**Module:** RL-driven 3-layer freight pricing engine for the BharatTruck Logistics OS
**Owner:** DeltaOS · Mumbai · Confidential
**Status:** v1.1 — built, tested end-to-end, runnable locally
**Last updated:** June 2026

This document is the canonical record of what was asked for, what was decided,
and how the module works. It captures the original inputs (requirements) and
the resulting design so the build can be referenced, reviewed, and continued.

---

## 1. Objective (as stated)

> "Build a pricing engine to improve ROI for Drivers and Fleet Operators as
> well as provide competitive rates to Shippers for our Logistics OS platform."

The engine must simultaneously serve three stakeholders whose interests
partly conflict: operator/driver ROI (margin), shipper competitiveness
(win-rate), and platform revenue (commission). This three-way balance is
encoded directly in the RL reward function (§5).

Recommended approach (accepted): a **3-layer pricing engine** with an RL
policy on top.

---

## 2. Inputs provided (source data & context)

| Input | Use in engine |
|---|---|
| `Vehicle_Model_Wise_Mileage___DEF_Usage.jpeg` | KMPL + DEF% by category / age / BS norm → fuel & DEF cost (Layer 1) |
| `Vehicle_Model_Wise_Annual_Service_Cost.jpeg` | Service ₹/yr by category / age → age-decay maintenance cost (Layer 1) |
| `Vehicle_Model_Wise_Engine_Oil_Consumption.jpeg` | Oil change interval + litres → oil cost/km (Layer 1) |
| `Vehicle_Model_Wise_Gear_Oil_Consumption.jpeg` | Oil change interval + litres → oil cost/km (Layer 1) |
| `BharatTruck_India_Platform_Schema.pdf` | Platform context: entities, compliance, marketplace, payments |
| FY25 vehicle parc (Age 1–10) from image 1 | Truck supply prior in the market simulator |

All extracted values live in `cto_data.py` with the data flags in §7.

---

## 3. Requirements captured (chronological)

**R1 — 3-layer pricing engine.** Cost floor + market rate + dynamic quote.

**R2 — RL pricing algorithm** built from the image data, with the engine
learning the quote rather than using fixed rules.

**R3 — Working app / platform module.** A deployable service the BharatTruck
backend can call over REST, with a usable console UI.

**R4 — Local testability.** Must run on a Windows laptop (Python 3.14, WSL2
available).

**R5 — Enhancement parameters (v1.1):**
1. Load in terms of **tonnage and volume**
2. **Value of the cargo** + **handling parameters**
3. **FTL & PTL** load aggregation
4. **Backhaul probability must be variable** and depend on the fleet
   operator's shipper base at the destination and the demand pipeline

**R6 — This reference file** capturing inputs + outputs for the project.

---

## 4. Architecture — the three layers

**Layer 1 — Cost-to-Operate (CTO) engine** (`cto_engine.py`, `cto_data.py`)
Bottom-up ₹/km for a `(model_category, age, emission_norm)` triple, summing:
fuel + DEF + engine oil + gear oil + tyres + age-based service + driver +
fixed (EMI/insurance/permit). This is the **hard quote floor** — the RL agent
can never quote below `CTO + pass-through + minimum margin`. This is the
safety property that makes RL deployable for live pricing, and the wedge:
most Indian platforms price off market discovery alone; this prices off real
cost-to-operate per truck.

**Layer 2 — Market rate intelligence** (`market_sim.py`)
Corridor rate priors (₹/km by segment) adjusted for diesel pass-through,
lane demand/supply, monsoon, harvest season, and lane imbalance. In
production these priors are replaced by observed lane rates from platform
transactions. Doubles as the training environment for the RL agent.

**Layer 3 — RL quote policy** (`rl_agent.py`)
Chooses a price multiplier over the Layer-2 market rate, floor-clipped by
Layer 1. Two staged learners:
- **LinUCB contextual bandit** — production day-1 algorithm; learns online
  from live accept/reject events, no simulator needed. **This is the shipped
  agent.**
- **LinearQ (TD, round-trip)** — learns 2-step outbound→backhaul value;
  deploy once round-trip data accumulates.

---

## 5. RL formulation

- **Action set:** price multipliers `[0.90, 0.94, 0.98, 1.02, 1.06, 1.12, 1.20]`
  on the Layer-2 market rate; Layer-1 floor enforced as a hard clip.
- **State (16 features, v1.1):** category, age, BS4 flag, distance,
  demand/supply, diesel price, monsoon, harvest, urgency, shipper
  price-sensitivity, leg (outbound/backhaul), market-to-CTO cover, **cargo
  utilization, cargo value density, handling risk, backhaul probability**.
- **Episode = round trip (2-step MDP):** outbound quote, then backhaul quote
  if matched and a return load exists — lets the policy shade outbound prices
  on backhaul-rich lanes (broker-impossible math).
- **Reward (three-stakeholder, composite):**
  `matched → (0.04·quote + 0.25·operator_margin)/1000`, `unmatched → −0.05`.
  `0.04·quote` = platform commission; `0.25·margin` = operator ROI/retention;
  `−0.05` = shipper-competitiveness / liquidity pressure. **Weights are
  product levers**, not constants.

**Benchmark result (v1.0, 8k held-out episodes):** LinUCB beat static
market-rate pricing by +8.9% on the composite objective, lifting average
operator margin from 16.6% → 24.1%.

---

## 6. v1.1 enhancement design (R5)

**Tonnage + volume (R5.1).**
Chargeable basis = `max(actual weight, volumetric weight)`, with the Indian
road-PTL convention **1 CFT = 10 kg**. Per-category rated payload (MT) and
body volume (CFT) in `cto_data.CAPACITY`. **Overweight vs rated payload →
quote blocked (HTTP 409)** for MV Act overloading compliance.

**Cargo value + handling (R5.2).**
Cargo value drives (a) a **transit-risk premium** (rate varies by handling
class) and (b) the **e-Way Bill flag** (value > ₹50,000). Handling classes —
fragile, hazmat, reefer, odc, manual-loading — add surcharges + flat fees via
`cto_data.HANDLING`.

**FTL & PTL (R5.3).**
`load_type` on `/v1/quote`. PTL single consignment is priced as a chargeable
share of the truck + PTL premium. `POST /v1/quote/ptl-aggregate` consolidates
N consignments: fit check → FTL-equivalent RL quote → allocation by
chargeable weight → per-consignment pricing + e-Way Bill flags →
**consolidation gain vs FTL**. (Tested: 3 consignments, 89% wt / 95% vol
utilization, +22.1% revenue over FTL-equivalent.)

**Variable backhaul probability (R5.4).**
```
p_lane  = clip(0.85 / lane_imbalance, 0.15, 0.85)
network = 1 − exp(−(0.12·operator_shippers_at_destination
                    + 0.05·open_return_loads))
p       = clip(p_lane + (1 − p_lane)·network, 0.05, 0.95)
```
An operator's own shipper base at the destination converts better than
anonymous marketplace pipeline — hence the higher weight (0.12 vs 0.05).
`load_models.backhaul_probability()`.

---

## 7. Data assumptions to verify (flags)

These were inferred during extraction and should be confirmed against source:

- **[F1] Oil files appear swapped.** The file named "Engine Oil" carried
  long intervals / small volumes (gearbox-like); "Gear Oil" carried short
  intervals / large volumes (engine-sump-like). Assigned by **physical
  meaning**, not filename.
- **[F2] Tipper "2,400" treated as engine hours, not km.** Road CTO uses a
  50,000 km/yr override (`TIPPER_ANNUAL_KM_OVERRIDE`).
- **[F3] Blank BS4 cells backfilled with BS6 values** (conservative).
- **Not in images (config defaults, override with real data):** tyre cost/km,
  driver wages, fixed cost/year, capacity (payload/volume), handling
  surcharge/risk rates, corridor rate priors.

---

## 8. API surface

| Endpoint | Purpose |
|---|---|
| `POST /v1/quote` | FTL or single-consignment PTL quote → band, RL quote, CTO breakdown, cargo/handling, operator margin, backhaul |
| `POST /v1/quote/ptl-aggregate` | Consolidate N PTL consignments on one truck |
| `POST /v1/quote/{id}/feedback` | Report accept/reject → online LinUCB update + persist |
| `GET /v1/cto` | Layer-1 ₹/km cost-to-operate breakdown |
| `GET /v1/meta` | Categories, capacities, corridors, handling classes, action grid |
| `GET /health` | Liveness |
| `GET /` | Built-in pricing console (demo UI) |
| `GET /docs` | Auto-generated Swagger UI |

Quote logs append to `rate_quote.jsonl` (mirrors the suggested Supabase
`rate_quote` table in `README.md`).

---

## 9. Verified behaviour (this build)

- FTL quote: chargeable weight, fragile +5% surcharge, ₹9L value → e-Way Bill
  flag + ₹1,080 risk premium, backhaul p=0.88 (lane 0.773 + network 0.457
  from 3 shippers + 5 pipeline loads). ✓
- Overweight (18 MT on 1 MT SCV) blocked with 409. ✓
- PTL aggregation: 3 consignments, fits at 89%/95%, +22.1% vs FTL; C3
  correctly volumetric-bound (7 MT chargeable > 6 MT actual). ✓
- Online feedback loop learned and persisted (reward 0.58). ✓

---

## 10. How to run (local)

```bash
cd bt_pricing_service
pip install -r requirements.txt           # add --break-system-packages if needed
python -m uvicorn service:app --host 0.0.0.0 --port 8090
```
Open **http://localhost:8090** (console) or **/docs** (API).
Windows note: use `python -m uvicorn ...` (or `py -m uvicorn ...`) — the bare
`uvicorn` command may not be on PATH. The retrained 16-feature agent ships in
the zip, so no `pretrain.py` run is needed. To reset the agent: delete
`agent_state.npz`, then `python pretrain.py`.

Docker: `docker build -t bt-pricing . && docker run -p 8090:8090 bt-pricing`.

---

## 11. Files

| File | Role |
|---|---|
| `cto_data.py` | All image data + capacity/handling config + flags |
| `cto_engine.py` | Layer 1 — CTO ₹/km, quote floor |
| `market_sim.py` | Layer 2 — market priors + RL training simulator |
| `rl_agent.py` | Layer 3 — LinUCB + LinearQ + baselines |
| `load_models.py` | Chargeable weight, handling, backhaul model, PTL allocation |
| `service.py` | FastAPI microservice |
| `console.html` | Built-in pricing console UI |
| `pretrain.py` | Build-time agent training → `agent_state.npz` |
| `agent_state.npz` | Shipped pretrained policy (16-feature) |
| `README.md` | Run + integration (Fastify/Supabase) guide |
| `PROJECT_REFERENCE.md` | This document |

---

## 12. Open items / next steps

1. **Verify data flags [F1–F3]** against source spreadsheets.
2. **Replace priors with real data:** corridor rates (`market_sim.BASE_RATE_PER_KM`),
   config defaults (`cto_data.DEFAULTS`), capacities (`cto_data.CAPACITY`).
3. **Wire live inputs:** IOCL daily diesel API, marketplace lane demand/supply,
   operator shipper-base + pipeline counts.
4. **Persist quotes to Supabase** `rate_quote` (DDL in README); LinUCB updates
   online per accept/reject.
5. **Guardrails:** keep CTO floor hard; cap day-over-day quote movement per
   lane (±8%); hold out 5% on the static policy as a permanent A/B control.
6. **Graduate to offline RL** (CQL/IQL) on logged round-trip data once volume
   supports it; MDP + reward stay identical.
7. **Personalise Layer 1:** shrink parc-average KMPL/service toward each
   truck's own fuel-log + service-record actuals (Bayesian).
8. **Adjacent finance modules unlocked by Layer 1:** trip/fleet P&L, vehicle
   replacement economics (ties to TMCV spares), predictive maintenance
   budgeting, smarter TReDS/working-capital pricing, sellable corridor rate
   index.
