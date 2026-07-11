# app/schemas/escrow.py
# This file defines Pydantic validation schemas for Escrow transactions.

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import EscrowState


class EscrowBase(BaseModel):
    """
    Shared attributes for Escrow transactions.
    """

    payment_id: uuid.UUID = Field(
        ..., description="ID matching the core payment record"
    )
    amount: Decimal = Field(
        ..., gt=0, decimal_places=2, description="Escrow balance must be positive"
    )


class EscrowCreate(EscrowBase):
    """
    Schema used to create a new Escrow transaction record.
    """

    state: EscrowState = Field(
        EscrowState.HELD, description="Initial state of the escrow hold"
    )


class EscrowUpdate(BaseModel):
    """
    Schema used to execute transitions (e.g. releasing funds, logging disputes).
    """

    state: EscrowState | None = None
    released_at: datetime | None = None
    released_by: str | None = None


class EscrowResponse(EscrowBase):
    """
    Response schema returning escrow details.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    state: EscrowState
    released_at: datetime | None
    released_by: str | None
    created_at: datetime
    updated_at: datetime
