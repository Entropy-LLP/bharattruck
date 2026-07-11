# app/providers/razorpay_provider.py
# This file implements the RazorpayProvider wrapping the official Razorpay SDK.
# It converts currency amounts to subunits (paise) and handles API communications.

import logging
from decimal import Decimal

import razorpay

from app.core.config import settings
from app.core.exceptions import (
    PaymentVerificationFailed,
    WebhookSignatureVerificationFailed,
)
from app.models.enums import PaymentProvider as PaymentProviderEnum
from app.providers.payment_provider import PaymentProvider
from app.schemas.provider import ProviderOrderResponse

logger = logging.getLogger(__name__)


class RazorpayProvider(PaymentProvider):
    """
    Razorpay integration client implementing PaymentProvider.
    Fetches API keys from Pydantic Settings to secure communications.
    """

    @property
    def provider_type(self) -> PaymentProviderEnum:
        return PaymentProviderEnum.RAZORPAY

    def __init__(self) -> None:
        # Initialize client with credentials from settings.
        # Fails fast on initialization if settings keys are not set.
        self.client = razorpay.Client(
            auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET)
        )

    def create_order(
        self, amount: Decimal, currency: str, receipt: str
    ) -> ProviderOrderResponse:
        """
        Requests Razorpay order creation on the remote server.
        Converts the Decimal amount to integer subunit paise (1 INR = 100 paise).
        """
        # Convert Decimal value to integer subunit paise for Razorpay
        amount_paise = int(amount * 100)

        data = {
            "amount": amount_paise,
            "currency": currency,
            "receipt": receipt,
        }

        try:
            logger.info(
                f"Initiating Razorpay Order API call: "
                f"receipt='{receipt}' amount_paise={amount_paise} currency='{currency}'"
            )

            # Execute Razorpay SDK order call
            response = self.client.order.create(data=data)

            logger.info(
                f"Razorpay Order API call completed: "
                f"order_id='{response.get('id')}' status='{response.get('status')}'"
            )

            # Convert paise back to standard Decimal units for the generic schema
            returned_amount = Decimal(response["amount"]) / 100

            return ProviderOrderResponse(
                provider_order_id=response["id"],
                amount=returned_amount,
                currency=response["currency"],
                status=response["status"],
                raw_response=response,
            )
        except Exception as e:
            logger.error(
                f"Failed to create Razorpay Order for receipt '{receipt}': {e}",
                exc_info=True,
            )
            raise

    def verify_payment_signature(
        self, razorpay_order_id: str, razorpay_payment_id: str, razorpay_signature: str
    ) -> bool:
        """
        Verifies the signature authenticity of a payment from the provider.
        Raises PaymentVerificationFailed if verification fails.
        """
        params_dict = {
            "razorpay_order_id": razorpay_order_id,
            "razorpay_payment_id": razorpay_payment_id,
            "razorpay_signature": razorpay_signature,
        }
        try:
            self.client.utility.verify_payment_signature(params_dict)
            return True
        except Exception as e:
            logger.warning(f"Razorpay payment signature verification failed: {e}")
            raise PaymentVerificationFailed(
                message=f"Razorpay payment signature verification failed: {e!s}"
            )

    def verify_webhook_signature(
        self, raw_body: str, signature: str, secret: str
    ) -> bool:
        """
        Verifies the signature authenticity of a webhook event payload.
        Raises WebhookSignatureVerificationFailed if verification fails.
        """
        try:
            self.client.utility.verify_webhook_signature(raw_body, signature, secret)
            return True
        except Exception as e:
            logger.warning(f"Razorpay webhook signature verification failed: {e}")
            raise WebhookSignatureVerificationFailed(
                message="Razorpay webhook signature verification failed"
            )

    def refund_payment(self, payment_id: str, amount: Decimal) -> dict:
        """
        Placeholder for issuing full/partial refunds through Razorpay.
        """
        # TODO: Implement client.refund.create in future refund sprint
        logger.warning(
            f"refund_payment called for payment_id='{payment_id}' amount={amount} - PLACEHOLDER"
        )
        return {
            "payment_id": payment_id,
            "amount_refunded": float(amount),
            "status": "placeholder",
        }
