import { Token } from "@tat-protocol/token";
import { ValidationResult, ValidationStrategy } from "./types";

/**
 * Validation context
 *
 * Additional context provided during validation that strategies
 * can use to make decisions.
 */
export interface ValidationContext {
  gateId?: string;
  location?: string;
  timestamp?: number;
  holder?: string; // Public key of token holder
  customData?: Record<string, unknown>;
  [key: string]: unknown; // Allow additional properties
}

/**
 * Validation strategy interface
 *
 * This interface defines the protocol for different token validation patterns.
 * Implementations can support various access control strategies:
 * - Single-use (ticket used once)
 * - Multi-entry (membership with multiple visits)
 * - Time-based (valid during specific hours)
 * - Scan-in-out (track entry/exit pairs)
 * - Capacity-limited (max simultaneous access)
 *
 * @example
 * ```typescript
 * class SingleUseValidation implements ValidationStrategyInterface {
 *   async validate(token: Token, context?: ValidationContext): Promise<ValidationResult> {
 *     // Check if token has been used before
 *     const tokenHash = token.header.token_hash;
 *     const isUsed = await this.state.redemptions.has(tokenHash);
 *
 *     if (isUsed) {
 *       return {
 *         valid: false,
 *         reason: 'Token already used',
 *         timestamp: Date.now()
 *       };
 *     }
 *
 *     return {
 *       valid: true,
 *       token,
 *       timestamp: Date.now()
 *     };
 *   }
 *
 *   async consume(token: Token, context?: ValidationContext): Promise<boolean> {
 *     // Mark token as used
 *     const tokenHash = token.header.token_hash;
 *     await this.recordRedemption(tokenHash, context);
 *     return true;
 *   }
 * }
 * ```
 */
export interface ValidationStrategyInterface {
  /**
   * Strategy type identifier
   */
  readonly type: ValidationStrategy;

  /**
   * Validate a token
   *
   * Checks if a token is valid for access according to this strategy.
   * This should NOT modify state - use consume() to record usage.
   *
   * @param token - Token to validate
   * @param context - Optional validation context
   * @returns Validation result
   */
  validate(
    token: Token,
    context?: ValidationContext,
  ): Promise<ValidationResult>;

  /**
   * Consume/redeem a token
   *
   * Records that a token has been used for access. This method
   * should be called after successful validation to update state.
   *
   * @param token - Token to consume
   * @param context - Optional validation context
   * @returns Success status
   */
  consume(token: Token, context?: ValidationContext): Promise<boolean>;

  /**
   * Check if a token can be used
   *
   * Quick check to see if token has remaining uses/validity
   * without full validation. Useful for pre-checks.
   *
   * @param token - Token to check
   * @returns True if token has remaining uses
   */
  canUse(token: Token): Promise<boolean>;

  /**
   * Get usage statistics for a token
   *
   * Returns how many times a token has been used and any
   * strategy-specific metadata.
   *
   * @param tokenHash - Token hash to query
   * @returns Usage information
   */
  getUsage(tokenHash: string): Promise<{
    uses: number;
    lastUsed?: number;
    metadata?: Record<string, unknown>;
  }>;

  /**
   * Reset/revoke a token's usage
   *
   * Clears usage history for a token. Useful for refunds,
   * corrections, or administrative purposes.
   *
   * @param tokenHash - Token hash to reset
   * @returns Success status
   */
  reset(tokenHash: string): Promise<boolean>;
}
