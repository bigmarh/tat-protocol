import { StorageInterface } from "@tat-protocol/storage";
import { KeyPair } from "@tat-protocol/hdkeys";
import { Token } from "@tat-protocol/token";
import { DebugLogger } from "@tat-protocol/utils";
import { randomBytes } from "crypto";
import {
  ValidationResult,
  AccessAttempt,
  Redemption,
  // AccessPolicy,
  // ValidationStrategy,
  GateConfig as GateMetadata,
  AccessAnalytics,
} from "./types";
import {
  ValidationStrategyInterface,
  ValidationContext,
} from "./ValidationStrategyInterface";
import {
  AccessPolicyInterface,
  // PolicyEvaluationResult,
} from "./AccessPolicyInterface";

const Debug = DebugLogger.getInstance();

/**
 * Gate configuration
 */
export interface GateConfig {
  storage: StorageInterface;
  keys?: KeyPair;
  gateConfig?: GateMetadata;
  validationStrategy?: ValidationStrategyInterface;
  accessPolicy?: AccessPolicyInterface;
  offlineMode?: boolean; // Allow validation without forge connection
}

/**
 * Gate state
 */
export interface GateState {
  attempts: Map<string, AccessAttempt>; // attemptId -> attempt
  redemptions: Map<string, Redemption>; // tokenHash -> redemption
  blockedTokens: Set<string>; // Blacklisted token hashes
  gateConfig?: GateMetadata;
}

/**
 * GateBase - Abstract base class for token validation/access control protocol
 *
 * This class defines the protocol for validating TAT tokens at entry points
 * (physical venues, web endpoints, API gateways). It provides:
 * - Token verification (signature, expiration, issuer)
 * - Pluggable validation strategies (single-use, multi-entry, time-based, etc.)
 * - Configurable access policies (whitelists, blacklists, operating hours)
 * - Redemption tracking
 * - Offline validation support
 * - Access analytics
 *
 * Subclasses must implement abstract methods for specific validation flows.
 *
 * @example
 * ```typescript
 * class VenueTurnstile extends GateBase {
 *   async validateTokenWithForge(token: Token): Promise<boolean> {
 *     // Query forge to check if token is spent
 *     const isSpent = await this.forge.isTokenSpent(token.header.token_hash);
 *     return !isSpent;
 *   }
 * }
 * ```
 */
export abstract class GateBase {
  protected config: GateConfig;
  protected storage: StorageInterface;
  protected state!: GateState;
  protected isInitialized: boolean = false;
  protected stateKey: string = "";
  protected validationStrategy?: ValidationStrategyInterface;
  protected accessPolicy?: AccessPolicyInterface;
  protected offlineMode: boolean;

  constructor(config: GateConfig) {
    if (!config.storage) {
      throw new Error(
        "A StorageInterface implementation must be provided in config.storage",
      );
    }

    this.config = config;
    this.storage = config.storage;
    this.validationStrategy = config.validationStrategy;
    this.accessPolicy = config.accessPolicy;
    this.offlineMode = config.offlineMode ?? false;
  }

  /**
   * Initialize the Turnstile instance
   *
   * Loads state from storage and prepares for operations.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      const gateId = this.config.gateConfig?.gateId || "default";
      this.stateKey = `gate-state-${gateId}`;
      await this._loadState();
      this.isInitialized = true;
      Debug.log("Turnstile initialized", "Gate");
    } catch (error) {
      throw new Error(`Failed to initialize Gate: ${error}`);
    }
  }

  // =============================
  // Abstract Methods (must be implemented by subclasses)
  // =============================

  /**
   * Validate token with forge
   *
   * Optional method to check token status with the issuing forge.
   * Used when offlineMode is false or for critical validations.
   *
   * @param token - Token to validate
   * @returns True if forge confirms token is valid
   */
  protected abstract validateTokenWithForge(token: Token): Promise<boolean>;

  // =============================
  // Token Validation
  // =============================

  /**
   * Validate a token for access
   *
   * Complete validation flow:
   * 1. Verify token structure and signature
   * 2. Check expiration
   * 3. Evaluate access policy
   * 4. Apply validation strategy
   * 5. Optionally verify with forge
   *
   * @param tokenJWT - Token JWT string
   * @param context - Optional validation context
   * @returns Validation result
   */
  async validateToken(
    tokenJWT: string,
    context?: ValidationContext,
  ): Promise<ValidationResult> {
    const timestamp = Date.now();

    try {
      // Restore token from JWT
      const token = await new Token().restore(tokenJWT);

      // Step 1: Basic token validation
      const basicValidation = await this.performBasicValidation(token);
      if (!basicValidation.valid) {
        await this.recordAttempt(token, basicValidation, context);
        return basicValidation;
      }

      // Step 2: Policy evaluation
      if (this.accessPolicy) {
        const policyResult = await this.accessPolicy.evaluate(token, context);
        if (!policyResult.allowed) {
          const result: ValidationResult = {
            valid: false,
            token,
            reason: policyResult.reason,
            timestamp,
          };
          await this.recordAttempt(token, result, context);
          return result;
        }
      }

      // Step 3: Validation strategy check
      if (this.validationStrategy) {
        const strategyResult = await this.validationStrategy.validate(
          token,
          context,
        );
        if (!strategyResult.valid) {
          await this.recordAttempt(token, strategyResult, context);
          return strategyResult;
        }
      }

      // Step 4: Forge validation (if not in offline mode)
      if (!this.offlineMode) {
        try {
          const forgeValid = await this.validateTokenWithForge(token);
          if (!forgeValid) {
            const result: ValidationResult = {
              valid: false,
              token,
              reason: "Token invalidated by forge (possibly spent)",
              timestamp,
            };
            await this.recordAttempt(token, result, context);
            return result;
          }
        } catch (error) {
          Debug.warn(
            `Forge validation failed, falling back to offline mode: ${error}`,
            "Gate",
          );
        }
      }

      // All checks passed
      const result: ValidationResult = {
        valid: true,
        token,
        timestamp,
      };

      await this.recordAttempt(token, result, context);
      return result;
    } catch (error) {
      const result: ValidationResult = {
        valid: false,
        reason: error instanceof Error ? error.message : "Unknown error",
        timestamp,
      };
      return result;
    }
  }

  /**
   * Perform basic token validation
   *
   * Checks signature, expiration, and blacklist.
   */
  protected async performBasicValidation(
    token: Token,
  ): Promise<ValidationResult> {
    const timestamp = Date.now();

    // Check if token is blacklisted
    if (this.state.blockedTokens.has(token.header.token_hash)) {
      return {
        valid: false,
        token,
        reason: "Token is blocked",
        timestamp,
      };
    }

    // Verify token hash integrity
    if (!(await token.verifyTokenHash())) {
      return {
        valid: false,
        token,
        reason: "Token hash does not match payload",
        timestamp,
      };
    }

    // Verify signature (if required)
    if (!this.accessPolicy || this.accessPolicy.policy.requireValidSignature) {
      const isValidSignature = await token.verifyTokenSignature();
      if (!isValidSignature) {
        return {
          valid: false,
          token,
          reason: "Invalid token signature",
          timestamp,
        };
      }
    }

    // Check expiration
    if (!this.accessPolicy || this.accessPolicy.policy.requireNotExpired) {
      if (token.isExpired()) {
        return {
          valid: false,
          token,
          reason: "Token has expired",
          timestamp,
        };
      }
    }

    return {
      valid: true,
      token,
      timestamp,
    };
  }

  /**
   * Grant access and consume token
   *
   * Records successful access and consumes the token according
   * to the validation strategy.
   *
   * @param tokenJWT - Token JWT string
   * @param context - Optional validation context
   * @returns Success status
   */
  async grantAccess(
    tokenJWT: string,
    context?: ValidationContext,
  ): Promise<boolean> {
    // First validate
    const validation = await this.validateToken(tokenJWT, context);

    if (!validation.valid) {
      Debug.log(`Access denied: ${validation.reason}`, "Gate");
      return false;
    }

    // Consume token if strategy is configured
    if (this.validationStrategy && validation.token) {
      await this.validationStrategy.consume(validation.token, context);

      // Record redemption
      const redemption: Redemption = {
        redemptionId: this._generateRedemptionId(),
        tokenHash: validation.token.header.token_hash,
        holder: context?.holder || "unknown",
        issuer: validation.token.payload.iss,
        redeemedAt: Date.now(),
        gateId: context?.gateId || this.config.gateConfig?.gateId,
        uses: 1,
      };

      this.state.redemptions.set(redemption.tokenHash, redemption);
      await this._saveState();
    }

    Debug.log(
      `Access granted for token: ${validation.token?.header.token_hash}`,
      "Gate",
    );
    return true;
  }

  /**
   * Verify token without consuming
   *
   * Checks if a token is valid without recording usage.
   * Useful for pre-checks or queries.
   *
   * @param tokenJWT - Token JWT string
   * @param context - Optional validation context
   * @returns True if token is valid
   */
  async verifyToken(
    tokenJWT: string,
    context?: ValidationContext,
  ): Promise<boolean> {
    const result = await this.validateToken(tokenJWT, context);
    return result.valid;
  }

  // =============================
  // Access Attempt Tracking
  // =============================

  /**
   * Record access attempt
   *
   * Logs all validation attempts for analytics and audit.
   */
  protected async recordAttempt(
    token: Token,
    result: ValidationResult,
    context?: ValidationContext,
  ): Promise<void> {
    const attempt: AccessAttempt = {
      attemptId: this._generateAttemptId(),
      tokenHash: token.header.token_hash,
      holder: context?.holder || "unknown",
      issuer: token.payload.iss,
      result,
      gateId: context?.gateId || this.config.gateConfig?.gateId,
      location: context?.location,
      timestamp: Date.now(),
    };

    this.state.attempts.set(attempt.attemptId, attempt);
    await this._saveState();
  }

  /**
   * Get access attempts for a time period
   *
   * @param startTime - Start timestamp
   * @param endTime - End timestamp
   * @returns Array of access attempts
   */
  async getAttempts(
    startTime: number,
    endTime: number,
  ): Promise<AccessAttempt[]> {
    return Array.from(this.state.attempts.values()).filter(
      (attempt) =>
        attempt.timestamp >= startTime && attempt.timestamp <= endTime,
    );
  }

  /**
   * Get access analytics
   *
   * @param startTime - Start timestamp
   * @param endTime - End timestamp
   * @returns Access analytics
   */
  async getAnalytics(
    startTime: number,
    endTime: number,
  ): Promise<AccessAnalytics> {
    const attempts = await this.getAttempts(startTime, endTime);

    const successful = attempts.filter((a) => a.result.valid);
    const failed = attempts.filter((a) => !a.result.valid);

    const uniqueHolders = new Set(attempts.map((a) => a.holder)).size;

    // TODO: Implement more detailed analytics
    return {
      totalAttempts: attempts.length,
      successfulAttempts: successful.length,
      failedAttempts: failed.length,
      uniqueHolders,
      attemptsByStrategy: {} as any, // TODO
      peakHours: [],
      topIssuers: [],
      period: {
        start: startTime,
        end: endTime,
      },
    };
  }

  // =============================
  // Redemption Management
  // =============================

  /**
   * Get redemption record for a token
   *
   * @param tokenHash - Token hash
   * @returns Redemption record or undefined
   */
  async getRedemption(tokenHash: string): Promise<Redemption | undefined> {
    return this.state.redemptions.get(tokenHash);
  }

  /**
   * Check if token has been redeemed
   *
   * @param tokenHash - Token hash
   * @returns True if token has been redeemed
   */
  async isRedeemed(tokenHash: string): Promise<boolean> {
    return this.state.redemptions.has(tokenHash);
  }

  // =============================
  // Blacklist Management
  // =============================

  /**
   * Block a token
   *
   * @param tokenHash - Token hash to block
   */
  async blockToken(tokenHash: string): Promise<void> {
    this.state.blockedTokens.add(tokenHash);
    await this._saveState();
    Debug.log(`Token blocked: ${tokenHash}`, "Gate");
  }

  /**
   * Unblock a token
   *
   * @param tokenHash - Token hash to unblock
   */
  async unblockToken(tokenHash: string): Promise<void> {
    this.state.blockedTokens.delete(tokenHash);
    await this._saveState();
    Debug.log(`Token unblocked: ${tokenHash}`, "Gate");
  }

  /**
   * Check if token is blocked
   *
   * @param tokenHash - Token hash
   * @returns True if token is blocked
   */
  isTokenBlocked(tokenHash: string): boolean {
    return this.state.blockedTokens.has(tokenHash);
  }

  // =============================
  // State Management
  // =============================

  protected async _loadState(): Promise<void> {
    const savedState = await this.storage.getItem(this.stateKey);
    if (savedState) {
      const parsed = JSON.parse(savedState);
      this.state = {
        attempts: new Map(parsed.attempts || []),
        redemptions: new Map(parsed.redemptions || []),
        blockedTokens: new Set(parsed.blockedTokens || []),
        gateConfig: parsed.gateConfig || this.config.gateConfig,
      };
    } else {
      this.state = {
        attempts: new Map(),
        redemptions: new Map(),
        blockedTokens: new Set(),
        gateConfig: this.config.gateConfig,
      };
      await this._saveState();
    }
  }

  protected async _saveState(): Promise<void> {
    const serialized = {
      attempts: Array.from(this.state.attempts.entries()),
      redemptions: Array.from(this.state.redemptions.entries()),
      blockedTokens: Array.from(this.state.blockedTokens),
      gateConfig: this.state.gateConfig,
    };
    await this.storage.setItem(this.stateKey, JSON.stringify(serialized));
  }

  // =============================
  // Utility Methods
  // =============================

  protected _generateAttemptId(): string {
    return `attempt-${Date.now()}-${randomBytes(8).toString("hex")}`;
  }

  protected _generateRedemptionId(): string {
    return `redeem-${Date.now()}-${randomBytes(8).toString("hex")}`;
  }

  /**
   * Get state (for debugging/inspection)
   */
  public getState(): GateState {
    return this.state;
  }

  /**
   * Get validation strategy
   */
  public getValidationStrategy(): ValidationStrategyInterface | undefined {
    return this.validationStrategy;
  }

  /**
   * Get access policy
   */
  public getAccessPolicy(): AccessPolicyInterface | undefined {
    return this.accessPolicy;
  }

  /**
   * Set validation strategy
   *
   * @param strategy - New validation strategy
   */
  public setValidationStrategy(strategy: ValidationStrategyInterface): void {
    this.validationStrategy = strategy;
  }

  /**
   * Set access policy
   *
   * @param policy - New access policy
   */
  public setAccessPolicy(policy: AccessPolicyInterface): void {
    this.accessPolicy = policy;
  }
}
