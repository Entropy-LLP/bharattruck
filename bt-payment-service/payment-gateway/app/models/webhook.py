# app/models/webhook.py
# This file defines the SQLAlchemy 2.0 ORM model for incoming WebhookEvents.
# Logging webhook invocations supports gateway idempotency checks and debugging.

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum as SQLEnum, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base
from app.models.enums import PaymentProvider, WebhookState


class WebhookEvent(Base):
    """
    Registry for webhook triggers received from external gateways.
    Assures processed events can be tracked for idempotency, avoiding double-capture
    or duplicate billing execution runs.
    """

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    event_id: Mapped[str | None] = mapped_column(
        String(255),
        unique=True,
        nullable=True,
        index=True,
    )
    provider: Mapped[PaymentProvider] = mapped_column(
        SQLEnum(PaymentProvider),
        nullable=False,
    )
    event_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    payload: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
    )
    status: Mapped[WebhookState] = mapped_column(
        SQLEnum(WebhookState),
        default=WebhookState.RECEIVED,
        nullable=False,
    )
    processed: Mapped[bool] = mapped_column(
        default=False,
        nullable=False,
    )
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    processed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
