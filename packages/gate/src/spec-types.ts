/**
 * Types matching TAT Protocol Extensions specification
 * Section 5: Gate Protocol
 */

// import { Token } from "@tat-protocol/token";

/**
 * Verification mode (per spec section 4.4)
 */
export type VerificationMode = "local" | "issuer" | "hybrid";

/**
 * Challenge requirements (per spec section 4.3.1)
 */
export interface TurnstileRequirements {
  issuer: string; // Required TAT issuer
  tokenIdPattern?: string; // Regex pattern (e.g., "premium-.*")
  minTier?: string; // Minimum tier level
  notExpired: boolean; // Must not be expired
  customCheck?: {
    // App-specific requirements
    field: string; // ext field path
    operator: "eq" | "gt" | "lt" | "contains";
    value: any;
  };
}

/**
 * Challenge data (per spec section 4.3.1)
 */
export interface TurnstileChallenge {
  resource: string; // What is being accessed
  requirements: TurnstileRequirements;
  nonce: string; // Random challenge (32 bytes hex)
  expiresAt: number; // Challenge expiry
  verificationMode: VerificationMode;
}

/**
 * Full disclosure proof (per spec section 4.3.2)
 */
export interface TurnstileProofFull {
  mode: "full";
  tat: string; // Full TAT JWT
  nonce: string; // Echo nonce
  signature: string; // Sign(nonce, holderSecretKey)
}

/**
 * Minimal disclosure proof (per spec section 4.3.2)
 */
export interface TurnstileProofMinimal {
  mode: "minimal";
  claim: {
    tokenHash: string;
    issuer: string;
    holderPubkey: string;

    // Only the fields needed for requirements
    disclosed: {
      tokenIdPattern?: boolean; // Does it match?
      notExpired?: boolean; // Is it valid?
      tier?: string; // What tier?
      customFields?: object; // Requested ext fields only
    };
  };
  nonce: string;
  signature: string; // Sign(nonce, holderSecretKey)
}

/**
 * Proof submission (per spec section 4.3.2)
 */
export type TurnstileProof = TurnstileProofFull | TurnstileProofMinimal;

/**
 * Session token data
 */
export interface TurnstileSession {
  token: string; // Session token for subsequent requests
  validUntil: number; // Session expiry
}

/**
 * TAT info in result
 */
export interface TurnstileTATInfo {
  tokenId: string;
  issuer: string;
  expiresAt?: number;
  tier?: string;
}

/**
 * Required TAT info when denied
 */
export interface RequiredTAT {
  issuer: string;
  type: string;
  purchaseUrl?: string;
}

/**
 * Access result (per spec section 4.3.3)
 */
export interface TurnstileResult {
  granted: boolean;
  resource: string;

  // If granted
  session?: TurnstileSession;
  tatInfo?: TurnstileTATInfo;

  // If denied
  reason?: string;
  requiredTAT?: RequiredTAT;
}

/**
 * Challenge storage entry
 */
export interface ChallengeEntry {
  challenge: TurnstileChallenge;
  requester: string; // Pubkey of requester
  createdAt: number;
  usedAt?: number; // When nonce was used
}
