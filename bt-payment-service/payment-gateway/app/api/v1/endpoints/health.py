# app/api/v1/endpoints/health.py
# This file contains system endpoints used for service discovery, container status monitoring,
# and routing health verifications.

import logging
from typing import Any

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session
from sqlalchemy.sql import text

from app.core.config import settings
from app.db.dependencies import get_db

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/", status_code=status.HTTP_200_OK)
def read_root() -> dict[str, str]:
    """
    Root endpoint that returns service identifier and environment information.
    Useful for checking if the microservice is reachable.
    """
    return {
        "service": settings.PROJECT_NAME,
        "environment": settings.ENV,
        "version": "1.0.0",
        "docs_url": "/docs" if settings.DEBUG else "hidden",
    }


@router.get(
    "/health",
    status_code=status.HTTP_200_OK,
    summary="Get service health status",
    description="Returns structured health info verifying service liveness and active database connectivity.",
)
def health_check(response: Response, db: Session = Depends(get_db)) -> dict[str, Any]:
    """
    Structured health check verifying app liveness, current env, version, and database status.
    Returns HTTP 503 if database connectivity fails.
    """
    health_info = {
        "status": "healthy",
        "service": "payment-service",
        "version": "1.0.0",
        "environment": settings.ENV,
        "database": {"status": "connected"},
    }
    try:
        # Execute a cheap, dummy query to verify database connection viability
        db.execute(text("SELECT 1"))
    except Exception as e:
        logger.error(
            f"Health check failed due to database connectivity error: {e}",
            exc_info=True,
        )
        health_info["status"] = "degraded"
        health_info["database"] = {"status": "disconnected", "error": str(e)}
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return health_info
