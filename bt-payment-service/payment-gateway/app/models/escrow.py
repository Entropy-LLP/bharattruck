# app/models/escrow.py
# This file defines the SQLAlchemy 2.0 ORM model for escrow transactions.
# Escrow transactions protect transporters and shippers until delivery verification (POD).

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Enum as SQLEnum, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import EscrowState
from app.models.mixins import TimestampMixin


class EscrowTransaction(Base, TimestampMixin):
    """
    Represents funds held in escrow for a payment.
    Ensures that transporter payments are held securely until Proof of Delivery (POD)
    is uploaded and verified. Supports state transitions including DISPUTED.
    """

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    payment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("payment.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    amount: Mapped[Decimal] = mapped_column(
        Numeric(10, 2),
        nullable=False,
    )
    state: Mapped[EscrowState] = mapped_column(
        SQLEnum(EscrowState),
        default=EscrowState.HELD,
        nullable=False,
    )
    released_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    released_by: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    # Relationships
    # Declared as a string reference to avoid circular imports.
    payment: Mapped["Payment"] = relationship("Payment", foreign_keys=[payment_id])
