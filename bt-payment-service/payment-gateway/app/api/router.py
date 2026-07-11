# app/api/router.py
# This file serves as the centralized router registry.
# It aggregates individual routers (endpoints, versions) before they are attached to the FastAPI application.

from fastapi import APIRouter

from app.api import escrow, payments, pod, webhooks
from app.api.v1.endpoints import health

api_router = APIRouter()

# Mount health and system checks at root level.
api_router.include_router(health.router, tags=["System"])

# Mount payments endpoints router.
api_router.include_router(payments.router)

# Mount webhooks endpoints router.
api_router.include_router(webhooks.router)

# Mount pod endpoints router.
api_router.include_router(pod.router)

# Mount escrow endpoints router.
api_router.include_router(escrow.router)
