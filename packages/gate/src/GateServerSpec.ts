import {
  NWPCServer,
  NWPCRequest,
  NWPCContext,
  NWPCResponseObject,
  NWPCResponse,
  NWPCConfig,
  NWPC_SPEC_ERRORS,
} from "@tat-protocol/nwpc";
import { Token } from "@tat-protocol/token";
import { DebugLogger, verifySignature } from "@tat-protocol/utils";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils";
// import { sha256 } from "@noble/hashes/sha256";
import { StorageInterface } from "@tat-protocol/storage";
import { randomBytes } from "crypto";
import {
  TurnstileChallenge,
  TurnstileProof,
  TurnstileProofFull,
  TurnstileProofMinimal,
  TurnstileResult,
  TurnstileSession,
  ChallengeEntry,
  VerificationMode,
  TurnstileRequirements,
} from "./spec-types";

const Debug = DebugLogger.getInstance();

/**
 * Gate Server configuration
 */
export interface GateServerSpecConfig extends NWPCConfig {
  storage: StorageInterface;
  serviceName: string;
  defaultVerificationMode?: VerificationMode;
  challengeExpiry?: number; // Seconds (default: 300 = 5 minutes)
  sessionExpiry?: number; // Seconds (default: 3600 = 1 hour)
}

/**
 * Gate Server State
 */
interface GateServerState {
  challenges: Map<string, ChallengeEntry>; // nonce -> challenge
  sessions: Map<string, TurnstileSession & { holderPubkey: string }>; // sessionToken -> session
  usedNonces: Set<string>; // For replay protection
}

/**
 * GateServerSpec - Spec-compliant NWPC implementation
 *
 * Implements a Gate Agent (a type of Agent in TAT Protocol).
 * Implements TAT Protocol Extensions specification section 5 (Gate Protocol)
 * with NWPC methods:
 * - gate.challenge (issued by server)
 * - gate.verify (submitted by client)
 * - gate.result (response from server)
 *
 * Flow:
 * 1. Client requests access to a resource
 * 2. Server issues challenge with requirements
 * 3. Client submits proof of TAT ownership
 * 4. Server validates and grants/denies access
 *
 * @example
 * ```typescript
 * const turnstile = await GateServerSpec.create({
 *   storage: new NodeStorage({ path: './turnstile' }),
 *   keys: myKeys,
 *   serviceName: 'Premium Content API',
 *   relays: ['wss://relay.damus.io']
 * });
 *
 * // Client will receive challenges when accessing resources
 * ```
 */
export class GateServerSpec {
  protected config: GateServerSpecConfig;
  protected storage: StorageInterface;
  protected state!: GateServerState;
  protected isInitialized: boolean = false;
  protected stateKey: string = "";
  private nwpcServer: NWPCServer;
  private challengeExpiry: number;
  private sessionExpiry: number;

  constructor(config: GateServerSpecConfig) {
    if (!config.storage) {
      throw new Error("Storage is required");
    }

    this.config = config;
    this.storage = config.storage;
    this.challengeExpiry = (config.challengeExpiry || 300) * 1000; // Convert to ms
    this.sessionExpiry = (config.sessionExpiry || 3600) * 1000;

    // Create NWPC server
    this.nwpcServer = new NWPCServer(config);

    // Setup spec-compliant handlers
    this.setupHandlers();
  }

  /**
   * Create and initialize GateServerSpec
   */
  static async create(config: GateServerSpecConfig): Promise<GateServerSpec> {
    const turnstile = new GateServerSpec(config);
    await turnstile.nwpcServer.init();
    await turnstile.initialize();
    Debug.log("GateServerSpec initialized", "Gate");
    return turnstile;
  }

  /**
   * Initialize the server
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    this.stateKey = `gate-spec-${this.nwpcServer.getPublicKey() || "default"}`;
    await this._loadState();
    this.isInitialized = true;

    // Start cleanup interval for expired challenges/nonces
    setInterval(() => this.cleanupExpired(), 60000); // Every minute
  }

  /**
   * Setup NWPC request handlers per spec
   */
  private setupHandlers(): void {
    // gate.verify (spec 5.3.2) - Client submits proof
    this.nwpcServer.use("gate.verify", this.handleProof.bind(this));

    // Custom method for requesting access (triggers challenge)
    this.nwpcServer.use(
      "gate.request_access",
      this.handleRequestAccess.bind(this),
    );
  }

  // =============================
  // NWPC Handlers (Per Spec)
  // =============================

  /**
   * Handle access request - issues challenge (spec 5.3.1)
   */
  private async handleRequestAccess(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ): Promise<NWPCResponse | void> {
    try {
      const params = JSON.parse(req.params);
      const { resource, requirements } = params as {
        resource: string;
        requirements: TurnstileRequirements;
      };

      if (
        requirements?.tokenIdPattern &&
        !this.isSafeTokenIdPattern(requirements.tokenIdPattern)
      ) {
        return res.error(
          NWPC_SPEC_ERRORS.INVALID_PARAMS.code,
          "Unsafe tokenIdPattern",
        );
      }

      // Generate challenge
      const challenge = this.issueChallenge(
        resource,
        requirements,
        context.sender,
      );

      // Store challenge
      const entry: ChallengeEntry = {
        challenge,
        requester: context.sender,
        createdAt: Date.now(),
      };
      this.state.challenges.set(challenge.nonce, entry);
      await this._saveState();

      // Send challenge to client
      return res.send(
        {
          method: "gate.challenge",
          params: challenge,
        },
        context.sender,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.error(1000, message);
    }
  }

  /**
   * Handle proof submission (spec 4.3.2)
   */
  private async handleProof(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ): Promise<NWPCResponse | void> {
    try {
      const proof: TurnstileProof = JSON.parse(req.params);

      // Get challenge
      const challengeEntry = this.state.challenges.get(proof.nonce);
      if (!challengeEntry) {
        return res.send(
          {
            method: "gate.result",
            result: {
              granted: false,
              resource: "unknown",
              reason: "Challenge not found or expired",
            } as TurnstileResult,
          },
          context.sender,
        );
      }

      // Check if nonce already used (replay protection)
      if (this.state.usedNonces.has(proof.nonce)) {
        return res.send(
          {
            method: "gate.result",
            result: {
              granted: false,
              resource: challengeEntry.challenge.resource,
              reason: "Nonce already used (replay attack detected)",
            } as TurnstileResult,
          },
          context.sender,
        );
      }

      // Check challenge expiry
      if (Date.now() > challengeEntry.challenge.expiresAt) {
        return res.send(
          {
            method: "gate.result",
            result: {
              granted: false,
              resource: challengeEntry.challenge.resource,
              reason: "Challenge expired",
            } as TurnstileResult,
          },
          context.sender,
        );
      }

      // Verify proof
      const verificationResult = await this.verifyProof(
        proof,
        challengeEntry.challenge,
      );

      // Mark nonce as used
      this.state.usedNonces.add(proof.nonce);
      challengeEntry.usedAt = Date.now();
      this.state.challenges.set(proof.nonce, challengeEntry);
      await this._saveState();

      // Build result
      let result: TurnstileResult;

      if (verificationResult.valid) {
        // Create session token
        const session: TurnstileSession = {
          token: this._generateSessionToken(),
          validUntil: Date.now() + this.sessionExpiry,
        };

        this.state.sessions.set(session.token, {
          ...session,
          holderPubkey: verificationResult.holderPubkey || context.sender,
        });
        await this._saveState();

        result = {
          granted: true,
          resource: challengeEntry.challenge.resource,
          session,
          tatInfo: verificationResult.tatInfo,
        };
      } else {
        result = {
          granted: false,
          resource: challengeEntry.challenge.resource,
          reason: verificationResult.reason,
          requiredTAT: {
            issuer: challengeEntry.challenge.requirements.issuer,
            type: "TAT",
          },
        };
      }

      return res.send(
        {
          method: "gate.result",
          result,
        },
        context.sender,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.error(NWPC_SPEC_ERRORS.INTERNAL_ERROR.code, message);
    }
  }

  // =============================
  // Challenge Management
  // =============================

  /**
   * Issue challenge (per spec 4.3.1)
   */
  public issueChallenge(
    resource: string,
    requirements: TurnstileRequirements,
    _requester: string,
  ): TurnstileChallenge {
    // Generate cryptographically secure nonce (32 bytes)
    const nonce = bytesToHex(randomBytes(32));

    const challenge: TurnstileChallenge = {
      resource,
      requirements,
      nonce,
      expiresAt: Date.now() + this.challengeExpiry,
      verificationMode: this.config.defaultVerificationMode || "local",
    };

    return challenge;
  }

  // =============================
  // Proof Verification
  // =============================

  /**
   * Verify proof submission
   */
  private async verifyProof(
    proof: TurnstileProof,
    challenge: TurnstileChallenge,
  ): Promise<{
    valid: boolean;
    reason?: string;
    holderPubkey?: string;
    tatInfo?: any;
  }> {
    if (proof.mode === "full") {
      return this.verifyFullProof(proof, challenge);
    } else {
      return this.verifyMinimalProof(proof, challenge);
    }
  }

  /**
   * Verify full disclosure proof
   */
  private async verifyFullProof(
    proof: TurnstileProofFull,
    challenge: TurnstileChallenge,
  ): Promise<{
    valid: boolean;
    reason?: string;
    holderPubkey?: string;
    tatInfo?: any;
  }> {
    try {
      // Restore token
      const token = await new Token().restore(proof.tat);

      // Verify signature over nonce
      const nonceBytes = hexToBytes(proof.nonce);
      const sigBytes = hexToBytes(proof.signature);
      const holderPubkey = token.payload.P2PKlock;

      if (!holderPubkey) {
        return { valid: false, reason: "Token has no P2PKlock" };
      }

      const isValidSig = verifySignature(nonceBytes, sigBytes, holderPubkey);
      if (!isValidSig) {
        return { valid: false, reason: "Invalid signature on nonce" };
      }

      // Verify token signature
      if (!(await token.validate())) {
        return { valid: false, reason: "Invalid token signature" };
      }

      // Check requirements
      const requirementsCheck = this.checkRequirements(
        token,
        challenge.requirements,
      );
      if (!requirementsCheck.valid) {
        return requirementsCheck;
      }

      // All checks passed
      return {
        valid: true,
        holderPubkey,
        tatInfo: {
          tokenId: token.payload.tokenID || token.header.token_hash,
          issuer: token.payload.iss,
          expiresAt: token.payload.exp,
          tier: (token.payload.ext as any)?.tier,
        },
      };
    } catch (error) {
      return {
        valid: false,
        reason: error instanceof Error ? error.message : "Verification failed",
      };
    }
  }

  /**
   * Verify minimal disclosure proof
   */
  private async verifyMinimalProof(
    proof: TurnstileProofMinimal,
    challenge: TurnstileChallenge,
  ): Promise<{
    valid: boolean;
    reason?: string;
    holderPubkey?: string;
    tatInfo?: any;
  }> {
    try {
      // Verify signature over nonce
      const nonceBytes = hexToBytes(proof.nonce);
      const sigBytes = hexToBytes(proof.signature);
      const holderPubkey = proof.claim.holderPubkey;

      const isValidSig = verifySignature(nonceBytes, sigBytes, holderPubkey);
      if (!isValidSig) {
        return { valid: false, reason: "Invalid signature on nonce" };
      }

      // Check issuer matches
      if (proof.claim.issuer !== challenge.requirements.issuer) {
        return { valid: false, reason: "Issuer mismatch" };
      }

      // Check disclosed fields match requirements
      if (
        challenge.requirements.notExpired &&
        !proof.claim.disclosed.notExpired
      ) {
        return { valid: false, reason: "Token is expired" };
      }

      if (
        challenge.requirements.tokenIdPattern &&
        !proof.claim.disclosed.tokenIdPattern
      ) {
        return { valid: false, reason: "Token ID pattern mismatch" };
      }

      if (
        challenge.requirements.minTier &&
        (!proof.claim.disclosed.tier ||
          proof.claim.disclosed.tier < challenge.requirements.minTier)
      ) {
        return { valid: false, reason: "Insufficient tier level" };
      }

      // All checks passed
      return {
        valid: true,
        holderPubkey,
        tatInfo: {
          tokenId: proof.claim.tokenHash,
          issuer: proof.claim.issuer,
          tier: proof.claim.disclosed.tier,
        },
      };
    } catch (error) {
      return {
        valid: false,
        reason: error instanceof Error ? error.message : "Verification failed",
      };
    }
  }

  /**
   * Check if token meets requirements
   */
  private checkRequirements(
    token: Token,
    requirements: TurnstileRequirements,
  ): { valid: boolean; reason?: string } {
    // Check issuer
    if (token.payload.iss !== requirements.issuer) {
      return { valid: false, reason: "Token issuer mismatch" };
    }

    // Check expiration
    if (requirements.notExpired && token.isExpired()) {
      return { valid: false, reason: "Token is expired" };
    }

    // Check token ID pattern
    if (requirements.tokenIdPattern && token.payload.tokenID) {
      if (!this.isSafeTokenIdPattern(requirements.tokenIdPattern)) {
        return { valid: false, reason: "Unsafe token ID pattern" };
      }
      let regex: RegExp;
      try {
        regex = new RegExp(requirements.tokenIdPattern);
      } catch {
        return { valid: false, reason: "Invalid token ID pattern" };
      }
      if (!regex.test(token.payload.tokenID)) {
        return { valid: false, reason: "Token ID pattern mismatch" };
      }
    }

    // Check tier
    if (requirements.minTier) {
      const tier = (token.payload.ext as any)?.tier;
      if (!tier || tier < requirements.minTier) {
        return { valid: false, reason: "Insufficient tier level" };
      }
    }

    // Check custom field
    if (requirements.customCheck) {
      const fieldValue = this.getNestedField(
        token.payload.ext,
        requirements.customCheck.field,
      );

      if (
        !this.checkOperator(
          fieldValue,
          requirements.customCheck.operator,
          requirements.customCheck.value,
        )
      ) {
        return { valid: false, reason: "Custom requirement not met" };
      }
    }

    return { valid: true };
  }

  /**
   * Get nested field from object
   */
  private getNestedField(obj: any, path: string): any {
    return path.split(".").reduce((current, part) => current?.[part], obj);
  }

  /**
   * Check operator
   */
  private checkOperator(
    fieldValue: any,
    operator: "eq" | "gt" | "lt" | "contains",
    value: any,
  ): boolean {
    switch (operator) {
      case "eq":
        return fieldValue === value;
      case "gt":
        return fieldValue > value;
      case "lt":
        return fieldValue < value;
      case "contains":
        return Array.isArray(fieldValue) && fieldValue.includes(value);
      default:
        return false;
    }
  }

  // =============================
  // Session Management
  // =============================

  /**
   * Verify session token
   */
  public verifySession(sessionToken: string): boolean {
    const session = this.state.sessions.get(sessionToken);
    if (!session) return false;

    if (Date.now() > session.validUntil) {
      this.state.sessions.delete(sessionToken);
      return false;
    }

    return true;
  }

  // =============================
  // Cleanup
  // =============================

  /**
   * Clean up expired challenges and nonces
   */
  private cleanupExpired(): void {
    const now = Date.now();

    // Clean up expired challenges
    for (const [nonce, entry] of this.state.challenges.entries()) {
      if (now > entry.challenge.expiresAt + 3600000) {
        // Keep for 1 hour after expiry
        this.state.challenges.delete(nonce);
        this.state.usedNonces.delete(nonce);
      }
    }

    // Clean up expired sessions
    for (const [token, session] of this.state.sessions.entries()) {
      if (now > session.validUntil) {
        this.state.sessions.delete(token);
      }
    }
  }

  // =============================
  // State Management
  // =============================

  protected async _loadState(): Promise<void> {
    const savedState = await this.storage.getItem(this.stateKey);
    if (savedState) {
      const parsed = JSON.parse(savedState);
      this.state = {
        challenges: new Map(parsed.challenges || []),
        sessions: new Map(parsed.sessions || []),
        usedNonces: new Set(parsed.usedNonces || []),
      };
    } else {
      this.state = {
        challenges: new Map(),
        sessions: new Map(),
        usedNonces: new Set(),
      };
      await this._saveState();
    }
  }

  protected async _saveState(): Promise<void> {
    const serialized = {
      challenges: Array.from(this.state.challenges.entries()),
      sessions: Array.from(this.state.sessions.entries()),
      usedNonces: Array.from(this.state.usedNonces),
    };
    await this.storage.setItem(this.stateKey, JSON.stringify(serialized));
  }

  // =============================
  // Utility Methods
  // =============================

  private _generateSessionToken(): string {
    return bytesToHex(randomBytes(32));
  }

  private isSafeTokenIdPattern(pattern: string): boolean {
    // Basic safeguards against ReDoS patterns
    if (pattern.length > 128) return false;
    // Disallow backreferences and lookbehinds
    if (/\\\d/.test(pattern)) return false;
    if (/\(\?<(!|=)/.test(pattern)) return false;
    // Disallow lookaheads (?= and (?!
    if (/\(\?[=!]/.test(pattern)) return false;
    // Disallow nested quantifiers like (a+)+ or (.*)+
    if (/\([^)]*[*+][^)]*\)[*+?]/.test(pattern)) return false;
    // Disallow multiple unbounded wildcards
    if (/(\.\*){2,}/.test(pattern)) return false;
    // Disallow alternation with quantifier like (a|b)+
    if (/\([^)]*\|[^)]*\)[*+]/.test(pattern)) return false;
    return true;
  }

  /**
   * Get NWPC server
   */
  public getServer(): NWPCServer {
    return this.nwpcServer;
  }

  /**
   * Get turnstile public key
   */
  public getPublicKey(): string | undefined {
    return this.nwpcServer.getPublicKey();
  }
}
