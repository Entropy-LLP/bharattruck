# bt-pricing-service

Pricing microservice for **LogisticOS** — computes freight quotes for shippers based on distance, vehicle type, load type, and weight.

Built with **Fastify + TypeScript**. Currently v1 (static rate tables); ML-based dynamic pricing planned for Sprint 17.

---

## Endpoints

### `GET /health`
Returns service status.

```json
{
  "status": "ok",
  "service": "bt-pricing-service",
  "version": "v1-static",
  "ts": "2026-04-06T10:00:00.000Z"
}
```

---

### `POST /quote`
Returns a freight price breakdown.

**Request body:**

| Field          | Type   | Description                                              |
|----------------|--------|----------------------------------------------------------|
| `distance_km`  | number | Route distance in kilometres (must be positive)          |
| `vehicle_type` | string | `mini_truck` \| `lcv` \| `hcv` \| `trailer`             |
| `load_type`    | string | `general` \| `fragile` \| `perishable` \| `hazardous` \| `heavy_machinery` |
| `weight_kg`    | number | Cargo weight in kilograms (must be positive)             |

**Example request:**

```bash
curl -X POST http://localhost:3003/quote \
  -H "Content-Type: application/json" \
  -d '{"distance_km": 250, "vehicle_type": "lcv", "load_type": "fragile", "weight_kg": 3000}'
```

**Example response:**

```json
{
  "success": true,
  "data": {
    "base_price": 4500,
    "weight_surcharge": 0,
    "total_price": 4500,
    "platform_fee": 450,
    "shipper_pays": 4500,
    "driver_receives": 4050,
    "currency": "INR",
    "version": "v1-static"
  }
}
```

---

## Pricing Logic (v1 — static rates)

**Base price** = `distance_km × rate_per_km × load_multiplier` (rounded up)

**Rate per km by vehicle type:**

| Vehicle      | Rate (INR/km) |
|--------------|---------------|
| `mini_truck` | 12            |
| `lcv`        | 15            |
| `hcv`        | 22            |
| `trailer`    | 35            |

**Load multipliers:**

| Load type         | Multiplier |
|-------------------|------------|
| `general`         | 1.0        |
| `perishable`      | 1.15       |
| `fragile`         | 1.2        |
| `heavy_machinery` | 1.3        |
| `hazardous`       | 1.5        |

**Weight surcharge:** +INR 500 per 1,000 kg above 5,000 kg.

**Platform fee:** 10% of total price (retained by LogisticOS; driver receives the remainder).

---

## Getting Started

### Prerequisites
- Node.js >= 18
- npm

### Install

```bash
npm install
```

### Configure environment

```bash
cp .env.example .env
```

`.env` variables:

| Variable   | Default       | Description        |
|------------|---------------|--------------------|
| `PORT`     | `3003`        | Server listen port |
| `NODE_ENV` | `development` | Environment        |

### Run

```bash
# Development (hot reload)
npm run dev

# Production build
npm run build
npm start
```

---

## Tech Stack

| Layer       | Technology                     |
|-------------|--------------------------------|
| Runtime     | Node.js (ESM)                  |
| Framework   | Fastify 4                      |
| Language    | TypeScript 5                   |
| Validation  | Zod                            |
| Logging     | Pino / pino-pretty             |
| CORS        | @fastify/cors                  |

---

## Roadmap

- **v2 (Sprint 17):** Replace static rate tables with a Python FastAPI ML model for dynamic, demand-aware pricing.
