# app/models/audit.py
# This file defines the SQLAlchemy 2.0 ORM model for AuditLogs.
# Audit logs store immutable records of critical state changes and business events.

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class AuditLog(Base):
    """
    Tracks all changes and events across the domain (e.g. payment statuses, escrow releases, disputes).
    Serves as an immutable ledger of administrative and customer transactions.
    """

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    entity: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )
    entity_id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
    )
    action: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )
    payload: Mapped[dict | None] = mapped_column(
        JSON,
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
