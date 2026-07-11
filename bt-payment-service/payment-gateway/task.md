# Task List - BharatTruck Payment Service Setup

## Sprint 1: Foundation (Completed)
- [x] Create base configuration & environment setup (.env.example, pyproject.toml, .gitignore, requirements.txt)
- [x] Create core settings, logging, and exceptions (app/core/config.py, app/core/logging.py, app/core/exceptions.py)
- [x] Create database connection settings and base model (app/db/session.py, app/db/base.py, app/db/dependencies.py)
- [x] Create API routes and middleware (app/middleware/logging.py, app/api/v1/endpoints/health.py, app/api/router.py, app/main.py)
- [x] Initialize alembic migrations and setup (alembic.ini, alembic/env.py, etc.)
- [x] Create Docker setup (Dockerfile, docker-compose.yml)
- [x] Create README.md & Package __init__.py files
- [x] Add basic tests and verify code structure (tests/conftest.py, tests/test_api.py)

## Sprint 2: The Payment Domain (Completed)
- [x] Create shared domain enums (app/models/enums.py)
- [x] Create domain SQLAlchemy 2.0 models (payment, escrow, pod, webhook, audit)
- [x] Create Pydantic validation schemas (schemas/*.py)
- [x] Create generic BaseRepository and custom repositories (repositories/*.py)
- [x] Connect models to db/base.py registry
- [x] Generate and run Alembic database migrations
- [x] Create repository integration tests and run test verification

## Sprint 3: Payment Provider & Service Layer (Completed)
- [x] Install Razorpay SDK and add settings for key/secret
- [x] Create abstract PaymentProvider (app/providers/payment_provider.py)
- [x] Create RazorpayProvider wrapper (app/providers/razorpay_provider.py)
- [x] Implement Payment-specific exceptions (app/core/exceptions.py)
- [x] Create PaymentService (app/services/payment_service.py) with DI
- [x] Add Dependency Injection providers for repository, provider, and service
- [x] Implement unit tests for PaymentService with mocks (tests/test_services.py)

## Sprint 4: REST API Exposure (Completed)
- [x] Create Pydantic request model PaymentOrderCreateRequest
- [x] Extend PaymentService with retrieval delegation methods
- [x] Create API router app/api/payments.py with endpoints
- [x] Register payments router in app/api/router.py
- [x] Write API integration tests in tests/test_api_payments.py

## Sprint 5: Webhooks & Idempotency (Completed)
- [x] Add WebhookState enum and update WebhookEvent model
- [x] Generate and run database migrations for webhook changes
- [x] Add RAZORPAY_WEBHOOK_SECRET to config and settings
- [x] Implement signature verification in PaymentProvider and RazorpayProvider
- [x] Create centralized event mapper (app/core/payment_event_mapper.py)
- [x] Create WebhookService (app/services/webhook_service.py) with durable flows
- [x] Create API router app/api/webhooks.py with POST /webhooks/razorpay
- [x] Write integration tests in tests/test_api_webhooks.py
