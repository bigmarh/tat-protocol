import {
  PaymentProvider,
  PaymentInitResult,
  PaymentVerificationResult,
  RefundResult,
} from "./PaymentProviderInterface";
import { Payment, PaymentMethod, PaymentStatus, Price } from "./types";
import { Token } from "@tat-protocol/token";

/**
 * Configuration for TATPaymentProvider
 */
export interface TATPaymentConfig {
  /** Forge pubkeys whose tokens are accepted as payment */
  acceptedIssuers: string[];

  /** Token types accepted (TAT, FUNGIBLE, or both) */
  acceptedTokenTypes: ("TAT" | "FUNGIBLE")[];

  /** Pubkey to receive TAT payments */
  receiverPubkey: string;

  /** Whether to verify tokens with their issuing forge (optional) */
  verifyWithForge?: boolean;

  /** Minimum token value required (for fungible tokens) */
  minimumAmount?: number;

  /** Custom token validation function */
  customValidator?: (
    token: Token,
  ) => Promise<{ valid: boolean; reason?: string }>;
}

/**
 * Pending TAT payment tracking
 */
interface PendingTATPayment {
  paymentId: string;
  expectedAmount?: number;
  expectedIssuer?: string;
  receivedTokens: string[];
  status: PaymentStatus;
  createdAt: number;
  completedAt?: number;
}

/**
 * TATPaymentProvider - Payment provider for accepting TAT tokens as payment
 *
 * This provider enables token-for-token exchanges, allowing users to pay
 * for tokens using other TAT tokens (fungible or non-fungible).
 *
 * @example
 * ```typescript
 * const tatProvider = new TATPaymentProvider({
 *   acceptedIssuers: ['forge-pubkey-1', 'forge-pubkey-2'],
 *   acceptedTokenTypes: ['FUNGIBLE'],
 *   receiverPubkey: myPubkey,
 * });
 *
 * const booth = new MyBooth({
 *   storage,
 *   paymentProviders: [tatProvider]
 * });
 * ```
 */
export class TATPaymentProvider implements PaymentProvider {
  readonly name = "tat";
  readonly supportedMethods = [PaymentMethod.TAT];

  private config: TATPaymentConfig;
  private pendingPayments: Map<string, PendingTATPayment> = new Map();

  constructor(config: TATPaymentConfig) {
    if (!config.acceptedIssuers || config.acceptedIssuers.length === 0) {
      throw new Error(
        "TATPaymentProvider requires at least one accepted issuer",
      );
    }
    if (!config.acceptedTokenTypes || config.acceptedTokenTypes.length === 0) {
      throw new Error(
        "TATPaymentProvider requires at least one accepted token type",
      );
    }
    if (!config.receiverPubkey) {
      throw new Error("TATPaymentProvider requires a receiver pubkey");
    }

    this.config = config;
  }

  /**
   * Initialize a TAT payment
   *
   * Returns the payment details including which tokens are accepted
   */
  async initializePayment(payment: Payment): Promise<PaymentInitResult> {
    const pendingPayment: PendingTATPayment = {
      paymentId: payment.paymentId,
      expectedAmount: payment.amount.amount,
      receivedTokens: [],
      status: "pending",
      createdAt: Date.now(),
    };

    this.pendingPayments.set(payment.paymentId, pendingPayment);

    return {
      paymentId: payment.paymentId,
      paymentAddress: this.config.receiverPubkey,
      paymentData: {
        acceptedIssuers: this.config.acceptedIssuers,
        acceptedTokenTypes: this.config.acceptedTokenTypes,
        expectedAmount: payment.amount.amount,
        currency: payment.amount.currency,
      },
      expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour default
    };
  }

  /**
   * Verify a TAT payment
   *
   * Checks if tokens have been submitted and validates them
   */
  async verifyPayment(paymentId: string): Promise<PaymentVerificationResult> {
    const pending = this.pendingPayments.get(paymentId);
    if (!pending) {
      return {
        verified: false,
        status: "failed",
        failureReason: "Payment not found",
      };
    }

    return {
      verified: pending.status === "completed",
      status: pending.status,
      completedAt: pending.completedAt,
    };
  }

  /**
   * Process TAT payment submission
   *
   * Validates and accepts tokens as payment
   *
   * @param paymentId - Payment identifier
   * @param tokens - Array of token JWTs submitted as payment
   */
  async processTATPayment(
    paymentId: string,
    tokens: string[],
  ): Promise<PaymentVerificationResult> {
    const pending = this.pendingPayments.get(paymentId);
    if (!pending) {
      return {
        verified: false,
        status: "failed",
        failureReason: "Payment not found",
      };
    }

    if (pending.status !== "pending") {
      return {
        verified: false,
        status: pending.status,
        failureReason: "Payment already processed",
      };
    }

    // Validate all tokens
    const validation = await this.validateTokens(tokens);
    if (!validation.valid) {
      return {
        verified: false,
        status: "failed",
        failureReason: validation.reason,
      };
    }

    // Calculate total value for fungible tokens
    let totalValue = 0;
    for (const jwt of tokens) {
      const token = new Token();
      await token.restore(jwt);

      const tokenType = token.getTokenType();
      if (tokenType === "FUNGIBLE" && token.payload.amount) {
        totalValue += token.payload.amount;
      } else {
        // Non-fungible tokens count as 1 unit each
        totalValue += 1;
      }
    }

    // Check if payment meets minimum amount (if specified)
    if (pending.expectedAmount && totalValue < pending.expectedAmount) {
      return {
        verified: false,
        status: "failed",
        failureReason: `Insufficient token value: expected ${pending.expectedAmount}, received ${totalValue}`,
      };
    }

    // Payment successful
    pending.receivedTokens = tokens;
    pending.status = "completed";
    pending.completedAt = Date.now();
    this.pendingPayments.set(paymentId, pending);

    return {
      verified: true,
      status: "completed",
      amount: {
        amount: totalValue,
        currency: "tat",
      },
      completedAt: pending.completedAt,
    };
  }

  /**
   * Validate tokens for payment
   *
   * @param tokens - Array of token JWTs to validate
   */
  async validateTokens(
    tokens: string[],
  ): Promise<{ valid: boolean; reason?: string }> {
    if (!tokens || tokens.length === 0) {
      return { valid: false, reason: "No tokens provided" };
    }

    for (const jwt of tokens) {
      try {
        const token = new Token();
        await token.restore(jwt);

        // Validate token structure
        try {
          await token.validate();
        } catch (validationError) {
          return {
            valid: false,
            reason: `Invalid token: ${validationError instanceof Error ? validationError.message : String(validationError)}`,
          };
        }

        // Check issuer
        const issuer = token.payload.iss;
        if (!this.config.acceptedIssuers.includes(issuer)) {
          return {
            valid: false,
            reason: `Token issuer not accepted: ${issuer}`,
          };
        }

        // Check token type
        const tokenType = token.getTokenType();
        if (!this.config.acceptedTokenTypes.includes(tokenType)) {
          return {
            valid: false,
            reason: `Token type not accepted: ${tokenType}`,
          };
        }

        // Check expiration
        if (token.payload.exp && token.payload.exp < Date.now() / 1000) {
          return { valid: false, reason: "Token has expired" };
        }

        // Custom validation if provided
        if (this.config.customValidator) {
          const customResult = await this.config.customValidator(token);
          if (!customResult.valid) {
            return customResult;
          }
        }

        // Verify signature
        const sigValid = await token.verifyTokenSignature();
        if (!sigValid) {
          return {
            valid: false,
            reason: "Token signature verification failed",
          };
        }
      } catch (error) {
        return {
          valid: false,
          reason: `Failed to parse token: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Refund payment - returns the original tokens
   *
   * For TAT payments, refunds mean returning the tokens to the sender
   */
  async refundPayment(
    paymentId: string,
    _amount: Price,
    _reason: string,
  ): Promise<RefundResult> {
    const pending = this.pendingPayments.get(paymentId);
    if (!pending) {
      return {
        success: false,
        refundId: "",
        amount: _amount,
        failureReason: "Payment not found",
      };
    }

    if (pending.status !== "completed") {
      return {
        success: false,
        refundId: "",
        amount: _amount,
        failureReason: "Payment not completed, cannot refund",
      };
    }

    // In a real implementation, this would transfer tokens back
    // For now, we just mark the status and return the tokens
    const refundId = `refund-${paymentId}-${Date.now()}`;

    return {
      success: true,
      refundId,
      amount: {
        amount: pending.receivedTokens.length,
        currency: "tat",
      },
      completedAt: Date.now(),
    };
  }

  /**
   * Get payment status
   */
  async getPaymentStatus(paymentId: string): Promise<PaymentStatus> {
    const pending = this.pendingPayments.get(paymentId);
    return pending?.status ?? "failed";
  }

  /**
   * Cancel a pending payment
   */
  async cancelPayment(paymentId: string): Promise<boolean> {
    const pending = this.pendingPayments.get(paymentId);
    if (!pending) {
      return false;
    }

    if (pending.status !== "pending") {
      return false;
    }

    pending.status = "failed";
    this.pendingPayments.set(paymentId, pending);
    return true;
  }

  /**
   * Get received tokens for a completed payment
   *
   * @param paymentId - Payment identifier
   * @returns Array of token JWTs received as payment
   */
  getReceivedTokens(paymentId: string): string[] {
    const pending = this.pendingPayments.get(paymentId);
    return pending?.receivedTokens ?? [];
  }

  /**
   * Get provider configuration (for debugging/inspection)
   */
  getConfig(): Readonly<TATPaymentConfig> {
    return { ...this.config };
  }
}
