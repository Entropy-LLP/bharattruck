# app/main.py
# This is the main entry point of the BharatTruck Payment Service FastAPI application.
# It handles lifecycle events (lifespan), configures global middlewares (CORS, logging),
# registers global exception handlers, and mounts the central API routing tree.

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import settings
from app.core.exceptions import setup_exception_handlers
from app.core.logging import setup_logging
from app.middleware.logging import RequestLoggingMiddleware

# Run structured logging setup before initializing the FastAPI application
setup_logging()
logger = logging.getLogger("app.main")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Asynchronous lifespan manager handling startup and shutdown events.
    Verifies db pool setup on startup and disposes connections on shutdown.
    """
    logger.info("Starting up Payment Service microservice lifecycle...")

    # Verify DB connectivity on startup
    from app.db.session import engine

    try:
        # Obtain a connection to verify active Postgres database connectivity
        with engine.connect() as connection:
            logger.info("Successfully established connection to PostgreSQL database.")
    except Exception as e:
        logger.error(
            f"Database connection verification failed on startup: {e}. "
            f"Please ensure PostgreSQL is running at {settings.DB_HOST}:{settings.DB_PORT}"
        )
        # We do not crash the service here, allowing it to retry/reconnect dynamically during runtime.

    yield

    # Clean shutdown tasks
    logger.info("Shutting down Payment Service microservice. Cleaning up resources...")
    try:
        engine.dispose()
        logger.info("Database connection engine disposed successfully.")
    except Exception as e:
        logger.error(f"Error while disposing database connection pool: {e}")

    logger.info("Payment Service microservice shutdown sequence finished.")


# FastAPI Application instance
app = FastAPI(
    title=settings.PROJECT_NAME,
    description=(
        "Production-ready standalone Payment Service microservice for BharatTruck. "
        "Coordinates core payment lifecycles, webhook signature verifications, "
        "cargo Proof of Delivery (POD) confirmations, and secure, idempotent escrow holds and releases."
    ),
    version="1.0.0",
    docs_url=settings.API_V1_STR + "/docs" if settings.DEBUG else None,
    redoc_url=settings.API_V1_STR + "/redoc" if settings.DEBUG else None,
    openapi_url=settings.API_V1_STR + "/openapi.json" if settings.DEBUG else None,
    lifespan=lifespan,
    contact={
        "name": "BharatTruck Platform Engineering",
        "email": "engineering@bharattruck.com",
    },
    license_info={
        "name": "Proprietary",
    },
)


# 1. CORS Middleware configuration
if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    logger.info(f"CORS origins configured: {settings.cors_origins}")
else:
    logger.warning(
        "CORS has not been configured. All cross-origin requests might be blocked."
    )

# 2. Structured Request Logging Middleware
app.add_middleware(RequestLoggingMiddleware)

# 3. Global Exception Handler setup
setup_exception_handlers(app)

# 4. Mount API Routes
app.include_router(api_router)
