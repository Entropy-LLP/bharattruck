# app/repositories/escrow.py
# This file implements database CRUD operations for the EscrowTransaction model.

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import EscrowState
from app.models.escrow import EscrowTransaction
from app.repositories.base import BaseRepository
from app.schemas.escrow import EscrowCreate, EscrowUpdate


class EscrowRepository(BaseRepository[EscrowTransaction, EscrowCreate, EscrowUpdate]):
    """
    Repository subclass implementing EscrowTransaction-specific database operations.
    """

    def __init__(self) -> None:
        super().__init__(EscrowTransaction)

    def get_by_payment_id(
        self, db: Session, payment_id: uuid.UUID
    ) -> EscrowTransaction | None:
        """
        Retrieve the escrow transaction associated with a specific payment record.
        """
        query = select(self.model).where(self.model.payment_id == payment_id)
        return db.scalars(query).first()

    def get_by_state(self, db: Session, state: EscrowState) -> list[EscrowTransaction]:
        """
        Retrieve all escrow transactions currently matching a target state (e.g. HELD, DISPUTED).
        """
        query = select(self.model).where(self.model.state == state)
        return list(db.scalars(query).all())


# Instantiated repository to inject across services
escrow_repo = EscrowRepository()
