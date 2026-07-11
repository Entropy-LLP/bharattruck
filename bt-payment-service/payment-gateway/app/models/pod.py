# app/models/pod.py
# This file defines the SQLAlchemy 2.0 ORM model for Proof of Delivery (POD) events.
# These events log shipment completion status, serving as triggers for escrow releases.

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum as SQLEnum, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.enums import PodState
from app.models.mixins import TimestampMixin


class PodEvent(Base, TimestampMixin):
    """
    Represents a Proof of Delivery (POD) status update emitted by the Truck Management System.
    Once a shipment's POD is verified, it acts as a primary trigger to release the escrow hold.
    """

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    booking_id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
    )
    verified: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )
    verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    photo_url: Mapped[str | None] = mapped_column(
        String(1000),
        nullable=True,
    )
    state: Mapped[PodState] = mapped_column(
        SQLEnum(PodState),
        default=PodState.UPLOADED,
        nullable=False,
    )
