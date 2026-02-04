import { Token } from "@tat-protocol/token";

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  token?: Token;
  reason?: string; // Reason for validation failure
  timestamp: number; // When validation occurred
  metadata?: Record<string, unknown>;
}

/**
 * Access attempt record
 */
export interface AccessAttempt {
  attemptId: string;
  tokenHash: string;
  holder: string; // Public key of token holder
  issuer: string; // Forge public key
  result: ValidationResult;
  gateId?: string; // Which gate/turnstile processed this
  location?: string; // Physical or logical location
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * Redemption record
 */
export interface Redemption {
  redemptionId: string;
  tokenHash: string;
  holder: string;
  issuer: string;
  redeemedAt: number;
  gateId?: string;
  uses: number; // Number of uses consumed
  metadata?: Record<string, unknown>;
}

/**
 * Access policy configuration
 */
export interface AccessPolicy {
  name: string;
  allowedIssuers?: string[]; // Whitelist of forge public keys
  blockedIssuers?: string[]; // Blacklist of forge public keys
  blockedTokens?: string[]; // Blacklist of specific token hashes
  requireValidSignature: boolean; // Verify token signature
  requireNotExpired: boolean; // Check expiration
  requireNotSpent?: boolean; // Check with forge if token is spent
  customRules?: Array<{
    name: string;
    check: (
      token: Token,
      context?: Record<string, unknown>,
    ) => Promise<boolean>;
  }>;
  maxCapacity?: number; // Maximum simultaneous access
  operatingHours?: {
    start: string; // e.g., "09:00"
    end: string; // e.g., "17:00"
    timezone?: string;
  };
}

/**
 * Validation strategy type
 */
export enum ValidationStrategy {
  SINGLE_USE = "SINGLE_USE", // Token can only be used once
  MULTI_ENTRY = "MULTI_ENTRY", // Token can be used multiple times
  TIME_BASED = "TIME_BASED", // Token valid within time window
  SCAN_IN_OUT = "SCAN_IN_OUT", // Track entry/exit pairs
  CAPACITY_LIMITED = "CAPACITY_LIMITED", // Limited simultaneous access
  CUSTOM = "CUSTOM", // Custom validation logic
}

/**
 * Turnstile gate status
 */
export enum GateStatus {
  ACTIVE = "ACTIVE", // Gate is operational
  INACTIVE = "INACTIVE", // Gate is not operational
  MAINTENANCE = "MAINTENANCE", // Gate under maintenance
  ERROR = "ERROR", // Gate has an error
}

/**
 * Gate configuration
 */
export interface GateConfig {
  gateId: string;
  name: string;
  location?: string;
  strategy: ValidationStrategy;
  policy: AccessPolicy;
  status: GateStatus;
  metadata?: Record<string, unknown>;
}

/**
 * Analytics data for access patterns
 */
export interface AccessAnalytics {
  totalAttempts: number;
  successfulAttempts: number;
  failedAttempts: number;
  uniqueHolders: number;
  attemptsByStrategy: Record<ValidationStrategy, number>;
  peakHours: Array<{
    hour: number;
    count: number;
  }>;
  topIssuers: Array<{
    issuer: string;
    count: number;
  }>;
  period: {
    start: number;
    end: number;
  };
}

/**
 * Capacity tracker
 */
export interface CapacityTracker {
  current: number; // Current occupancy
  max: number; // Maximum capacity
  entryCount: number; // Total entries
  exitCount: number; // Total exits
  lastUpdated: number;
}

/**
 * Entry/exit record for scan-in-out strategy
 */
export interface EntryExitRecord {
  recordId: string;
  tokenHash: string;
  holder: string;
  enteredAt: number;
  exitedAt?: number;
  gateId: string;
  duration?: number; // Calculated when exited
}
