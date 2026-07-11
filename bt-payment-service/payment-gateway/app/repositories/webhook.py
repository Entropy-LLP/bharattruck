# app/repositories/webhook.py
# This file implements database CRUD operations for the WebhookEvent model.


from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.webhook import WebhookEvent
from app.repositories.base import BaseRepository
from app.schemas.webhook import WebhookEventCreate, WebhookEventUpdate


class WebhookRepository(
    BaseRepository[WebhookEvent, WebhookEventCreate, WebhookEventUpdate]
):
    """
    Repository subclass implementing WebhookEvent-specific database operations.
    Supports duplicate checks to avoid double processing.
    """

    def __init__(self) -> None:
        super().__init__(WebhookEvent)

    def get_by_provider_event(
        self,
        db: Session,
        provider: str,
        event_name: str,
        skip: int = 0,
        limit: int = 100,
    ) -> list[WebhookEvent]:
        """
        Retrieve webhook logs matching a provider and event classification.
        """
        query = (
            select(self.model)
            .where(self.model.provider == provider, self.model.event_name == event_name)
            .offset(skip)
            .limit(limit)
        )
        return list(db.scalars(query).all())

    def get_by_event_id(self, db: Session, event_id: str) -> WebhookEvent | None:
        """
        Retrieve a webhook log entry matching the unique provider-defined event ID.
        """
        query = select(self.model).where(self.model.event_id == event_id)
        return db.scalars(query).first()


# Instantiated repository to inject across services
webhook_repo = WebhookRepository()
