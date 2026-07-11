# app/schemas/pod.py
# This file defines Pydantic validation schemas for Proof of Delivery (POD) events.

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import PodState


class PodEventBase(BaseModel):
    """
    Shared attributes for Proof of Delivery events.
    """

    booking_id: str = Field(..., description="ID matching the cargo booking")
    photo_url: str | None = Field(
        None,
        max_length=1000,
        description="Optional photo URL of the signed invoice/cargo",
    )


class PodEventCreate(PodEventBase):
    """
    Schema used to write incoming POD notifications.
    """

    verified: bool = Field(
        False, description="Verification state of the uploaded photo"
    )
    verified_at: datetime | None = Field(
        None, description="Timestamp indicating when the POD was reviewed"
    )
    state: PodState = Field(
        PodState.UPLOADED,
        description="State representing the Proof of Delivery lifecycle",
    )


class PodEventUpdate(BaseModel):
    """
    Schema used to update verification states.
    """

    verified: bool | None = None
    verified_at: datetime | None = None
    photo_url: str | None = None
    state: PodState | None = None


class PodEventResponse(PodEventBase):
    """
    Response schema returning POD statuses.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    verified: bool
    verified_at: datetime | None
    state: PodState
    created_at: datetime
    updated_at: datetime
