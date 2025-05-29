import { createHash } from "@tat-protocol/utils";
import { bytesToHex } from "@noble/hashes/utils";

/**
 * HTLC (Hash Time Locked Contract) structure
 */
export interface HTLC {
  hashlock: string; // Hash of the secret preimage
  timelock: number; // Unix timestamp when timelock expires
  hashFunction?: string; // Hash algorithm used (default: 'sha256')
}

/**
 * HTLC validation result
 */
export interface HTLCValidationResult {
  isValid: boolean;
  error?: string;
  canRedeem: boolean; // Can be redeemed with secret
  canRefund: boolean; // Can be refunded after timelock
  isExpired: boolean; // Whether timelock has passed
}

/**
 * HTLC redemption attempt result
 */
export interface HTLCRedemptionResult {
  success: boolean;
  error?: string;
  secretRevealed?: string; // The secret that was used (if successful)
}

/**
 * Enhanced HTLC handler with proper security validation
 */
export class HTLCHandler {
  /**
   * Validates HTLC structure and timing constraints
   */
  static validateHTLC(
    htlc: HTLC,
    currentTime: number = Date.now(),
  ): HTLCValidationResult {
    // Input validation
    if (!htlc) {
      return {
        isValid: false,
        error: "HTLC is null or undefined",
        canRedeem: false,
        canRefund: false,
        isExpired: false,
      };
    }

    if (!htlc.hashlock || typeof htlc.hashlock !== "string") {
      return {
        isValid: false,
        error: "Invalid or missing hashlock",
        canRedeem: false,
        canRefund: false,
        isExpired: false,
      };
    }

    if (
      !htlc.timelock ||
      typeof htlc.timelock !== "number" ||
      htlc.timelock <= 0
    ) {
      return {
        isValid: false,
        error: "Invalid or missing timelock",
        canRedeem: false,
        canRefund: false,
        isExpired: false,
      };
    }

    // Validate hash format (should be hex string)
    if (!/^[a-fA-F0-9]+$/.test(htlc.hashlock)) {
      return {
        isValid: false,
        error: "Hashlock must be a valid hexadecimal string",
        canRedeem: false,
        canRefund: false,
        isExpired: false,
      };
    }

    // Check hash length based on algorithm
    const hashFunction = htlc.hashFunction || "sha256";
    const expectedLength = this.getExpectedHashLength(hashFunction);
    if (htlc.hashlock.length !== expectedLength) {
      return {
        isValid: false,
        error: `Invalid hash length for ${hashFunction}: expected ${expectedLength}, got ${htlc.hashlock.length}`,
        canRedeem: false,
        canRefund: false,
        isExpired: false,
      };
    }

    // Validate timelock is reasonable (not too far in past or future)
    const minValidTime = currentTime - 30 * 24 * 60 * 60 * 1000; // 30 days ago
    const maxValidTime = currentTime + 365 * 24 * 60 * 60 * 1000; // 1 year from now

    if (htlc.timelock < minValidTime) {
      return {
        isValid: false,
        error: "Timelock is too far in the past",
        canRedeem: false,
        canRefund: false,
        isExpired: true,
      };
    }

    if (htlc.timelock > maxValidTime) {
      return {
        isValid: false,
        error: "Timelock is too far in the future",
        canRedeem: false,
        canRefund: false,
        isExpired: false,
      };
    }

    const isExpired = htlc.timelock <= currentTime;

    return {
      isValid: true,
      canRedeem: !isExpired, // Can only redeem with secret before expiry
      canRefund: isExpired, // Can only refund after expiry
      isExpired,
    };
  }

  /**
   * Attempts to redeem HTLC with provided secret
   */
  static async redeemHTLC(
    htlc: HTLC,
    secret: string,
    currentTime: number = Date.now(),
  ): Promise<HTLCRedemptionResult> {
    // First validate the HTLC
    const validation = this.validateHTLC(htlc, currentTime);
    if (!validation.isValid) {
      return {
        success: false,
        error: validation.error,
      };
    }

    // Check if redemption is allowed (before timelock expiry)
    if (!validation.canRedeem) {
      return {
        success: false,
        error: validation.isExpired
          ? "Cannot redeem: HTLC has expired, only refund is possible"
          : "Cannot redeem: HTLC validation failed",
      };
    }

    // Validate secret input
    if (!secret || typeof secret !== "string") {
      return {
        success: false,
        error: "Invalid secret provided",
      };
    }

    // Prevent timing attacks by always computing hash
    try {
      const hashFunction = htlc.hashFunction || "sha256";
      const secretHash = await this.computeHash(secret, hashFunction);

      // Use constant-time comparison to prevent timing attacks
      const isValidSecret = this.constantTimeEqual(
        secretHash,
        htlc.hashlock.toLowerCase(),
      );

      if (isValidSecret) {
        return {
          success: true,
          secretRevealed: secret,
        };
      } else {
        return {
          success: false,
          error: "Invalid secret: hash does not match hashlock",
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to verify secret: ${error}`,
      };
    }
  }

  /**
   * Checks if HTLC can be refunded (after timelock expiry)
   */
  static canRefund(
    htlc: HTLC,
    currentTime: number = Date.now(),
  ): { canRefund: boolean; error?: string } {
    const validation = this.validateHTLC(htlc, currentTime);
    if (!validation.isValid) {
      return { canRefund: false, error: validation.error };
    }

    return {
      canRefund: validation.canRefund,
      error: validation.canRefund
        ? undefined
        : "Cannot refund: HTLC has not yet expired",
    };
  }

  /**
   * Creates a new HTLC with proper validation
   */
  static async createHTLC(
    secret: string,
    timelockDuration: number,
    hashFunction: string = "sha256",
  ): Promise<{ htlc: HTLC; secret: string } | { error: string }> {
    if (!secret || typeof secret !== "string" || secret.length < 16) {
      return { error: "Secret must be at least 16 characters long" };
    }

    if (!timelockDuration || timelockDuration <= 0) {
      return { error: "Timelock duration must be positive" };
    }

    // Validate hash function
    if (!["sha256"].includes(hashFunction)) {
      return { error: `Unsupported hash function: ${hashFunction}` };
    }

    try {
      const hashlock = await this.computeHash(secret, hashFunction);
      const timelock = Date.now() + timelockDuration;

      const htlc: HTLC = {
        hashlock,
        timelock,
        hashFunction,
      };

      return { htlc, secret };
    } catch (error) {
      return { error: `Failed to create HTLC: ${error}` };
    }
  }

  /**
   * Computes hash using specified algorithm
   */
  private static async computeHash(
    data: string,
    algorithm: string = "sha256",
  ): Promise<string> {
    switch (algorithm.toLowerCase()) {
      case "sha256":
        const hash = await createHash(data);
        return bytesToHex(hash);
      default:
        throw new Error(`Unsupported hash algorithm: ${algorithm}`);
    }
  }

  /**
   * Constant-time string comparison to prevent timing attacks
   */
  private static constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return result === 0;
  }

  /**
   * Gets expected hash length for given algorithm
   */
  private static getExpectedHashLength(algorithm: string): number {
    switch (algorithm.toLowerCase()) {
      case "sha256":
        return 64; // 32 bytes * 2 hex chars per byte
      default:
        throw new Error(`Unknown hash algorithm: ${algorithm}`);
    }
  }
}

/**
 * Updated Token payload with proper HTLC structure
 */
export interface EnhancedPayload {
  iss: string; // Issuer (forge) pubkey
  iat: number; // Issued at timestamp
  amount?: number; // Token amount/value
  HTLC?: HTLC; // Hash Time Locked Contract
  timeLock?: number; // Simple timelock constraint (different from HTLC)
  P2PKlock?: string; // Public key lock
  tokenID?: number; // Unique token identifier
  data_uri?: string; // Optional data URI
}

/**
 * Example usage in token validation
 */
export class TokenValidator {
  /**
   * Validates a token with HTLC constraints
   */
  static async validateTokenHTLC(
    token: { payload: EnhancedPayload },
    secret?: string,
    currentTime: number = Date.now(),
  ): Promise<{
    valid: boolean;
    error?: string;
    canRedeem?: boolean;
    canRefund?: boolean;
  }> {
    if (!token.payload.HTLC) {
      return { valid: true }; // No HTLC, validation passes
    }

    const validation = HTLCHandler.validateHTLC(
      token.payload.HTLC,
      currentTime,
    );

    if (!validation.isValid) {
      return {
        valid: false,
        error: validation.error,
        canRedeem: false,
        canRefund: false,
      };
    }

    // If secret is provided, attempt redemption
    if (secret) {
      const redemption = await HTLCHandler.redeemHTLC(
        token.payload.HTLC,
        secret,
        currentTime,
      );
      return {
        valid: redemption.success,
        error: redemption.error,
        canRedeem: validation.canRedeem,
        canRefund: validation.canRefund,
      };
    }

    // No secret provided, just return validation state
    return {
      valid: true, // Structure is valid, but may not be redeemable
      canRedeem: validation.canRedeem,
      canRefund: validation.canRefund,
    };
  }
}

// Example usage:
/*
// Creating an HTLC
const result = await HTLCHandler.createHTLC("my-secret-preimage", 3600000); // 1 hour
if ('htlc' in result) {
  console.log('HTLC created:', result.htlc);
}

// Validating HTLC
const validation = HTLCHandler.validateHTLC(htlc);
console.log('Can redeem:', validation.canRedeem);
console.log('Can refund:', validation.canRefund);

// Attempting redemption
const redemption = await HTLCHandler.redeemHTLC(htlc, "my-secret-preimage");
if (redemption.success) {
  console.log('Redemption successful!');
}
*/
