# app/models/enums.py
# This file defines domain-specific Enums for type-safe state transitions.
# Standardizing these states prevents typos and bugs across the service.

from enum import Enum


class PaymentProvider(str, Enum):
    """
    Supported third-party payment gateway providers.
    Designed for scalability to support extra gateways like Stripe or Cashfree.
    """

    RAZORPAY = "RAZORPAY"


class PaymentStatus(str, Enum):
    """
    Standard stages of a payment transaction lifecycle.
    Tracks authorization, captures, and refund flows.
    """

    CREATED = "CREATED"  # Order record established in db
    INITIATED = "INITIATED"  # User redirected/checkout launched
    AUTHORIZED = "AUTHORIZED"  # Funds locked/approved by issuer, not yet captured
    CAPTURED = "CAPTURED"  # Settlement complete, funds retrieved
    FAILED = "FAILED"  # Payment declined or timed out
    REFUNDED = "REFUNDED"  # Funds returned back to customer


class EscrowState(str, Enum):
    """
    States representing the escrow escrow-hold phase of payments.
    Protects both shippers and transporters before shipment verification.
    """

    HELD = "HELD"  # Payment captured, funds secured in escrow
    RELEASED = "RELEASED"  # Verified delivery, funds released to transporter
    REFUNDED = "REFUNDED"  # Delivery cancelled/failed, funds returned to shipper
    DISPUTED = "DISPUTED"  # Delivery issue logged, funds frozen pending audit


class WebhookState(str, Enum):
    """
    Durable processing lifecycle states for incoming Webhook events.
    """

    RECEIVED = "RECEIVED"
    PROCESSING = "PROCESSING"
    PROCESSED = "PROCESSED"
    FAILED = "FAILED"


class PodState(str, Enum):
    """
    States representing the Proof of Delivery (POD) processing lifecycle.
    """

    UPLOADED = "UPLOADED"
    VERIFIED = "VERIFIED"
    REJECTED = "REJECTED"
