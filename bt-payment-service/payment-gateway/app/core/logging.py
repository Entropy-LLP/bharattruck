# app/core/logging.py
# This file sets up structured logging for the application.
# It configures the standard logging module to output structured JSON in production (which allows
# easier parsing by log aggregators like ELK, Datadog, CloudWatch) and text formatting in development.

import logging
import logging.config

from app.core.config import settings


def setup_logging() -> None:
    """
    Initializes standard logging using dictConfig.
    Adapts the output format based on application configuration (JSON vs text).
    """
    log_level = settings.LOG_LEVEL.upper()
    log_format_type = settings.LOG_FORMAT.lower()

    # Define standard formatters
    if log_format_type == "json":
        formatter_class = "pythonjsonlogger.jsonlogger.JsonFormatter"
        # In python-json-logger, the format specifies the list of attributes to include in the JSON log record.
        formatter_format = (
            "%(asctime)s %(levelname)s %(name)s %(message)s %(filename)s %(lineno)d"
        )
    else:
        formatter_class = "logging.Formatter"
        formatter_format = "%(asctime)s [%(levelname)s] %(name)s (%(filename)s:%(lineno)d): %(message)s"

    logging_config = {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "default": {
                "()": formatter_class,
                "format": formatter_format,
                "datefmt": "%Y-%m-%dT%H:%M:%S",
            }
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "formatter": "default",
                "stream": "ext://sys.stdout",
            }
        },
        "root": {
            "level": log_level,
            "handlers": ["console"],
        },
        "loggers": {
            # Standardize FastAPI / Uvicorn server logs to use our structured logging config
            "uvicorn": {
                "level": "INFO",
                "handlers": ["console"],
                "propagate": False,
            },
            "uvicorn.error": {
                "level": "INFO",
                "handlers": ["console"],
                "propagate": False,
            },
            "uvicorn.access": {
                "level": "INFO",
                "handlers": ["console"],
                "propagate": False,
            },
            # SQL Engine logs (useful to trace raw queries when log_level is set to DEBUG)
            "sqlalchemy.engine": {
                "level": "WARNING",
                "handlers": ["console"],
                "propagate": False,
            },
        },
    }

    logging.config.dictConfig(logging_config)
