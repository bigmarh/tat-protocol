/**
 * HTLC (Hash Time Locked Contract) structure
 */
export interface HTLC {
  hashlock: string;
  timelock: number;
  hashFunction?: string;
}
/**
 * HTLC validation result
 */
export interface HTLCValidationResult {
  isValid: boolean;
  error?: string;
  canRedeem: boolean;
  canRefund: boolean;
  isExpired: boolean;
}
/**
 * HTLC redemption attempt result
 */
export interface HTLCRedemptionResult {
  success: boolean;
  error?: string;
  secretRevealed?: string;
}
/**
 * Enhanced HTLC handler with proper security validation
 */
export declare class HTLCHandler {
  /**
   * Validates HTLC structure and timing constraints
   */
  static validateHTLC(htlc: HTLC, currentTime?: number): HTLCValidationResult;
  /**
   * Attempts to redeem HTLC with provided secret
   */
  static redeemHTLC(
    htlc: HTLC,
    secret: string,
    currentTime?: number,
  ): Promise<HTLCRedemptionResult>;
  /**
   * Checks if HTLC can be refunded (after timelock expiry)
   */
  static canRefund(
    htlc: HTLC,
    currentTime?: number,
  ): {
    canRefund: boolean;
    error?: string;
  };
  /**
   * Creates a new HTLC with proper validation
   */
  static createHTLC(
    secret: string,
    timelockDuration: number,
    hashFunction?: string,
  ): Promise<
    | {
        htlc: HTLC;
        secret: string;
      }
    | {
        error: string;
      }
  >;
  /**
   * Computes hash using specified algorithm
   */
  private static computeHash;
  /**
   * Constant-time string comparison to prevent timing attacks
   */
  private static constantTimeEqual;
  /**
   * Gets expected hash length for given algorithm
   */
  private static getExpectedHashLength;
}
/**
 * Updated Token payload with proper HTLC structure
 */
export interface EnhancedPayload {
  iss: string;
  iat: number;
  amount?: number;
  HTLC?: HTLC;
  timeLock?: number;
  P2PKlock?: string;
  tokenID?: number | string;
  data_uri?: string;
}
/**
 * Example usage in token validation
 */
export declare class TokenValidator {
  /**
   * Validates a token with HTLC constraints
   */
  static validateTokenHTLC(
    token: {
      payload: EnhancedPayload;
    },
    secret?: string,
    currentTime?: number,
  ): Promise<{
    valid: boolean;
    error?: string;
    canRedeem?: boolean;
    canRefund?: boolean;
  }>;
}
