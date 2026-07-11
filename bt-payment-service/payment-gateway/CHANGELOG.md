# Changelog

All notable changes to the BharatTruck Payment Service will be documented in this file.

---

## [1.0.0] - 2026-07-09

This is the initial release of the BharatTruck Payment Service microservice. It implements the entire payment lifecycle, webhook integrations, proof of delivery processing, and secure escrow management.

### Completed Features

#### 1. Core Payments & Order Handling
- **Order Creation API**: Exposes endpoints to register a cargo booking for payment, establishing local database state.
- **Razorpay Integration**: Abstraction of payment gateway transactions, mapping amounts and currencies, and registering order payloads.
- **Signature Verification**: Checkout signature verification routines validating client-side integration authenticity.

#### 2. Webhooks & Idempotency
- **Durable Webhook Receiver**: Listens to Razorpay payment notification event webhooks.
- **Signature Security**: Custom middleware verify incoming gateway webhook signatures using cryptographic secrets.
- **Idempotency Manager**: Durable database logging (`webhook_event` table) prevents reprocessing duplicate webhooks.

#### 3. Escrow Transaction Management
- **Automatic Escrow Hold**: Instantly puts captured payments into an escrow `HELD` state to protect shipper and transporter interests.
- **Idempotent Release API**: Exposes endpoints to release held funds to the transporter, ensuring multiple triggers safely return the existing released record.
- **Audit Logging**: Integrates with the `AuditLog` ledger to automatically capture escrow holds and releases.
- **Auditable Field**: Added a nullable `released_by` field tracking release authorities (e.g. system, admin ID).

#### 4. Proof of Delivery (POD) Workflows
- **Multiple POD Uploads**: Allows transporters to upload cargo confirmation slips multiple times for audit/history.
- **Single Verified POD Gate**: Enforces that only one POD can be in `VERIFIED` state for a booking. Attempting to verify another raises a strict HTTP 409 Conflict.
- **Escrow Decoupling**: Ensures POD verification and Escrow release remain decoupled at the service layer to prevent automatic, unverified payouts.

#### 5. Configuration & Observability
- **Fail-Fast Boot**: App validates core environment configurations (e.g. valid logs, environments, and credentials) and crashes immediately if values are invalid.
- **Structured Health Probes**: `/health` endpoint returns liveness, database connection viability, environment settings, and application version.

#### 6. Test Suite
- **Comprehensive Coverage**: 28 automated test cases verifying repositories (CRUD), service logic (rules, idempotency), and REST API routes using an in-memory SQLite database.
