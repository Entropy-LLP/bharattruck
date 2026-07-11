# app/api/pod.py
# This file defines the REST API endpoints exposing the Proof of Delivery (POD) services.
# It validates request parameters and delegates execution directly to PodService.

import logging
import uuid

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.dependencies import get_db, get_pod_service
from app.schemas.pod import PodEventResponse
from app.services.pod_service import PodService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pod", tags=["POD"])


class PodUploadRequest(BaseModel):
    """
    Request payload schema for uploading a new Proof of Delivery (POD).
    """

    booking_id: str = Field(
        ..., description="Unique booking ID associated with the shipment"
    )
    photo_url: str | None = Field(
        None, description="Optional S3 or storage link of the signed delivery slip"
    )


@router.post(
    "/upload",
    response_model=PodEventResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a new Proof of Delivery (POD) document",
    description="Registers a Proof of Delivery document for audit trail and verification.",
    responses={
        status.HTTP_201_CREATED: {
            "description": "POD uploaded and registered successfully"
        },
        status.HTTP_422_UNPROCESSABLE_ENTITY: {
            "description": "Request validation failed"
        },
    },
)
def upload_pod(
    request: PodUploadRequest,
    db: Session = Depends(get_db),
    pod_service: PodService = Depends(get_pod_service),
) -> PodEventResponse:
    """
    Exposes POD upload functionality, delegating payload handling to PodService.
    """
    logger.info(
        f"API request received: POST /pod/upload for booking_id='{request.booking_id}'"
    )
    return pod_service.upload_pod(
        db, booking_id=request.booking_id, photo_url=request.photo_url
    )


@router.post(
    "/{pod_id}/verify",
    response_model=PodEventResponse,
    status_code=status.HTTP_200_OK,
    summary="Verify an uploaded Proof of Delivery (POD)",
    description="Approves a Proof of Delivery. Enforces that only one POD can be verified for a booking.",
    responses={
        status.HTTP_200_OK: {"description": "POD verified successfully"},
        status.HTTP_404_NOT_FOUND: {"description": "Proof of Delivery not found"},
        status.HTTP_409_CONFLICT: {
            "description": "A verified POD already exists for this booking"
        },
    },
)
def verify_pod(
    pod_id: uuid.UUID,
    db: Session = Depends(get_db),
    pod_service: PodService = Depends(get_pod_service),
) -> PodEventResponse:
    """
    Exposes POD verification functionality, delegating state transition and logic checks to PodService.
    """
    logger.info(f"API request received: POST /pod/{pod_id}/verify")
    return pod_service.verify_pod(db, pod_id=pod_id)


@router.post(
    "/{pod_id}/reject",
    response_model=PodEventResponse,
    status_code=status.HTTP_200_OK,
    summary="Reject an uploaded Proof of Delivery (POD)",
    description="Invalidates an uploaded Proof of Delivery.",
    responses={
        status.HTTP_200_OK: {"description": "POD rejected successfully"},
        status.HTTP_404_NOT_FOUND: {"description": "Proof of Delivery not found"},
    },
)
def reject_pod(
    pod_id: uuid.UUID,
    db: Session = Depends(get_db),
    pod_service: PodService = Depends(get_pod_service),
) -> PodEventResponse:
    """
    Exposes POD rejection functionality, delegating state updates to PodService.
    """
    logger.info(f"API request received: POST /pod/{pod_id}/reject")
    return pod_service.reject_pod(db, pod_id=pod_id)


@router.get(
    "/booking/{booking_id}",
    response_model=list[PodEventResponse],
    status_code=status.HTTP_200_OK,
    summary="Retrieve all POD documents for a specific booking",
    description="Fetches a chronological list of all POD uploads corresponding to the booking ID.",
)
def get_pods_by_booking_id(
    booking_id: str,
    db: Session = Depends(get_db),
    pod_service: PodService = Depends(get_pod_service),
) -> list[PodEventResponse]:
    """
    Exposes POD retrieval by booking ID, delegating query to PodService.
    """
    logger.info(f"API request received: GET /pod/booking/{booking_id}")
    return pod_service.get_pods_by_booking_id(db, booking_id=booking_id)
