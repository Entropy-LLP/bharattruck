# app/services/webhook_service.py
# This file implements the WebhookService executing durable idempotency logic
# for processing incoming webhook notification events from payment gateways.

import json
import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.payment_event_mapper import RAZORPAY_EVENT_MAP
from app.models.enums import PaymentStatus, WebhookState
from app.providers.payment_provider import PaymentProvider
from app.repositories.payment import PaymentRepository
from app.repositories.webhook import WebhookRepository
from app.schemas.webhook import WebhookEventCreate
from app.services.escrow_service import EscrowService

logger = logging.getLogger(__name__)


class WebhookService:
    """
    Service layer orchestrating webhook payload processing, signature validations,
    event mappings, and idempotency status updates.
    """

    def __init__(
        self,
        webhook_repo: WebhookRepository,
        payment_repo: PaymentRepository,
        provider: PaymentProvider,
        escrow_service: EscrowService,
    ) -> None:
        self.webhook_repo = webhook_repo
        self.payment_repo = payment_repo
        self.provider = provider
        self.escrow_service = escrow_service

    def process_webhook(self, db: Session, raw_payload: str, signature: str) -> None:
        """
        Executes the durable webhook processing flow:
        Verify Signature -> RECEIVED -> PROCESSING -> Update Payment -> PROCESSED.
        Transitions state to FAILED if any business processing step throws an error.
        """
        logger.info("Webhook payload received. Starting signature verification...")

        # 1. Verify incoming webhook signature
        # Raises WebhookSignatureVerificationFailed if verification fails
        self.provider.verify_webhook_signature(
            raw_body=raw_payload,
            signature=signature,
            secret=settings.RAZORPAY_WEBHOOK_SECRET,
        )
        logger.info("Webhook signature successfully verified.")

        # Parse JSON event details
        try:
            payload = json.loads(raw_payload)
        except Exception as e:
            logger.error(f"Failed to parse webhook JSON payload: {e}")
            raise ValueError(f"Invalid webhook JSON structure: {e!s}") from e

        event_id = payload.get("id")
        event_name = payload.get("event")

        if not event_id:
            logger.warning(
                "Webhook payload missing unique event 'id'. Generating UUID for logging."
            )
            event_id = f"gen_{uuid.uuid4()}"

        logger.info(
            f"Processing webhook event: event_id='{event_id}' event_name='{event_name}'"
        )

        # 2. Check duplicate webhook to enforce idempotency
        existing_event = self.webhook_repo.get_by_event_id(db, event_id)
        if existing_event:
            if existing_event.status == WebhookState.PROCESSED:
                logger.info(
                    f"Duplicate webhook detected: event_id='{event_id}' is already PROCESSED. "
                    f"Skipping further business processing."
                )
                return
            logger.info(
                f"Retrying webhook event: event_id='{event_id}' (current status='{existing_event.status.value}')"
            )

        # 3. Persist the WebhookEvent in RECEIVED state and commit
        if not existing_event:
            webhook_in = WebhookEventCreate(
                event_id=event_id,
                provider=self.provider.provider_type,
                event_name=event_name,
                payload=payload,
                status=WebhookState.RECEIVED,
                processed=False,
            )
            db_webhook = self.webhook_repo.create(db, obj_in=webhook_in)
        else:
            db_webhook = existing_event
            self.webhook_repo.update(
                db, db_obj=db_webhook, obj_in={"status": WebhookState.RECEIVED}
            )

        logger.info(
            f"WebhookEvent registered: id='{db_webhook.id}' status='{WebhookState.RECEIVED.value}'"
        )

        # 4. Transition status to PROCESSING and commit
        self.webhook_repo.update(
            db, db_obj=db_webhook, obj_in={"status": WebhookState.PROCESSING}
        )
        logger.info(
            f"WebhookEvent state transitioned: id='{db_webhook.id}' status='{WebhookState.PROCESSING.value}'"
        )

        # 5. Core business processing & payment updates
        try:
            # Map event name to internal PaymentStatus
            payment_status = RAZORPAY_EVENT_MAP.get(event_name)
            if not payment_status:
                logger.warning(
                    f"Ignored payment update: event_name='{event_name}' has no registered status mapping."
                )
            else:
                # Extract payment entities from payload structure
                # Expected structure: payload["payload"]["payment"]["entity"]
                payment_data = (
                    payload.get("payload", {}).get("payment", {}).get("entity", {})
                )
                provider_order_id = payment_data.get("order_id")
                provider_payment_id = payment_data.get("id")

                if not provider_order_id:
                    raise ValueError(
                        "Webhook payload is missing the payment 'order_id'"
                    )

                # Locate corresponding Payment by provider_order_id (as primary lookup key)
                db_payment = self.payment_repo.get_by_provider_order_id(
                    db, provider_order_id
                )
                if not db_payment:
                    raise ValueError(
                        f"Database payment record matching provider_order_id='{provider_order_id}' not found."
                    )

                # Update the Payment status and associate the provider payment ID
                self.payment_repo.update(
                    db,
                    db_obj=db_payment,
                    obj_in={
                        "status": payment_status,
                        "provider_payment_id": provider_payment_id,
                    },
                )
                logger.info(
                    f"Payment record updated: payment_id='{db_payment.id}' "
                    f"new_status='{payment_status.value}' provider_payment_id='{provider_payment_id}'"
                )

                if payment_status == PaymentStatus.CAPTURED:
                    logger.info(
                        f"Payment captured webhook received. Initializing escrow: payment_id='{db_payment.id}'"
                    )
                    self.escrow_service.create_escrow(db, payment_id=db_payment.id)

            # 6. Transition WebhookEvent to PROCESSED and set processed_at timestamp
            self.webhook_repo.update(
                db,
                db_obj=db_webhook,
                obj_in={
                    "status": WebhookState.PROCESSED,
                    "processed": True,
                    "processed_at": datetime.now(UTC),
                },
            )
            logger.info(
                f"WebhookEvent successfully processed: id='{db_webhook.id}' "
                f"status='{WebhookState.PROCESSED.value}'"
            )

        except Exception as e:
            logger.error(
                f"Error during webhook business processing (event_id='{event_id}'): {e}",
                exc_info=True,
            )
            # If processing crashes, transition state to FAILED and commit before re-raising
            self.webhook_repo.update(
                db,
                db_obj=db_webhook,
                obj_in={"status": WebhookState.FAILED, "processed": False},
            )
            logger.info(
                f"WebhookEvent flagged: id='{db_webhook.id}' status='{WebhookState.FAILED.value}'"
            )
            raise
