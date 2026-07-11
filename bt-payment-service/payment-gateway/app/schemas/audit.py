# app/schemas/audit.py
# This file defines Pydantic validation schemas for AuditLogs.

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class AuditLogBase(BaseModel):
    """
    Shared attributes for Audit logs.
    """

    entity: str = Field(
        ..., description="Affected system domain (e.g. payment, escrow)"
    )
    entity_id: str = Field(
        ..., description="Unique ID matching the target entity record"
    )
    action: str = Field(
        ..., description="Action log message (e.g. status_changed, release_failed)"
    )
    payload: dict[str, Any] | None = Field(
        None, description="Metadata captured during the event"
    )


class AuditLogCreate(AuditLogBase):
    """
    Schema used to create a new audit entry.
    """

    pass


class AuditLogResponse(AuditLogBase):
    """
    Response schema returning audit ledger records.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
