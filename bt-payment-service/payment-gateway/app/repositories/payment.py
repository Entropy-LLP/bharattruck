# app/repositories/payment.py
# This file implements database CRUD operations for the Payment model.


from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.payment import Payment
from app.repositories.base import BaseRepository
from app.schemas.payment import PaymentCreate, PaymentUpdate


class PaymentRepository(BaseRepository[Payment, PaymentCreate, PaymentUpdate]):
    """
    Repository subclass implementing Payment-specific database operations.
    """

    def __init__(self) -> None:
        super().__init__(Payment)

    def get_by_booking_id(self, db: Session, booking_id: str) -> list[Payment]:
        """
        Retrieve all payment transactions associated with a booking.
        """
        query = select(self.model).where(self.model.booking_id == booking_id)
        return list(db.scalars(query).all())

    def get_by_provider_order_id(
        self, db: Session, provider_order_id: str
    ) -> Payment | None:
        """
        Retrieve a payment record by its third-party provider order ID (e.g. Razorpay Order ID).
        """
        query = select(self.model).where(
            self.model.provider_order_id == provider_order_id
        )
        return db.scalars(query).first()

    def get_by_provider_payment_id(
        self, db: Session, provider_payment_id: str
    ) -> Payment | None:
        """
        Retrieve a payment record by its third-party provider payment ID.
        """
        query = select(self.model).where(
            self.model.provider_payment_id == provider_payment_id
        )
        return db.scalars(query).first()


# Instantiated repository to inject across services
payment_repo = PaymentRepository()
