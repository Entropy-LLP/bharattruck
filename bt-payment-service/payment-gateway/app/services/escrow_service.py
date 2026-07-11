# app/services/escrow_service.py
# This file implements the Escrow Service coordinating creation, retrieval, condition verification,
# and release of escrow transactions, logging audit trails for every state transition.

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.core.exceptions import InvalidStateTransition, ResourceNotFound
from app.models.enums import EscrowState, PaymentStatus
from app.models.escrow import EscrowTransaction
from app.repositories.audit import AuditRepository
from app.repositories.escrow import EscrowRepository
from app.repositories.payment import PaymentRepository
from app.schemas.audit import AuditLogCreate
from app.services.pod_service import PodService

logger = logging.getLogger(__name__)


class EscrowService:
    """
    Service layer orchestrating the Escrow workflows.
    Decoupled via constructor dependency injection.
    """

    def __init__(
        self,
        escrow_repo: EscrowRepository,
        payment_repo: PaymentRepository,
        pod_service: PodService,
        audit_repo: AuditRepository,
    ) -> None:
        self.escrow_repo = escrow_repo
        self.payment_repo = payment_repo
        self.pod_service = pod_service
        self.audit_repo = audit_repo

    def create_escrow(self, db: Session, payment_id: uuid.UUID) -> EscrowTransaction:
        """
        Idempotently creates a new Escrow transaction record when a Payment is CAPTURED.
        Only one escrow may exist per payment.
        """
        logger.info(f"Request to create escrow: payment_id='{payment_id}'")

        # 1. Idempotency check: Return existing escrow if it already exists
        existing_escrow = self.escrow_repo.get_by_payment_id(db, payment_id)
        if existing_escrow:
            logger.info(
                f"Escrow transaction already exists for payment_id='{payment_id}'. Returning safely."
            )
            return existing_escrow

        # 2. Fetch payment details
        payment = self.payment_repo.get(db, payment_id)
        if not payment:
            logger.warning(
                f"Escrow creation rejected: payment_id='{payment_id}' not found"
            )
            raise ResourceNotFound(message=f"Payment record not found: {payment_id}")

        # 3. Validate payment is captured
        if payment.status != PaymentStatus.CAPTURED:
            logger.warning(
                f"Escrow creation rejected: payment status is '{payment.status.value}' (expected CAPTURED)"
            )
            raise InvalidStateTransition(
                message="Payment must be in CAPTURED state to initialize escrow hold"
            )

        # 4. Create and persist Escrow record
        from app.schemas.escrow import EscrowCreate

        escrow_in = EscrowCreate(
            payment_id=payment_id, amount=payment.amount, state=EscrowState.HELD
        )
        escrow = self.escrow_repo.create(db, obj_in=escrow_in)
        logger.info(
            f"Escrow record created: escrow_id='{escrow.id}' state='{escrow.state.value}'"
        )

        # 5. Log audit trail entry
        audit_in = AuditLogCreate(
            entity="escrow",
            entity_id=str(escrow.id),
            action="created",
            payload={
                "payment_id": str(payment_id),
                "amount": str(escrow.amount),
                "state": escrow.state.value,
            },
        )
        self.audit_repo.create(db, obj_in=audit_in)
        logger.info(f"Audit log created for escrow creation: escrow_id='{escrow.id}'")

        return escrow

    def get_escrow(
        self, db: Session, payment_id: uuid.UUID
    ) -> EscrowTransaction | None:
        """
        Retrieves the escrow transaction associated with a specific payment record.
        """
        logger.info(f"Retrieving escrow by payment ID: payment_id='{payment_id}'")
        return self.escrow_repo.get_by_payment_id(db, payment_id)

    def validate_release_conditions(self, db: Session, payment_id: uuid.UUID) -> bool:
        """
        Verifies all preconditions for releasing funds from escrow:
        - Payment is CAPTURED
        - POD is VERIFIED
        - Escrow is not already RELEASED
        """
        logger.info(f"Validating escrow release conditions: payment_id='{payment_id}'")

        payment = self.payment_repo.get(db, payment_id)
        if not payment:
            raise ResourceNotFound(message=f"Payment record not found: {payment_id}")

        escrow = self.escrow_repo.get_by_payment_id(db, payment_id)
        if not escrow:
            raise ResourceNotFound(
                message=f"Escrow transaction not found for payment: {payment_id}"
            )

        if payment.status != PaymentStatus.CAPTURED:
            raise InvalidStateTransition(
                message="Cannot release escrow: payment is not CAPTURED"
            )

        if escrow.state == EscrowState.RELEASED:
            raise InvalidStateTransition(
                message="Cannot release escrow: escrow is already RELEASED"
            )

        # Query PodService to verify if a verified POD exists for this booking
        if not self.pod_service.has_verified_pod(db, payment.booking_id):
            raise InvalidStateTransition(
                message="Cannot release escrow: Proof of Delivery is not VERIFIED"
            )

        return True

    def release_escrow(
        self, db: Session, payment_id: uuid.UUID, released_by: str = "system"
    ) -> EscrowTransaction:
        """
        Transitions the escrow transaction state to RELEASED after validating all preconditions.
        Safely returns the existing escrow if it has already been released (idempotent).
        """
        logger.info(
            f"Request to release escrow: payment_id='{payment_id}' released_by='{released_by}'"
        )

        escrow = self.escrow_repo.get_by_payment_id(db, payment_id)
        if not escrow:
            logger.warning(
                f"Escrow release rejected: escrow not found for payment_id='{payment_id}'"
            )
            raise ResourceNotFound(
                message=f"Escrow transaction not found for payment: {payment_id}"
            )

        # Idempotent response if already released
        if escrow.state == EscrowState.RELEASED:
            logger.info(
                f"Escrow escrow_id='{escrow.id}' is already RELEASED. Returning safely."
            )
            return escrow

        # Validate all release conditions (raises AppException if any condition fails)
        self.validate_release_conditions(db, payment_id)

        # Transition escrow state and store release details
        update_data = {
            "state": EscrowState.RELEASED,
            "released_at": datetime.now(UTC),
            "released_by": released_by,
        }
        updated_escrow = self.escrow_repo.update(db, db_obj=escrow, obj_in=update_data)
        logger.info(
            f"Escrow released successfully: escrow_id='{updated_escrow.id}' state='{updated_escrow.state.value}'"
        )

        # Log transition to AuditLog
        audit_in = AuditLogCreate(
            entity="escrow",
            entity_id=str(updated_escrow.id),
            action="released",
            payload={
                "payment_id": str(payment_id),
                "amount": str(updated_escrow.amount),
                "state": EscrowState.RELEASED.value,
                "released_by": released_by,
            },
        )
        self.audit_repo.create(db, obj_in=audit_in)
        logger.info(
            f"Audit log created for escrow release: escrow_id='{updated_escrow.id}'"
        )

        return updated_escrow
