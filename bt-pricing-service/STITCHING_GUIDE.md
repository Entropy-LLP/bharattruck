# Stitching Guide - BharatTruck Pricing Service Backend Integration

This guide provides instructions on how to configure, run, and test the integrated TypeScript/Node.js Fastify gateway and the Python FastAPI ML pricing engine.

The frontend test dashboard and associated routes have been removed from the final codebase, leaving a clean, secure, and production-ready backend.

---

## 1. Architecture Overview

```
                      [ Client (Mobile / Web App) ]
                                    |
                                    | HTTP Requests (with Bearer JWT)
                                    v
                     [ Node.js Fastify API (Port 3003) ]
                     ├── (Auth Plugin: verifies JWT)
                     └── (Index router: routes request)
                                    |
            +-----------------------+-----------------------+
            | (PRICING_MODE=static)                         | (PRICING_MODE=ml)
            v                                               v
[ Local TS computeQuote ]                       [ HTTP Proxy Request ]
(Deterministic CTO calculations)                            |
                                                            v
                                            [ Python FastAPI (Port 8090) ]
                                            ├── (service.py: LinUCB Agent)
                                            └── (agent_state.npz: weights)
```

---

## 2. Configuration & Environment Variables

Create or update the `.env` file at the root of `bt-pricing-service/`:

```env
# Fastify Gateway Configuration
PORT=3003
NODE_ENV=development
JWT_SECRET=your_jwt_secret_here

# Pricing Engine Mode Toggle
# Modes: "static" (uses rules-based formula) | "ml" or "dynamic" (uses Python LinUCB engine)
PRICING_MODE=ml

# Python ML Microservice Endpoint
PRICING_ENGINE_URL=http://localhost:8090
```

---

## 3. How to Run Locally

### Prerequisites
*   Node.js (>= 18) and `npm`
*   Python (>= 3.8) with `pip`

### Step 1: Install Dependencies
Install Node.js dependencies at the root of `bt-pricing-service`:
```bash
npm install
```

Install Python dependencies for the ML engine:
```bash
cd ml-engine
pip install -r requirements.txt
cd ..
```

### Step 2: Pretrain the ML Model (Optional)
If `agent_state.npz` is missing or you want to retrain the contextual bandit policy on the simulated market model (using the spreadsheet data):
```bash
npm run pretrain
```
This runs the simulation and outputs the trained model weights to `ml-engine/agent_state.npz`.

### Step 3: Run Both Services Concurrently
To start both the Node.js Fastify gateway and the Python FastAPI ML engine concurrently in development mode (with hot reloading for the TS files):
```bash
npm run dev
```

The console output will display logs for both the `api` (cyan) and `ml` (green) processes:
*   Fastify Gateway runs at `http://localhost:3003`
*   Python ML microservice runs at `http://localhost:8090`

---

## 4. Payload Mapping & Translation (Inside Gateway)

When `PRICING_MODE=ml` is active, the `/quote` endpoint acts as a translator and proxy to uvicorn.

### Request Translation (Fastify -> ML Engine)
The gateway translates the legacy `/quote` body into the ML payload schema:

*   **Vehicle Map**:
    *   `mini_truck` -> `"SCV Cargo"`
    *   `lcv`        -> `"LCV (4-7T)"`
    *   `hcv`        -> `"HCV Cargo 25-31T"`
    *   `trailer`    -> `"HCV Cargo 49-55T"`
*   **Load Map**:
    *   `general`         -> `[]`
    *   `fragile`         -> `["fragile"]`
    *   `perishable`      -> `["reefer"]`
    *   `hazardous`       -> `["hazmat"]`
    *   `heavy_machinery` -> `["odc"]`
*   **Weight**: Maps `weight_kg` to `cargo_weight_mt` (`weight_kg / 1000.0`).
*   **Defaults**: Backfilled with standard defaults for required ML fields (`vehicle_age: 5`, `demand_supply: 1.0`, etc.).

### Response Translation (ML Engine -> Fastify)
The gateway maps the dynamic pricing output back to the legacy schema format:

*   `base_price` <- `mlResp.band.target`
*   `weight_surcharge` <- `mlResp.cargo.risk_premium_inr` + `mlResp.cargo.flat_handling_inr`
*   `total_price` <- `mlResp.rl_quote`
*   `platform_fee` <- `10%` of the total price (retained by the platform)
*   `driver_receives` <- `total_price - platform_fee`
*   `quote_id` <- `mlResp.quote_id`

---

## 5. API Verification Guide

All endpoints except `/health` are protected by JWT authentication (HS256 with `JWT_SECRET`).

### Fetching Health Status (Public)
Checks both gateway and backend engine status:
```bash
curl -X GET http://localhost:3003/health
```

### Requesting a Quote (JWT-Gated)
Send a POST request to `/quote` containing the bearer token:
```bash
curl -X POST http://localhost:3003/quote \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "distance_km": 250,
    "vehicle_type": "lcv",
    "load_type": "fragile",
    "weight_kg": 3000
  }'
```

### Submitting Quote Feedback (JWT-Gated)
Submit acceptance feedback to update the online reinforcement learning loop:
```bash
curl -X POST http://localhost:3003/quote/<quote_id>/feedback \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "shipper_accepted": true,
    "operator_accepted": true
  }'
```

### Multi-Consignment PTL Consolidation (JWT-Gated)
Request a consolidated truck load price for multiple consignments (PTL):
```bash
curl -X POST http://localhost:3003/quote/ptl-aggregate \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "model_category": "HCV Cargo 25-31T",
    "vehicle_age": 5,
    "diesel_price": 92.0,
    "demand_supply": 1.0,
    "shipper_segment": "standard",
    "consignments": [
      { "id": "C1", "weight_mt": 10.0, "volume_cft": 600.0, "cargo_value_inr": 400000.0, "handling": ["fragile"], "manual_loading": false },
      { "id": "C2", "weight_mt": 8.0, "volume_cft": 500.0, "cargo_value_inr": 120000.0, "handling": [], "manual_loading": false }
    ]
  }'
```
