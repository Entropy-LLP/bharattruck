# app/middleware/logging.py
# This file defines a middleware that intercepts all incoming requests to log their method,
# path, processing duration, and response status code.

import logging
import time
from collections.abc import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """
    Middleware to log request/response cycles for audit trails and performance tracking.
    Logs HTTP method, target path, execution time, and status code.
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        start_time = time.perf_counter()
        client_ip = request.client.host if request.client else "unknown"

        # Log incoming request metadata
        logger.info(
            f"HTTP Request started: {request.method} {request.url.path} - Client: {client_ip}"
        )

        try:
            # Proceed to compile the response
            response = await call_next(request)
            process_time = (time.perf_counter() - start_time) * 1000

            # Log standard response success
            logger.info(
                f"HTTP Request completed: {request.method} {request.url.path} -> "
                f"Status: {response.status_code} | Latency: {process_time:.2f}ms"
            )
            return response

        except Exception as e:
            process_time = (time.perf_counter() - start_time) * 1000
            # Log failure details before letting global exception handlers catch the exception
            logger.error(
                f"HTTP Request failed: {request.method} {request.url.path} -> "
                f"Error: {e.__class__.__name__} | Latency: {process_time:.2f}ms"
            )
            raise
