# app/repositories/audit.py
# This file implements database CRUD operations for the AuditLog model.


from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.audit import AuditLog
from app.repositories.base import BaseRepository
from app.schemas.audit import AuditLogCreate


class AuditLogUpdate(BaseModel):
    """
    Dummy update schema since AuditLogs are typically write-once append logs.
    """

    pass


class AuditRepository(BaseRepository[AuditLog, AuditLogCreate, AuditLogUpdate]):
    """
    Repository subclass implementing AuditLog-specific database operations.
    """

    def __init__(self) -> None:
        super().__init__(AuditLog)

    def get_by_entity(self, db: Session, entity: str, entity_id: str) -> list[AuditLog]:
        """
        Retrieve all audit logs related to a specific entity type and ID (e.g. payment, escrow).
        Orders the logs chronologically by creation timestamp.
        """
        query = (
            select(self.model)
            .where(self.model.entity == entity, self.model.entity_id == entity_id)
            .order_by(self.model.created_at.desc())
        )
        return list(db.scalars(query).all())


# Instantiated repository to inject across services
audit_repo = AuditRepository()
