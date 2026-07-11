# app/models/mixins.py
# This file contains reusable SQLAlchemy class mixins.
# The TimestampMixin automatically decorates tables with audit timestamps.

from datetime import datetime

from sqlalchemy import DateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func


class TimestampMixin:
    """
    Mixin adding standardized, timezone-aware creation and modification timestamps.
    Automatically managed by the database server lifecycle triggers.
    """

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
