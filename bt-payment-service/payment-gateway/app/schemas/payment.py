# app/schemas/payment.py
# This file defines Pydantic validation schemas for Payment transactions.
# Enforces type constraints on inputs (Create/Update) and defines serialization fields for outputs (Response).

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import PaymentProvider, PaymentStatus


class PaymentBase(BaseModel):
    """
    Shared attributes for all Payment schemas.
    """

    booking_id: str = Field(..., description="ID matching the cargo/truck booking")
    amount: Decimal = Field(
        ..., gt=0, decimal_places=2, description="Payment value must be positive"
    )
    currency: str = Field(
        "INR", max_length=10, description="Three-letter currency designation"
    )


class PaymentCreate(PaymentBase):
    """
    Validation schema for creating a new Payment record.
    """

    provider: PaymentProvider = Field(
        PaymentProvider.RAZORPAY, description="Target payment processing gateway"
    )


class PaymentUpdate(BaseModel):
    """
    Validation schema for updating payment states or gateway identifiers.
    """

    status: PaymentStatus | None = None
    provider_order_id: str | None = None
    provider_payment_id: str | None = None


class PaymentResponse(PaymentBase):
    """
    Response schema serialized and returned by the API.
    """

    # Configures Pydantic v2 to load attributes directly from SQLAlchemy objects
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: PaymentStatus
    provider: PaymentProvider
    provider_order_id: str | None
    provider_payment_id: str | None
    created_at: datetime
    updated_at: datetime


class PaymentOrderResponse(BaseModel):
    """
    Standardized response returned specifically after successfully creating
    a gateway order with a provider.
    """

    payment_id: uuid.UUID
    provider_order_id: str
    amount: Decimal
    currency: str
    status: PaymentStatus


class PaymentOrderCreateRequest(BaseModel):
    """
    Validation schema for creating a payment order via client REST API.
    Decoupled from internal ORM models and provider enum configurations.
    """

    booking_id: str = Field(..., description="ID matching the cargo/truck booking")
    amount: Decimal = Field(
        ..., gt=0, decimal_places=2, description="Payment amount must be positive"
    )
    currency: str = Field(
        "INR", max_length=10, description="Three-letter ISO currency designation"
    )
