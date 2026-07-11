# app/core/exceptions.py
# This file sets up global exception handling to catch, log, and format errors into a uniform JSON structure.
# It ensures that no raw stack traces leak to callers in production and that error logs are captured properly.

import logging
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings

logger = logging.getLogger(__name__)


class AppException(Exception):
    """
    Base exception class for all custom application errors.
    Allows passing standard error messages, HTTP status codes, and optional debug details.
    """

    def __init__(
        self,
        message: str,
        status_code: int = status.HTTP_400_BAD_REQUEST,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.details = details or {}


class ResourceNotFound(AppException):
    """
    Exception raised when a requested resource (e.g. payment, escrow, POD) is not found.
    Maps to HTTP 404 Not Found.
    """

    def __init__(
        self, message: str = "Resource not found", details: dict[str, Any] | None = None
    ) -> None:
        super().__init__(
            message, status_code=status.HTTP_404_NOT_FOUND, details=details
        )


class InvalidStateTransition(AppException):
    """
    Exception raised when a business operation is attempted on an entity in an invalid state.
    Maps to HTTP 400 Bad Request.
    """

    def __init__(
        self,
        message: str = "Invalid state transition or business rule violation",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            message, status_code=status.HTTP_400_BAD_REQUEST, details=details
        )


class ConflictError(AppException):
    """
    Exception raised when a request conflicts with the current state of a resource.
    Maps to HTTP 409 Conflict.
    """

    def __init__(
        self,
        message: str = "Resource state conflict",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message, status_code=status.HTTP_409_CONFLICT, details=details)


class DatabaseException(AppException):
    """
    Custom exception for database layer failures, default status code is 500 (Internal Server Error).
    """

    def __init__(
        self,
        message: str = "Database transaction failed",
        status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message, status_code, details)


class PaymentAlreadyExists(AppException):
    """
    Exception raised when a payment is already captured for the associated booking ID.
    """

    def __init__(
        self,
        message: str = "A captured payment already exists for this booking",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message, status_code=status.HTTP_409_CONFLICT, details=details)


class PaymentCreationFailed(AppException):
    """
    Exception raised when payment creation fails (e.g. gateway client network errors).
    """

    def __init__(
        self,
        message: str = "Failed to create payment order with provider",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            message, status_code=status.HTTP_400_BAD_REQUEST, details=details
        )


class BookingNotEligible(AppException):
    """
    Exception raised when a booking state is not eligible for payment.
    """

    def __init__(
        self,
        message: str = "This booking is not eligible for payment",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            message, status_code=status.HTTP_400_BAD_REQUEST, details=details
        )


class WebhookSignatureVerificationFailed(AppException):
    """
    Exception raised when Razorpay webhook signature verification fails.
    Maps to HTTP 401 Unauthorized.
    """

    def __init__(
        self,
        message: str = "Webhook signature verification failed",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            message, status_code=status.HTTP_401_UNAUTHORIZED, details=details
        )


class PaymentVerificationFailed(AppException):
    """
    Exception raised when checkout/payment signature verification fails.
    Maps to HTTP 400 Bad Request.
    """

    def __init__(
        self,
        message: str = "Payment signature verification failed",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            message, status_code=status.HTTP_400_BAD_REQUEST, details=details
        )


def setup_exception_handlers(app: FastAPI) -> None:
    """
    Registers global exception handlers to intercept errors raised inside the FastAPI lifecycle.
    """

    @app.exception_handler(AppException)
    async def app_exception_handler(
        request: Request, exc: AppException
    ) -> JSONResponse:
        """
        Catches custom domain and application-specific exceptions.
        """
        logger.warning(
            f"Domain Exception on {request.method} {request.url.path}: "
            f"Message='{exc.message}' Status={exc.status_code} Details={exc.details}"
        )
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "status": "error",
                "message": exc.message,
                "details": exc.details,
                "service": "payment-service",
            },
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        """
        Catches Pydantic schema validation failures for request parameters, query arguments, or request body.
        """
        errors = exc.errors()
        # Clean up the validation error fields for user presentation
        formatted_details = []
        for err in errors:
            formatted_details.append(
                {"loc": err.get("loc"), "msg": err.get("msg"), "type": err.get("type")}
            )

        logger.warning(
            f"Validation Error on {request.method} {request.url.path}: "
            f"errors={formatted_details}"
        )
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "status": "error",
                "message": "Request validation failed",
                "details": formatted_details,
                "service": "payment-service",
            },
        )

    @app.exception_handler(SQLAlchemyError)
    async def database_error_handler(
        request: Request, exc: SQLAlchemyError
    ) -> JSONResponse:
        """
        Catches generic SQLAlchemy ORM exceptions.
        """
        logger.exception(
            f"Database error occurred during request {request.method} {request.url.path}"
        )

        # Hide detailed database tables/errors from client in production
        details = {}
        if settings.DEBUG:
            details = {"error_type": exc.__class__.__name__, "message": str(exc)}

        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "status": "error",
                "message": "A database transaction error occurred. Please try again later.",
                "details": details,
                "service": "payment-service",
            },
        )

    @app.exception_handler(Exception)
    async def fallback_exception_handler(
        request: Request, exc: Exception
    ) -> JSONResponse:
        """
        Ultimate fallback catcher for unhandled generic system, OS, or runtime exceptions.
        """
        logger.exception(
            f"Unhandled exception caught: {request.method} {request.url.path}"
        )

        details = {}
        if settings.DEBUG:
            details = {"error_type": exc.__class__.__name__, "message": str(exc)}

        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "status": "error",
                "message": "An unexpected server error occurred.",
                "details": details,
                "service": "payment-service",
            },
        )
