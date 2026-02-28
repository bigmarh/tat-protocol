import { Token } from "@tat-protocol/token";
import { AccessPolicy } from "./types.js";

/**
 * Policy evaluation result
 */
export interface PolicyEvaluationResult {
  allowed: boolean;
  reason?: string; // Reason for denial
  warnings?: string[]; // Non-blocking warnings
  metadata?: Record<string, unknown>;
}

/**
 * Access policy interface
 *
 * This interface defines the protocol for configurable access control policies.
 * Policies determine WHO can access WHAT under WHICH conditions.
 *
 * @example
 * ```typescript
 * class VenueAccessPolicy implements AccessPolicyInterface {
 *   async evaluate(token: Token, context?: Record<string, unknown>): Promise<PolicyEvaluationResult> {
 *     // Check issuer whitelist
 *     if (this.policy.allowedIssuers &&
 *         !this.policy.allowedIssuers.includes(token.payload.iss)) {
 *       return {
 *         allowed: false,
 *         reason: 'Token issuer not authorized for this venue'
 *       };
 *     }
 *
 *     // Check operating hours
 *     if (this.policy.operatingHours && !this.isWithinOperatingHours()) {
 *       return {
 *         allowed: false,
 *         reason: 'Outside operating hours'
 *       };
 *     }
 *
 *     // Check capacity
 *     if (this.policy.maxCapacity && this.currentOccupancy >= this.policy.maxCapacity) {
 *       return {
 *         allowed: false,
 *         reason: 'Venue at maximum capacity'
 *       };
 *     }
 *
 *     return { allowed: true };
 *   }
 * }
 * ```
 */
export interface AccessPolicyInterface {
  /**
   * Policy configuration
   */
  policy: AccessPolicy;

  /**
   * Evaluate if access should be granted
   *
   * Checks token against all policy rules to determine if
   * access should be allowed.
   *
   * @param token - Token to evaluate
   * @param context - Optional evaluation context
   * @returns Policy evaluation result
   */
  evaluate(
    token: Token,
    context?: Record<string, unknown>,
  ): Promise<PolicyEvaluationResult>;

  /**
   * Check if an issuer is allowed
   *
   * Verifies if tokens from a specific issuer (forge) are accepted.
   *
   * @param issuerPubkey - Issuer public key
   * @returns True if issuer is allowed
   */
  isIssuerAllowed(issuerPubkey: string): boolean;

  /**
   * Check if a token is blocked
   *
   * Checks if a specific token has been blacklisted.
   *
   * @param tokenHash - Token hash
   * @returns True if token is blocked
   */
  isTokenBlocked(tokenHash: string): boolean;

  /**
   * Add issuer to whitelist
   *
   * Allows tokens from a new issuer.
   *
   * @param issuerPubkey - Issuer public key to whitelist
   */
  addAllowedIssuer(issuerPubkey: string): void;

  /**
   * Remove issuer from whitelist
   *
   * Disallows tokens from an issuer.
   *
   * @param issuerPubkey - Issuer public key to remove
   */
  removeAllowedIssuer(issuerPubkey: string): void;

  /**
   * Block a specific token
   *
   * Adds a token to the blacklist.
   *
   * @param tokenHash - Token hash to block
   */
  blockToken(tokenHash: string): void;

  /**
   * Unblock a token
   *
   * Removes a token from the blacklist.
   *
   * @param tokenHash - Token hash to unblock
   */
  unblockToken(tokenHash: string): void;

  /**
   * Update policy configuration
   *
   * Modifies the access policy rules.
   *
   * @param updates - Partial policy updates
   */
  updatePolicy(updates: Partial<AccessPolicy>): void;

  /**
   * Check if currently within operating hours
   *
   * Validates current time against configured operating hours.
   *
   * @returns True if within operating hours
   */
  isWithinOperatingHours(): boolean;
}
