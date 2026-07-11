# app/repositories/pod.py
# This file implements database CRUD operations for the PodEvent model.


from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import PodState
from app.models.pod import PodEvent
from app.repositories.base import BaseRepository
from app.schemas.pod import PodEventCreate, PodEventUpdate


class PodRepository(BaseRepository[PodEvent, PodEventCreate, PodEventUpdate]):
    """
    Repository subclass implementing PodEvent-specific database operations.
    """

    def __init__(self) -> None:
        super().__init__(PodEvent)

    def get_by_booking_id(self, db: Session, booking_id: str) -> PodEvent | None:
        """
        Retrieve the Proof of Delivery event record logged for a booking ID.
        """
        query = select(self.model).where(self.model.booking_id == booking_id)
        return db.scalars(query).first()

    def get_all_by_booking_id(self, db: Session, booking_id: str) -> list[PodEvent]:
        """
        Retrieve all Proof of Delivery event records logged for a booking ID.
        """
        query = select(self.model).where(self.model.booking_id == booking_id)
        return list(db.scalars(query).all())

    def get_active_by_booking_id(self, db: Session, booking_id: str) -> PodEvent | None:
        """
        Retrieve the active (VERIFIED) Proof of Delivery event record for a booking ID.
        """
        query = select(self.model).where(
            self.model.booking_id == booking_id, self.model.state == PodState.VERIFIED
        )
        return db.scalars(query).first()


# Instantiated repository to inject across services
pod_repo = PodRepository()
