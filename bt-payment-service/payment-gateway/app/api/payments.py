# app/api/payments.py
# This file defines the REST API endpoints exposing the payment service functionalities.
# It validates requests and delegates execution to PaymentService.

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.dependencies import get_db, get_payment_service
from app.schemas.payment import (
    PaymentOrderCreateRequest,
    PaymentOrderResponse,
    PaymentResponse,
)
from app.services.payment_service import PaymentService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/payments", tags=["Payments"])


@router.post(
    "/create-order",
    response_model=PaymentOrderResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new payment order",
    description="Registers a local payment transaction and generates an order with the gateway provider.",
    responses={
        status.HTTP_201_CREATED: {"description": "Payment order created successfully"},
        status.HTTP_409_CONFLICT: {
            "description": "A captured payment already exists for this booking"
        },
        status.HTTP_400_BAD_REQUEST: {
            "description": "Payment creation failed with provider"
        },
    },
)
def create_payment_order(
    request: PaymentOrderCreateRequest,
    db: Session = Depends(get_db),
    payment_service: PaymentService = Depends(get_payment_service),
) -> PaymentOrderResponse:
    """
    Exposes order creation logic, delegating parameters validation and registration to the service.
    """
    logger.info(
        f"API request received: POST /payments/create-order for booking_id='{request.booking_id}'"
    )
    return payment_service.create_payment_order(
        db,
        booking_id=request.booking_id,
        amount=request.amount,
        currency=request.currency,
    )


@router.get(
    "/{payment_id}",
    response_model=PaymentResponse,
    status_code=status.HTTP_200_OK,
    summary="Retrieve payment details by ID",
    description="Fetches full payment transaction data from the database using its unique UUID.",
    responses={
        status.HTTP_200_OK: {"description": "Payment details retrieved successfully"},
        status.HTTP_404_NOT_FOUND: {"description": "Payment not found"},
    },
)
def get_payment_by_id(
    payment_id: uuid.UUID,
    db: Session = Depends(get_db),
    payment_service: PaymentService = Depends(get_payment_service),
) -> PaymentResponse:
    """
    Exposes single payment retrieval logic, delegating lookup to the service.
    Raises a 404 error if no payment matches the UUID.
    """
    logger.info(f"API request received: GET /payments/{payment_id}")
    payment = payment_service.get_payment_by_id(db, payment_id)
    if not payment:
        logger.warning(f"Payment retrieval failed: ID '{payment_id}' not found")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found"
        )
    return payment


@router.get(
    "/booking/{booking_id}",
    response_model=list[PaymentResponse],
    status_code=status.HTTP_200_OK,
    summary="Retrieve payment details by booking ID",
    description="Fetches a list of all payment transactions associated with a booking ID.",
)
def get_payments_by_booking_id(
    booking_id: str,
    db: Session = Depends(get_db),
    payment_service: PaymentService = Depends(get_payment_service),
) -> list[PaymentResponse]:
    """
    Exposes multi-payment retrieval logic for bookings, delegating lookup to the service.
    """
    logger.info(f"API request received: GET /payments/booking/{booking_id}")
    return payment_service.get_payments_by_booking_id(db, booking_id)
