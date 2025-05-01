import { base64 } from "@scure/base";
import { bytesToHex } from "@noble/hashes/utils";
import {
  createHash,
  removeBase64Padding,
  signMessage,
  DebugLogger,
} from "@tat-protocol/utils";
import { KeyPair } from "@tat-protocol/hdkeys";




export enum TokenType {
  /**
   * Fungible tokens - interchangeable and identical
   * Example: Credit tokens
   */
  FUNGIBLE = "FUNGIBLE",

  /**
   * Non-fungible tokens - unique and non-interchangeable
   * Transferable Access Token
   * Example: Digital art, collectibles
   */
  TAT = "TAT",
}



/**
 * JWT header structure for token
 */
export interface Header {
  alg: string; // Signature algorithm (e.g., "Schnorr")
  typ: TokenType; // Token type identifier
  token_hash?: string; // Hash of the token payload
}

/**
 * Token payload structure
 */
export interface Payload {
  iss: string; // Issuer (forge) pubkey
  iat: number; // Issued at timestamp
  exp?: number; // Expiration timestamp (in seconds)
  amount?: number; // Token amount/value
  HTLC?: string; // Hash of secret pre-image Priority #1
  timeLock?: number; // Timelock constraint Priority #2
  P2PKlock?: string; // Public key lock Priority #3
  tokenID?: string; // Unique token identifier
  data_uri?: string; // Optional data URI
  ext?: Record<string, any>; // Optional extension fields
}

/**
 * Derived token payload structure
 */
export interface DerivedPayload extends Payload {
  parentToken: string;
  access?: {
    [key: string]: any; // Flexible access control rules
  };
}

/**
 * Parameters required for building a new token
 */
export interface TokenBuildParams {
  token_type: TokenType;
  payload: Payload;
}

/**
 * Token class for handling token operations
 */
export default class Token {
  public hash: string | undefined;
  public signature!: string;
  public header!: Header;
  public payload!: Payload;
  public data: Blob | undefined;

  constructor(opts?: TokenBuildParams) {
    if (opts) {
      // Use void to handle the promise without awaiting
      void this.build(opts);
    }
  }

  /**
   * Builds a new token with provided parameters
   */
  async build(opts: TokenBuildParams): Promise<Token> {
    this.header = {
      alg: "Schnorr",
      typ: opts.token_type,
    };
    this.payload = opts.payload;
    await this.create_token_hash();
    return this;
  }

  getTokenType(): TokenType {
    return this.header.typ;
  }

  /**
   * Restores a token from its string representation
   */
  restore(token_string: string): Promise<Token> {
    return this.fromJWT(token_string);
  }

  /**
   * Sign data using the provided private key
   * @param data - The data to sign
   * @returns The signature
   */
  async sign(data: Uint8Array, keys: KeyPair): Promise<Uint8Array> {
    return signMessage(data, keys);
  }

  /**
   * Prepares the data to be signed
   */
  async data_to_sign(): Promise<Uint8Array> {
    // First ensure we have a token hash
    if (!this.header.token_hash) {
      await this.create_token_hash();
    }
    // Sign only the token hash
    return new TextEncoder().encode(this.header.token_hash);
  }

  /**
   * Creates complete token string including signature in JWT format
   */
  async toJWT(signature: string): Promise<string> {
    const header_payload = `${this.encode_header()}.${this.encode_payload()}`;
    this.signature = signature;
    return `${header_payload}.${signature}`;
  }

  /**
   * Reconstructs token from its string representation
   */
  async fromJWT(jwt: string): Promise<Token> {
    const parts = jwt.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid JWT format");
    }

    DebugLogger.getInstance().log("From JWT", "[TOKEN]", { parts });
    const [header, payload, signature] = parts;
    if (!header || !payload || !signature) {
      throw new Error("Invalid JWT format");
    }

    try {
      // Add proper padding before decoding
      const paddedHeader = header.padEnd(Math.ceil(header.length / 4) * 4, "=");
      const paddedPayload = payload.padEnd(
        Math.ceil(payload.length / 4) * 4,
        "=",
      );

      try {
        const headerBytes = base64.decode(paddedHeader);
        const payloadBytes = base64.decode(paddedPayload);

        this.header = JSON.parse(new TextDecoder().decode(headerBytes));
        this.payload = JSON.parse(new TextDecoder().decode(payloadBytes));
        this.signature = signature; // Store the signature as is
      } catch (error) {
        throw new Error("Invalid JWT format");
      }

      return this;
    } catch (error) {
      if (error instanceof Error && error.message === "Invalid JWT format") {
        throw error;
      }
      throw new Error("Invalid JWT format");
    }
  }

  /**
   * Converts the token to a JSON string
   */
  toJSON(): string {
    return JSON.stringify(
      {
        header: this.header,
        payload: this.payload,
        signature: this.signature,
      },
      null,
      2,
    );
  }

  /**
   * Encodes header to base64 without padding
   */
  encode_header(): string {
    const data = new TextEncoder().encode(JSON.stringify(this.header));
    return removeBase64Padding(base64.encode(data));
  }

  /**
   * Encodes payload to base64 without padding
   */
  encode_payload(): string {
    const data = new TextEncoder().encode(JSON.stringify(this.payload));
    return removeBase64Padding(base64.encode(data));
  }

  /**
   * Creates double hash of payload for token identification
   * @param readerPubkey - Optional reader's public key for access control
   * @param timeWindow - Optional time window for nonce
   */
  async create_token_hash(
    readerPubkey?: string,
    timeWindow?: number,
  ): Promise<string> {
    // Create base payload hash
    const dataToHash = this.encode_payload();
    const hash1 = await createHash(JSON.stringify(dataToHash));

    // Add time-based nonce if provided
    let nonceData = new TextDecoder().decode(hash1);
    if (timeWindow) {
      const timeSlot = Math.floor(Date.now() / (timeWindow * 1000));
      nonceData += `:${timeSlot}`;
    }

    // Add reader pubkey if provided
    if (readerPubkey) {
      nonceData += `:${readerPubkey}`;
    }

    // Create final hash
    const hash2 = await createHash(nonceData);
    this.header.token_hash = bytesToHex(new Uint8Array(hash2));
    return this.header.token_hash;
  }

  // Utility methods from previous version

  /**
   * Checks if token has a P2PKlock requirement
   */
  hasP2PKLock(): boolean {
    return !!this.payload.P2PKlock;
  }

  /**
   * Checks if token is currently time locked
   */
  isTimeLocked(): boolean {
    if (!this.payload.timeLock) return false;
    return this.payload.timeLock > Date.now();
  }

  /**
   * Checks if token is currently time locked
   */
  hasHTLC(): boolean {
    return !!this.payload.HTLC;
  }

  /**
   * Gets token amount, defaults to 0 if not set
   */
  getAmount(): number {
    return this.payload.amount ?? 0;
  }

  getHeader(): Header {
    return this.header;
  }

  getPayload(): Payload {
    return this.payload;
  }

  /**
   * Gets issuer (forge) public key
   */
  getIssuer(): string {
    return this.payload.iss;
  }

  /**
   * Creates a standard token header
   */
  static createHeader(typ: TokenType, tokenHash: string): Header {
    return {
      alg: "Schnorr",
      typ,
      token_hash: tokenHash,
    };
  }

  /**
   * Creates a token payload with provided parameters
   */
  static createPayload(
    payloadObj: Record<string, any>,
  ): Payload | DerivedPayload {
    const payload: Payload = {
      iss: payloadObj.iss,
      iat: Math.floor(Date.now() / 1000), // Convert to seconds
    };

    if (payloadObj.amount !== undefined) payload.amount = payloadObj.amount;
    if (payloadObj.P2PKlock) payload.P2PKlock = payloadObj.P2PKlock;
    if (payloadObj.timeLock) payload.timeLock = payloadObj.timeLock;
    if (payloadObj.tokenID !== undefined) payload.tokenID = payloadObj.tokenID;
    if (payloadObj.data_uri) payload.data_uri = payloadObj.data_uri;
    if (payloadObj.HTLC) payload.HTLC = payloadObj.HTLC;
    if (payloadObj.exp) payload.exp = payloadObj.exp;

    return payload;
  }

  /**
   * Checks if the token has expired
   */
  isExpired(): boolean {
    if (this.payload.exp) {
      const now = Math.floor(Date.now() / 1000);
      return now >= this.payload.exp;
    }
    return false;
  }

  /**
   * Validates token based on its type
   */
  async validate(): Promise<boolean> {
    // Check required fields
    if (!this.payload.iss) {
      throw new Error("Token must have an issuer");
    }
    if (!this.payload.iat) {
      throw new Error("Token must have an issued at timestamp");
    }

    // Check expiration
    if (this.isExpired()) {
      throw new Error("Token has expired");
    }

    // Type-specific validation
    switch (this.header.typ) {
      case TokenType.FUNGIBLE:
        if (this.payload.amount === undefined) {
          throw new Error("Fungible token must have an amount");
        }
        break;
      case TokenType.TAT:
        if (this.payload.tokenID === undefined) {
          throw new Error("Transferable Access Token must have a tokenID");
        }
        break;
      default:
        throw new Error(`Invalid token type: ${this.header.typ}`);
    }

    return true;
  }

  /**
   * Locks the token with a specific lock type
   */
  lock(lockType: "P2PK" | "HTLC" | "TIME", lockValue: string | number): void {
    switch (lockType) {
      case "P2PK":
        this.payload.P2PKlock = lockValue as string;
        break;
      case "HTLC":
        this.payload.HTLC = lockValue as string;
        break;
      case "TIME":
        this.payload.timeLock = lockValue as number;
        break;
      default:
        throw new Error("Invalid lock type");
    }
  }

  /**
   * Unlocks the token
   */
  unlock(lockType: "P2PK" | "HTLC" | "TIME"): void {
    switch (lockType) {
      case "P2PK":
        delete this.payload.P2PKlock;
        break;
      case "HTLC":
        delete this.payload.HTLC;
        break;
      case "TIME":
        delete this.payload.timeLock;
        break;
      default:
        throw new Error("Invalid lock type");
    }
  }

  /**
   * Checks if token is locked
   */
  isLocked(): boolean {
    return !!(
      this.payload.P2PKlock ||
      this.payload.HTLC ||
      this.payload.timeLock
    );
  }

  /**
   * Gets the lock type if any
   */
  getLockType(): "P2PK" | "HTLC" | "TIME" | null {
    if (this.payload.P2PKlock) return "P2PK";
    if (this.payload.HTLC) return "HTLC";
    if (this.payload.timeLock) return "TIME";
    return null;
  }

  /**
   * Gets the access rules for the token
   */
  getAccessRules(): { [key: string]: any } | undefined {
    return (this.payload as DerivedPayload).access;
  }

  /**
   * Creates a derived token with flexible access control
   * @param parentToken - The parent token to derive from
   * @param accessRules - Flexible access control rules
   * @returns A new derived token
   */
  static async createDerivedToken(
    tokenType: TokenType,
    parentToken: Token,
    accessRules: { [key: string]: any },
  ): Promise<Token> {
    // Verify parent token is valid
    if (!parentToken.header.token_hash) {
      throw new Error("Parent token must have a valid hash");
    }

    // Create derived token payload with correct type
    const derivedPayload: DerivedPayload = {
      ...parentToken.payload,
      parentToken: parentToken.header.token_hash,
      access: accessRules,
    };

    // Create the derived token
    const derivedToken = new DerivedToken(parentToken, accessRules);
    await derivedToken.build({
      token_type: tokenType,
      payload: derivedPayload,
    });

    return derivedToken;
  }
}

/**
 * Derived token class for handling derived token operations
 */
class DerivedToken extends Token {
  public parentToken: Token;
  public accessRules: { [key: string]: any };
  public payload: DerivedPayload;
  constructor(parentToken: Token, accessRules: { [key: string]: any }) {
    super();
    if (!parentToken.header.token_hash) {
      throw new Error("Parent token must have a valid hash");
    }
    this.parentToken = parentToken;
    this.accessRules = accessRules;
    this.payload = {
      parentToken: parentToken.header.token_hash,
      access: accessRules,
      ...parentToken.payload,
    };
  }

  async build(opts: TokenBuildParams): Promise<Token> {
    if (!this.parentToken.header.token_hash) {
      throw new Error("Parent token must have a valid hash");
    }
    await super.build(opts);
    return this;
  }

  /**
   * Verifies if this token is derived from a parent token
   * @param parentTokenHash - The hash of the parent token to verify against
   * @returns true if this token is derived from the given parent token
   */
  isDerivedFrom(parentTokenHash: string): boolean {
    return this.payload.parentToken === parentTokenHash;
  }

  /**
   * Gets the accessible features
   */
  getFeatures(): string[] | undefined {
    return this.payload.access?.features;
  }

  /**
   * Gets the access rules for the token
   */
  getAccessRules(): { [key: string]: any } | undefined {
    return this.payload.access;
  }
}
