# app/services/payment_service.py
# This file implements the main business logic orchestrator for payment processing.
# It coordinates repositories and external providers using constructor dependency injection.

import logging
import uuid
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.exceptions import PaymentAlreadyExists, PaymentCreationFailed
from app.models.enums import PaymentStatus
from app.providers.payment_provider import PaymentProvider
from app.repositories.payment import PaymentRepository
from app.schemas.payment import PaymentCreate, PaymentOrderResponse, PaymentUpdate

logger = logging.getLogger(__name__)


class PaymentService:
    """
    Service layer orchestrating the payment workflows.
    Decoupled from specific repository or provider implementations via constructor dependency injection.
    """

    def __init__(
        self, payment_repo: PaymentRepository, provider: PaymentProvider
    ) -> None:
        self.payment_repo = payment_repo
        self.provider = provider

    def create_payment_order(
        self, db: Session, *, booking_id: str, amount: Decimal, currency: str = "INR"
    ) -> PaymentOrderResponse:
        """
        Initiates a payment order creation workflow.
        Checks for pre-existing captured payments, records local state,
        registers order with the provider, and logs status transitions.

        PRODUCTION SECURITY NOTE (TODO):
        In this MVP layout, we accept the 'amount' as a function parameter because the
        Booking Service doesn't exist yet. In a production environment, accepting pricing
        input from the API client is unsafe. The amount MUST instead be fetched directly
        from the Booking Service using the booking_id during the validation step to prevent
        price manipulation.
        """
        logger.info(
            f"Payment order creation started: booking_id='{booking_id}' amount={amount} currency='{currency}'"
        )

        # 1. Check if a payment already exists for this booking
        existing_payments = self.payment_repo.get_by_booking_id(db, booking_id)

        # 2. If an existing payment is already CAPTURED, raise a business conflict exception
        for payment in existing_payments:
            if payment.status == PaymentStatus.CAPTURED:
                logger.warning(
                    f"Payment order creation rejected: booking_id='{booking_id}' "
                    f"already has a CAPTURED transaction (payment_id='{payment.id}')"
                )
                raise PaymentAlreadyExists(
                    message=f"A captured payment already exists for booking: {booking_id}"
                )

        # 3. Create a local Payment record tracking the initial CREATED state
        payment_in = PaymentCreate(
            booking_id=booking_id,
            amount=amount,
            currency=currency,
            provider=self.provider.provider_type,
        )
        db_payment = self.payment_repo.create(db, obj_in=payment_in)
        logger.info(
            f"Local payment record initialized: payment_id='{db_payment.id}' status='{db_payment.status}'"
        )

        # 4. Generate a unique receipt reference using the booking ID
        receipt_id = f"BT_{booking_id}"

        # 5. Call the payment gateway provider to register the order
        try:
            logger.info(
                f"Requesting order registration from gateway: provider={self.provider.provider_type.value} "
                f"receipt='{receipt_id}'"
            )
            provider_order = self.provider.create_order(
                amount=amount, currency=currency, receipt=receipt_id
            )
            logger.info(
                f"Gateway order registered successfully: provider_order_id='{provider_order.provider_order_id}'"
            )
        except Exception as e:
            # If provider creation fails, update local state to FAILED and persist before raising error
            logger.error(
                f"Gateway order creation failed for payment_id='{db_payment.id}': {e}",
                exc_info=True,
            )
            self.payment_repo.update(
                db, db_obj=db_payment, obj_in={"status": PaymentStatus.FAILED}
            )
            raise PaymentCreationFailed(
                message=f"Failed to establish payment order with provider: {e!s}"
            ) from e

        # 6. Save the provider order ID and transition the payment status to INITIATED
        update_in = PaymentUpdate(
            status=PaymentStatus.INITIATED,
            provider_order_id=provider_order.provider_order_id,
        )
        self.payment_repo.update(db, db_obj=db_payment, obj_in=update_in)
        logger.info(
            f"Payment record updated: payment_id='{db_payment.id}' "
            f"provider_order_id='{db_payment.provider_order_id}' status='{db_payment.status}'"
        )

        # 8. Return response object
        return PaymentOrderResponse(
            payment_id=db_payment.id,
            provider_order_id=db_payment.provider_order_id,
            amount=db_payment.amount,
            currency=db_payment.currency,
            status=db_payment.status,
        )

    def get_payment_by_id(self, db: Session, payment_id: uuid.UUID) -> object | None:
        """
        Retrieves a single payment transaction by its primary key ID.
        Delegates queries to the underlying PaymentRepository.
        """
        logger.info(f"Retrieving payment by ID: payment_id='{payment_id}'")
        return self.payment_repo.get(db, payment_id)

    def get_payments_by_booking_id(self, db: Session, booking_id: str) -> list:
        """
        Retrieves all payment transactions associated with a specific booking.
        Delegates queries to the underlying PaymentRepository.
        """
        logger.info(f"Retrieving payments by booking ID: booking_id='{booking_id}'")
        # Ensure returned object is a list of Payments
        return list(self.payment_repo.get_by_booking_id(db, booking_id))
