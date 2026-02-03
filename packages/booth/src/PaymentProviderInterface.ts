import { Payment, PaymentStatus, Price, PaymentMethod } from "./types";

/**
 * Payment provider initialization result
 */
export interface PaymentInitResult {
  paymentId: string;
  paymentUrl?: string; // Redirect URL for payment (for web)
  paymentAddress?: string; // Crypto address for payment
  paymentData?: Record<string, unknown>; // Provider-specific data (QR codes, etc.)
  expiresAt?: number; // Payment expiration timestamp
}

/**
 * Payment verification result
 */
export interface PaymentVerificationResult {
  verified: boolean;
  status: PaymentStatus;
  amount?: Price;
  transactionId?: string;
  completedAt?: number;
  failureReason?: string;
}

/**
 * Refund result
 */
export interface RefundResult {
  success: boolean;
  refundId: string;
  amount: Price;
  completedAt?: number;
  failureReason?: string;
}

/**
 * Payment provider interface
 *
 * This interface defines the standard protocol for payment processing.
 * Implementations can support any payment method (Bitcoin, Lightning,
 * credit cards, bank transfers, etc.)
 *
 * @example
 * ```typescript
 * class BitcoinPaymentProvider implements PaymentProvider {
 *   async initializePayment(payment: Payment): Promise<PaymentInitResult> {
 *     // Generate Bitcoin address
 *     const address = await this.generateAddress();
 *     return {
 *       paymentId: payment.paymentId,
 *       paymentAddress: address,
 *       expiresAt: Date.now() + 3600000 // 1 hour
 *     };
 *   }
 *   // ... implement other methods
 * }
 * ```
 */
export interface PaymentProvider {
  /**
   * Payment provider name/identifier
   */
  readonly name: string;

  /**
   * Supported payment methods
   */
  readonly supportedMethods: PaymentMethod[];

  /**
   * Initialize a payment
   *
   * Creates a new payment request and returns payment details
   * (address, URL, QR code, etc.)
   *
   * @param payment - Payment object with amount and details
   * @returns Payment initialization result
   */
  initializePayment(payment: Payment): Promise<PaymentInitResult>;

  /**
   * Verify a payment
   *
   * Checks if a payment has been completed successfully.
   * This may query the blockchain, payment processor API, etc.
   *
   * @param paymentId - Payment identifier
   * @returns Payment verification result
   */
  verifyPayment(paymentId: string): Promise<PaymentVerificationResult>;

  /**
   * Process a refund
   *
   * Initiates a refund for a completed payment.
   *
   * @param paymentId - Original payment identifier
   * @param amount - Amount to refund
   * @param reason - Refund reason
   * @returns Refund result
   */
  refundPayment(
    paymentId: string,
    amount: Price,
    reason: string
  ): Promise<RefundResult>;

  /**
   * Handle webhook/callback from payment provider
   *
   * Processes asynchronous payment notifications from the provider.
   * Optional - not all providers need webhooks.
   *
   * @param data - Webhook payload
   * @returns Updated payment status
   */
  handleWebhook?(data: unknown): Promise<PaymentVerificationResult | null>;

  /**
   * Get payment status
   *
   * Queries the current status of a payment.
   *
   * @param paymentId - Payment identifier
   * @returns Current payment status
   */
  getPaymentStatus(paymentId: string): Promise<PaymentStatus>;

  /**
   * Cancel a pending payment
   *
   * Cancels a payment that hasn't been completed yet.
   *
   * @param paymentId - Payment identifier
   * @returns Success status
   */
  cancelPayment(paymentId: string): Promise<boolean>;
}
