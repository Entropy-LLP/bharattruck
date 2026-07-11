# app/api/webhooks.py
# This file implements the REST API controller endpoints for incoming gateway webhooks.
# It validates request structures and delegates processing directly to WebhookService.

import logging

from fastapi import APIRouter, Depends, Header, Request, status
from sqlalchemy.orm import Session

from app.db.dependencies import get_db, get_webhook_service
from app.services.webhook_service import WebhookService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks", tags=["Webhooks"])


@router.post(
    "/razorpay",
    status_code=status.HTTP_200_OK,
    summary="Handle Razorpay gateway webhook notifications",
    description="Receives payload notifications from Razorpay and delegates signature check and updates.",
    responses={
        status.HTTP_200_OK: {
            "description": "Webhook notification processed successfully"
        },
        status.HTTP_401_UNAUTHORIZED: {
            "description": "Webhook signature verification failed"
        },
        status.HTTP_400_BAD_REQUEST: {
            "description": "Invalid webhook payload or processing failure"
        },
    },
)
async def handle_razorpay_webhook(
    request: Request,
    x_razorpay_signature: str = Header(
        ..., description="Razorpay signature header for webhook verification"
    ),
    db: Session = Depends(get_db),
    webhook_service: WebhookService = Depends(get_webhook_service),
) -> dict:
    """
    Thin router handler checking incoming headers and forwarding raw body payloads to the service layer.
    """
    logger.info("API request received: POST /webhooks/razorpay")

    # Read the raw payload bytes to ensure exact format matching for signature validation
    raw_payload_bytes = await request.body()
    raw_payload = raw_payload_bytes.decode("utf-8")

    # Delegate core verification, logging, and payment updates to the webhook service
    webhook_service.process_webhook(
        db, raw_payload=raw_payload, signature=x_razorpay_signature
    )

    return {"status": "success"}
