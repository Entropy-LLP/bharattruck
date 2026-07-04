# bt-payment-service

Payment microservice for LogisticOS — handles escrow-based payments between shippers and drivers via Razorpay.

## Overview

This service manages the full payment lifecycle for a logistics booking:

1. **Shipper pays** → Razorpay order created, funds held in escrow
2. **Delivery confirmed** → escrow released, payout initiated to driver's bank account

Built with Fastify + TypeScript, backed by Supabase.

> **Status:** Scaffold complete. Razorpay integration is stubbed and scheduled for Sprint 7.

## Tech Stack

- **Runtime:** Node.js (ESM)
- **Framework:** Fastify v4
- **Payments:** Razorpay
- **Database:** Supabase
- **Validation:** Zod
- **Language:** TypeScript

## Getting Started

### Prerequisites

- Node.js >= 18
- A Razorpay account (Key ID + Secret)
- A Supabase project

### Install

```bash
npm install
```

### Configure

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `PORT` | Port to listen on (default: `3004`) |
| `NODE_ENV` | `development` or `production` |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `RAZORPAY_KEY_ID` | Razorpay API key ID |
| `RAZORPAY_KEY_SECRET` | Razorpay API key secret |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay webhook signing secret |

### Run

```bash
# Development (hot reload)
npm run dev

# Production
npm run build && npm start
```

## API

Base URL: `http://localhost:3004`

### Health Check

```
GET /health
```

Returns service status and timestamp.

---

### Create Order

```
POST /payments/order
```

Creates a Razorpay order for a booking. The shipper pays this amount into escrow.

**Body:**

```json
{
  "booking_id": "uuid",
  "amount": 1500,
  "shipper_id": "uuid"
}
```

`amount` is in INR. Razorpay receives it converted to paise.

**Response `201`:**

```json
{
  "success": true,
  "data": {
    "order_id": "rzp_order_id",
    "amount": 150000,
    "currency": "INR"
  }
}
```

---

### Razorpay Webhook

```
POST /payments/webhook
```

Receives Razorpay payment events. On `payment.captured`, updates payment status in Supabase and holds funds in escrow.

---

### Release Escrow

```
POST /payments/release
```

Called after delivery is confirmed. Initiates a Razorpay payout to the driver's registered bank account.

**Body:**

```json
{
  "booking_id": "uuid"
}
```

---

### Payment Status

```
GET /payments/status/:booking_id
```

Returns the current payment status for a booking.

## Project Structure

```
src/
  index.ts          # App bootstrap, plugin registration
  routes/
    payments.ts     # All payment endpoints
```
