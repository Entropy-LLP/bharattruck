# app/services/pod_service.py
# This file implements the Proof of Delivery (POD) service coordinating state transitions,
# audit validations, and enforcing that at most one verified POD can exist per booking.

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, ResourceNotFound
from app.models.enums import PodState
from app.models.pod import PodEvent
from app.repositories.pod import PodRepository

logger = logging.getLogger(__name__)


class PodService:
    """
    Service layer orchestrating the Proof of Delivery (POD) workflows.
    Decoupled via constructor dependency injection.
    """

    def __init__(self, pod_repo: PodRepository) -> None:
        self.pod_repo = pod_repo

    def upload_pod(
        self, db: Session, *, booking_id: str, photo_url: str | None = None
    ) -> PodEvent:
        """
        Registers a new Proof of Delivery (POD) document for a cargo booking.
        Multiple uploads are permitted for audit history.
        """
        logger.info(f"Uploading POD for booking_id='{booking_id}'")
        from app.schemas.pod import PodEventCreate

        pod_in = PodEventCreate(
            booking_id=booking_id,
            photo_url=photo_url,
            verified=False,
            verified_at=None,
            state=PodState.UPLOADED,
        )
        db_obj = self.pod_repo.create(db, obj_in=pod_in)
        logger.info(
            f"POD uploaded successfully: pod_id='{db_obj.id}' state='{db_obj.state.value}'"
        )
        return db_obj

    def verify_pod(self, db: Session, *, pod_id: uuid.UUID) -> PodEvent:
        """
        Reviews and verifies a Proof of Delivery (POD) document.
        Enforces that only one verified POD may exist per cargo booking.
        """
        logger.info(f"Request to verify POD: pod_id='{pod_id}'")
        pod = self.pod_repo.get(db, pod_id)
        if not pod:
            logger.warning(f"POD verification rejected: pod_id='{pod_id}' not found")
            raise ResourceNotFound(message=f"Proof of Delivery not found: {pod_id}")

        # Idempotent response if already verified
        if pod.state == PodState.VERIFIED:
            logger.info(f"POD pod_id='{pod_id}' is already VERIFIED. Returning safely.")
            return pod

        # Enforce that only one verified POD is allowed per booking
        active_verified = self.pod_repo.get_active_by_booking_id(db, pod.booking_id)
        if active_verified:
            logger.warning(
                f"POD verification rejected: booking_id='{pod.booking_id}' already has a "
                f"VERIFIED POD (pod_id='{active_verified.id}')"
            )
            raise ConflictError(
                message=f"A verified POD already exists for booking: {pod.booking_id}"
            )

        # Transition state and record timestamp
        update_data = {
            "state": PodState.VERIFIED,
            "verified": True,
            "verified_at": datetime.now(UTC),
        }
        updated_pod = self.pod_repo.update(db, db_obj=pod, obj_in=update_data)
        logger.info(
            f"POD verified successfully: pod_id='{updated_pod.id}' state='{updated_pod.state.value}'"
        )
        return updated_pod

    def reject_pod(self, db: Session, *, pod_id: uuid.UUID) -> PodEvent:
        """
        Rejects a Proof of Delivery (POD) document.
        """
        logger.info(f"Request to reject POD: pod_id='{pod_id}'")
        pod = self.pod_repo.get(db, pod_id)
        if not pod:
            logger.warning(f"POD rejection rejected: pod_id='{pod_id}' not found")
            raise ResourceNotFound(message=f"Proof of Delivery not found: {pod_id}")

        update_data = {
            "state": PodState.REJECTED,
            "verified": False,
            "verified_at": None,
        }
        updated_pod = self.pod_repo.update(db, db_obj=pod, obj_in=update_data)
        logger.info(
            f"POD rejected successfully: pod_id='{updated_pod.id}' state='{updated_pod.state.value}'"
        )
        return updated_pod

    def get_pods_by_booking_id(self, db: Session, booking_id: str) -> list[PodEvent]:
        """
        Retrieves all uploaded Proof of Delivery events for a specific booking.
        """
        logger.info(f"Retrieving all PODs for booking_id='{booking_id}'")
        return self.pod_repo.get_all_by_booking_id(db, booking_id)

    def has_verified_pod(self, db: Session, booking_id: str) -> bool:
        """
        Business check verifying whether a validated Proof of Delivery exists for a booking.
        """
        logger.info(f"Checking for verified POD: booking_id='{booking_id}'")
        active = self.pod_repo.get_active_by_booking_id(db, booking_id)
        return active is not None
