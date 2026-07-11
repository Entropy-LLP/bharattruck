# app/db/session.py
# This file initializes the SQLAlchemy 2.0 engine and SessionLocal factory.
# It sets up connection pooling configurations suitable for PostgreSQL in a production microservice.

import logging

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings

logger = logging.getLogger(__name__)

# Configure DB engine. SQLite does not support standard connection pooling parameters like pool_size.
database_url = settings.get_database_url

if database_url.startswith("sqlite"):
    engine = create_engine(
        database_url,
        connect_args={"check_same_thread": False},
    )
    logger.info("SQLAlchemy engine initialized with SQLite.")
else:
    engine = create_engine(
        database_url,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
        pool_recycle=1800,
    )
    logger.info("SQLAlchemy engine initialized with PostgreSQL connection pooling.")

# Thread-safe Session factory
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)
