# app/core/payment_event_mapper.py
# Centralized registry mapping external payment gateway events to internal payment status.

from app.models.enums import PaymentStatus

# Centralized mapping registry for Razorpay event designations
# Maps incoming webhook descriptors to target internal PaymentStatus enums
RAZORPAY_EVENT_MAP = {
    "payment.authorized": PaymentStatus.AUTHORIZED,
    "payment.captured": PaymentStatus.CAPTURED,
    "payment.failed": PaymentStatus.FAILED,
}
