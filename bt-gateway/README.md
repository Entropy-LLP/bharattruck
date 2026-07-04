# bt-gateway

Nginx reverse proxy and API gateway for **BharatTruck** — routes all client traffic to the correct backend microservice.

## Routing

| Path | Backend | Description |
|------|---------|-------------|
| `/api/auth/` | bt-auth-service:3001 | OTP, JWT, Google OAuth |
| `/api/kyc/` | bt-auth-service:3001 | KYC verification |
| `/api/onboarding/` | bt-auth-service:3001 | Driver onboarding |
| `/api/bookings/` | bt-booking-service:3002 | Booking CRUD, lifecycle |
| `/api/quotes/` | bt-booking-service:3002 | Quote negotiation |
| `/api/location/` | bt-booking-service:3002 | Driver GPS pings |
| `/api/pricing/` | bt-pricing-service:3003 | Fare calculation |
| `/api/payments/` | bt-payment-service:3004 | Razorpay escrow |
| `/api/cargo/` | bt-cargo-ledger:3005 | Chain of custody |
| `/ws/` | bt-booking-service:3002 | WebSocket (live tracking) |
| `/health` | Gateway itself | Health check |

## Features

- **Rate limiting** — 5 req/min for OTP endpoints, 60 req/min for general API
- **CORS** — Single authority for CORS headers, configurable via `CORS_ALLOWED_ORIGINS`
- **Security headers** — X-Frame-Options, X-XSS-Protection, Content-Type-Options, Referrer-Policy
- **Request tracing** — X-Request-Id propagation (generates one if not provided)
- **Gzip compression** — JSON, plaintext, JavaScript
- **WebSocket proxying** — Upgrades connections for `/ws/` path
- **JSON error pages** — Structured 502/503/504 responses

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DNS_RESOLVER` | `127.0.0.11` | DNS resolver (Docker default; use `8.8.8.8` on Render) |
| `AUTH_SERVICE_URL` | `http://bt-auth-service:3001` | Auth service URL |
| `BOOKING_SERVICE_URL` | `http://bt-booking-service:3002` | Booking service URL |
| `PRICING_SERVICE_URL` | `http://bt-pricing-service:3003` | Pricing service URL |
| `PAYMENT_SERVICE_URL` | `http://bt-payment-service:3004` | Payment service URL |
| `CARGO_SERVICE_URL` | `http://bt-cargo-ledger:3005` | Cargo ledger URL |
| `CORS_ALLOWED_ORIGINS` | `*` | Allowed CORS origins |

## Running Locally

Via Docker:

```bash
docker build -t bt-gateway .
docker run -p 8080:80 bt-gateway
```

Or as part of the full stack via the [LogisticOS](https://github.com/deltaos1997/LogisticOS) workspace:

```bash
docker compose up bt-gateway
```

## Deployment

Deployed on **Render** as a Docker web service. See `render.yaml` for configuration.
