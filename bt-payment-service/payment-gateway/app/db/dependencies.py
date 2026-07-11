# app/db/dependencies.py
# This file provides FastAPI dependency injection providers for the database layer.
# Using generators ensures that database sessions are correctly disposed of after use.

import logging
from collections.abc import Generator

from sqlalchemy.orm import Session

from app.db.session import SessionLocal

logger = logging.getLogger(__name__)


def get_db() -> Generator[Session, None, None]:
    """
    FastAPI dependency that yields a database session.
    Guarantees session cleanup (closing the connection back to pool)
    even in the event of an unhandled request exception.
    """
    db = SessionLocal()
    try:
        yield db
    except Exception:
        # Rollback automatically if something goes wrong in the session lifecycle before closure
        db.rollback()
        raise
    finally:
        db.close()


# Core Payment Service Dependency Injection Providers
from fastapi import Depends

from app.providers.payment_provider import PaymentProvider
from app.providers.razorpay_provider import RazorpayProvider
from app.repositories.payment import PaymentRepository, payment_repo
from app.services.payment_service import PaymentService


def get_payment_repository() -> PaymentRepository:
    """
    Returns the repository wrapper instance for Payment database tables.
    """
    return payment_repo


def get_payment_provider() -> PaymentProvider:
    """
    Returns the initialized Razorpay payment provider instance.
    """
    return RazorpayProvider()


def get_payment_service(
    db: Session = Depends(get_db),
    payment_repository: PaymentRepository = Depends(get_payment_repository),
    provider: PaymentProvider = Depends(get_payment_provider),
) -> PaymentService:
    """
    Constructs and returns the PaymentService, injecting required database sessions,
    query repositories, and gateway providers.
    """
    return PaymentService(payment_repo=payment_repository, provider=provider)


from app.repositories.audit import AuditRepository, audit_repo
from app.repositories.escrow import EscrowRepository, escrow_repo
from app.repositories.pod import PodRepository, pod_repo
from app.repositories.webhook import WebhookRepository, webhook_repo
from app.services.escrow_service import EscrowService
from app.services.pod_service import PodService
from app.services.webhook_service import WebhookService


def get_webhook_repository() -> WebhookRepository:
    """
    Returns the repository wrapper instance for WebhookEvent database tables.
    """
    return webhook_repo


def get_escrow_repository() -> EscrowRepository:
    """
    Returns the repository wrapper instance for EscrowTransaction database tables.
    """
    return escrow_repo


def get_pod_repository() -> PodRepository:
    """
    Returns the repository wrapper instance for PodEvent database tables.
    """
    return pod_repo


def get_audit_repository() -> AuditRepository:
    """
    Returns the repository wrapper instance for AuditLog database tables.
    """
    return audit_repo


def get_pod_service(
    pod_repository: PodRepository = Depends(get_pod_repository),
) -> PodService:
    """
    Constructs and returns the PodService, injecting required repositories.
    """
    return PodService(pod_repo=pod_repository)


def get_escrow_service(
    escrow_repository: EscrowRepository = Depends(get_escrow_repository),
    payment_repository: PaymentRepository = Depends(get_payment_repository),
    pod_service: PodService = Depends(get_pod_service),
    audit_repository: AuditRepository = Depends(get_audit_repository),
) -> EscrowService:
    """
    Constructs and returns the EscrowService, injecting required repositories and services.
    """
    return EscrowService(
        escrow_repo=escrow_repository,
        payment_repo=payment_repository,
        pod_service=pod_service,
        audit_repo=audit_repository,
    )


def get_webhook_service(
    db: Session = Depends(get_db),
    webhook_repository: WebhookRepository = Depends(get_webhook_repository),
    payment_repository: PaymentRepository = Depends(get_payment_repository),
    provider: PaymentProvider = Depends(get_payment_provider),
    escrow_service: EscrowService = Depends(get_escrow_service),
) -> WebhookService:
    """
    Constructs and returns the WebhookService, injecting required repositories and providers.
    """
    return WebhookService(
        webhook_repo=webhook_repository,
        payment_repo=payment_repository,
        provider=provider,
        escrow_service=escrow_service,
    )
