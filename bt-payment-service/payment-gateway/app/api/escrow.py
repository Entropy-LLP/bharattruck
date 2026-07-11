# app/api/escrow.py
# This file defines the REST API endpoints exposing the Escrow services.
# It validates request parameters and delegates execution directly to EscrowService.

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.dependencies import get_db, get_escrow_service
from app.schemas.escrow import EscrowResponse
from app.services.escrow_service import EscrowService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/escrow", tags=["Escrow"])


@router.get(
    "/payment/{payment_id}",
    response_model=EscrowResponse,
    status_code=status.HTTP_200_OK,
    summary="Retrieve escrow details by Payment ID",
    description="Fetches the escrow hold transaction associated with the payment UUID.",
    responses={
        status.HTTP_200_OK: {
            "description": "Escrow transaction details retrieved successfully"
        },
        status.HTTP_404_NOT_FOUND: {"description": "Escrow transaction not found"},
    },
)
def get_escrow_by_payment_id(
    payment_id: uuid.UUID,
    db: Session = Depends(get_db),
    escrow_service: EscrowService = Depends(get_escrow_service),
) -> EscrowResponse:
    """
    Exposes single escrow query logic, returning a 404 error if no escrow exists for the payment.
    """
    logger.info(f"API request received: GET /escrow/payment/{payment_id}")
    escrow = escrow_service.get_escrow(db, payment_id=payment_id)
    if not escrow:
        logger.warning(f"Escrow retrieval failed: ID '{payment_id}' not found")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Escrow transaction not found"
        )
    return escrow


@router.post(
    "/payment/{payment_id}/release",
    response_model=EscrowResponse,
    status_code=status.HTTP_200_OK,
    summary="Release funds from escrow hold",
    description="Authorizes payment settlement from escrow to the transporter, validating that a verified POD exists.",
    responses={
        status.HTTP_200_OK: {"description": "Escrow funds released successfully"},
        status.HTTP_400_BAD_REQUEST: {
            "description": "Escrow release condition validation failed"
        },
        status.HTTP_404_NOT_FOUND: {"description": "Escrow transaction not found"},
    },
)
def release_escrow(
    payment_id: uuid.UUID,
    released_by: str = "system",
    db: Session = Depends(get_db),
    escrow_service: EscrowService = Depends(get_escrow_service),
) -> EscrowResponse:
    """
    Exposes escrow release trigger endpoint. Delegate checks and update to EscrowService.
    """
    logger.info(
        f"API request received: POST /escrow/payment/{payment_id}/release by user='{released_by}'"
    )
    return escrow_service.release_escrow(
        db, payment_id=payment_id, released_by=released_by
    )
