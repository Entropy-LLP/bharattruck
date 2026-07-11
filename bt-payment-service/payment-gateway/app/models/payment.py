# app/models/payment.py
# This file defines the SQLAlchemy 2.0 ORM model for payments.
# It tracks the payment lifecycle from booking matching to final capture.

import uuid
from decimal import Decimal

from sqlalchemy import Enum as SQLEnum, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.enums import PaymentProvider, PaymentStatus
from app.models.mixins import TimestampMixin


class Payment(Base, TimestampMixin):
    """
    Represents a payment transaction associated with a Truck booking.

    ARCHITECTURAL NOTE ON PAYMENT RETRIES:
    This model supports single-attempt payments for MVP. If the business requires
    multiple payment attempts per booking (e.g. user retries a failed transaction),
    a new `PaymentAttempt` table should be introduced with a foreign key to this model
    (e.g., PaymentAttempt.payment_id -> Payment.id).
    This would allow tracking multiple gateway attempt IDs and webhook payloads
    without altering the base Payment-to-Booking relationship structure.
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
    amount: Mapped[Decimal] = mapped_column(
        Numeric(10, 2),
        nullable=False,
    )
    currency: Mapped[str] = mapped_column(
        String(10),
        default="INR",
        nullable=False,
    )
    status: Mapped[PaymentStatus] = mapped_column(
        SQLEnum(PaymentStatus),
        default=PaymentStatus.CREATED,
        nullable=False,
    )
    provider: Mapped[PaymentProvider] = mapped_column(
        SQLEnum(PaymentProvider),
        default=PaymentProvider.RAZORPAY,
        nullable=False,
    )
    provider_order_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        index=True,
    )
    provider_payment_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        index=True,
    )
