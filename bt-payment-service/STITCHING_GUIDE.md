# Stitching Guide - BharatTruck Payment Service Backend Integration

This guide provides instructions on how to configure, run, migrate the database, and verify the integrated TypeScript/Node.js Fastify gateway and the Python FastAPI payment gateway.

The target service supports both legacy cash-recorded mode and payment-gateway mode.

---

## 1. Architecture Overview

```
                      [ Client (Mobile / Web App) ]
                                    |
                                    | HTTP Requests (with Bearer JWT)
                                    v
                    [ Node.js Fastify API (Port 3004) ]
                    ├── (Auth Plugin: verifies JWT)
                    └── (Index router: routes request)
                                    |
            +-----------------------+-----------------------+
            | (PAYMENT_MODE=static)                         | (PAYMENT_MODE=gateway)
            v                                               v
[ Local TS paymentRoutes ]                       [ HTTP Proxy Request ]
(Durable Supabase storage)                                  |
                                                            v
                                            [ Python FastAPI (Port 8000) ]
                                            ├── (app.main: app instance)
                                            └── (local.db / PostgreSQL)
```

---

## 2. Configuration & Environment Variables

Create or update the `.env` file at the root of `bt-payment-service/`:

```env
# Fastify Gateway Configuration
PORT=3004
NODE_ENV=development
JWT_SECRET=your_jwt_secret_here

# Payment Service Mode Toggle
# Modes: "static" (uses rules-based Supabase settlement) | "gateway" or "razorpay" (uses Python payment-gateway engine)
PAYMENT_MODE=gateway

# Python Payment Gateway Endpoint
PAYMENT_GATEWAY_URL=http://localhost:8000
```

Also, create or copy the `.env` file inside `payment-gateway/` (`bt-payment-service/payment-gateway/.env`):

```env
ENV=development
DEBUG=true
PROJECT_NAME="BharatTruck Payment Service"
HOST=0.0.0.0
PORT=8000

# Connection URL: Uses local SQLite by default. 
# For PostgreSQL: "postgresql://postgres:postgres@localhost:5432/payment_db"
DATABASE_URL="sqlite:///./local.db"

# Razorpay Credentials (required for the uvicorn service to boot)
RAZORPAY_KEY_ID=rzp_test_yourkeyid
RAZORPAY_KEY_SECRET=yourkeysecret
RAZORPAY_WEBHOOK_SECRET=yourwebhooksecret
```

---

## 3. How to Run Locally

### Prerequisites
*   Node.js (>= 18) and `npm`
*   Python (>= 3.8) with `pip`

### Step 1: Install Dependencies
Install Node.js dependencies at the root of `bt-payment-service`:
```bash
npm install
```

Install Python dependencies for the payment gateway:
```bash
cd payment-gateway
pip install -r requirements.txt
cd ..
```

### Step 2: Run Database Migrations
Before starting the gateway, run the Alembic database migrations to generate/update the local SQLite database (`local.db`):
```bash
npm run db:migrate
```

### Step 3: Run Both Services Concurrently
To start both the Node.js Fastify gateway and the Python FastAPI payment gateway concurrently in development mode:
```bash
npm run dev
```

*   Fastify Gateway runs at `http://localhost:3004`
*   Python FastAPI payment gateway runs at `http://localhost:8000`

---

## 4. API Verification Guide

All endpoints (except `/health` and `/webhooks/razorpay`) are protected by JWT authentication (HS256 with `JWT_SECRET`).

### Fetching Health Status (Public)
Checks both gateway and payment engine status:
```bash
curl -X GET http://localhost:3004/health
```

### 1. Payment Orders (JWT-Gated)
Generate a payment order with Razorpay:
```bash
curl -X POST http://localhost:3004/payments/create-order \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "booking_id": "893d56b0-7d72-4d0f-8c34-eb138139556e",
    "amount": 25000,
    "currency": "INR"
  }'
```

Retrieve details by payment ID:
```bash
curl -X GET http://localhost:3004/payments/<payment_id> \
  -H "Authorization: Bearer <your_jwt_token>"
```

### 2. Proof of Delivery (JWT-Gated)
Upload a signed delivery slip:
```bash
curl -X POST http://localhost:3004/pod/upload \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "booking_id": "893d56b0-7d72-4d0f-8c34-eb138139556e",
    "photo_url": "https://s3.amazonaws.com/lr-slips/pod-booking-123.jpg"
  }'
```

Verify a delivery slip (releases the constraint, allowing escrow release):
```bash
curl -X POST http://localhost:3004/pod/<pod_id>/verify \
  -H "Authorization: Bearer <your_jwt_token>"
```

### 3. Escrow Releases (JWT-Gated)
Release locked escrow funds to the carrier (requires a verified POD for the booking):
```bash
curl -X POST http://localhost:3004/escrow/payment/<payment_id>/release \
  -H "Authorization: Bearer <your_jwt_token>"
```

### 4. Razorpay Webhooks (Public)
Fastify forwards Razorpay webhook requests directly to the Python backend while passing the `X-Razorpay-Signature` header for cryptographically secure HMAC verification:
```bash
curl -X POST http://localhost:3004/webhooks/razorpay \
  -H "X-Razorpay-Signature: <hmac_signature>" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "event",
    "account_id": "acc_BFQ7u5377tqaYg",
    "event": "payment.captured",
    "contains": ["payment"],
    "payload": {
      "payment": {
        "entity": {
          "id": "pay_DesW4w295",
          "amount": 25000,
          "order_id": "<rzp_order_id>",
          "status": "captured"
        }
      }
    }
  }'
```
