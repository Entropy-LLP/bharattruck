# app/schemas/webhook.py
# This file defines Pydantic validation schemas for incoming WebhookEvents.

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import PaymentProvider, WebhookState


class WebhookEventBase(BaseModel):
    """
    Shared attributes for Webhook events.
    """

    provider: PaymentProvider = Field(
        ..., description="Gateway provider emitting the webhook"
    )
    event_name: str = Field(
        ..., description="Gateway-defined event descriptor (e.g. payment.captured)"
    )
    payload: dict[str, Any] = Field(
        ..., description="Raw JSON data received in the request body"
    )
    event_id: str | None = Field(
        None, description="Unique event identifier from the provider"
    )


class WebhookEventCreate(WebhookEventBase):
    """
    Schema for registry log creation.
    """

    processed: bool = Field(
        False, description="Indicates whether the payload has been evaluated"
    )
    status: WebhookState = Field(
        WebhookState.RECEIVED,
        description="Durable processing status of the webhook event",
    )


class WebhookEventUpdate(BaseModel):
    """
    Schema used to flag processed state changes.
    """

    processed: bool | None = None
    status: WebhookState | None = None
    processed_at: datetime | None = None


class WebhookEventResponse(WebhookEventBase):
    """
    Response schema returning webhook logs.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    processed: bool
    status: WebhookState
    received_at: datetime
    processed_at: datetime | None
