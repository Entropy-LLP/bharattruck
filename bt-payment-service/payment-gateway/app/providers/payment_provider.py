# app/providers/payment_provider.py
# This file defines the abstract interface for payment gateway providers.
# It uses Python's ABC module to enforce standard integration contracts.

from abc import ABC, abstractmethod
from decimal import Decimal

from app.models.enums import PaymentProvider as PaymentProviderEnum
from app.schemas.provider import ProviderOrderResponse


class PaymentProvider(ABC):
    """
    Abstract Base Class establishing standard contracts for third-party gateways (e.g. Razorpay, Stripe).
    Guarantees consistent method signatures across all payment provider implementations.
    """

    @property
    @abstractmethod
    def provider_type(self) -> PaymentProviderEnum:
        """
        Returns the type of payment provider as defined in the PaymentProvider Enum.
        """
        pass

    @abstractmethod
    def create_order(
        self, amount: Decimal, currency: str, receipt: str
    ) -> ProviderOrderResponse:
        """
        Creates an order on the payment provider's remote gateway.

        Args:
            amount: The transaction value in main currency unit (e.g. 150.50 INR).
            currency: Three-letter standard ISO currency string.
            receipt: Client-side reference identifier for mapping inside the gateway.

        Returns:
            ProviderOrderResponse: Standardized response details containing provider order ID.
        """
        pass

    @abstractmethod
    def verify_payment_signature(
        self, razorpay_order_id: str, razorpay_payment_id: str, razorpay_signature: str
    ) -> bool:
        """
        Verifies the signature authenticity of a payment from the provider.
        Raises business exception if verification fails.
        """
        pass

    @abstractmethod
    def verify_webhook_signature(
        self, raw_body: str, signature: str, secret: str
    ) -> bool:
        """
        Verifies the signature authenticity of a webhook event payload.
        """
        pass

    @abstractmethod
    def refund_payment(self, payment_id: str, amount: Decimal) -> dict:
        """
        Initiates a full or partial refund for a captured payment transaction.

        Args:
            payment_id: Gateway transaction ID of the payment to refund.
            amount: Refund value to issue back.

        Returns:
            dict: Raw dictionary describing gateway refund parameters.
        """
        pass
