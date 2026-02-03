import { KeyPair } from "@tat-protocol/hdkeys";
/**
 * Recursive type for access control rules
 */
export type AccessRule =
  | string
  | number
  | boolean
  | null
  | AccessRule[]
  | {
      [key: string]: AccessRule;
    };
/**
 * Access rules object
 */
export type AccessRules = {
  [key: string]: AccessRule;
};
export declare enum TokenType {
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
  alg: string;
  typ: TokenType;
  token_hash: string;
  ver: string;
}
/**
 * Token payload structure
 */
export interface Payload {
  iss: string;
  iat: number;
  exp?: number;
  amount?: number;
  HTLC?: string;
  timeLock?: number;
  P2PKlock?: string;
  tokenID?: string;
  data_uri?: string;
  ext?: Record<string, unknown>;
}
/**
 * Derived token payload structure
 */
export interface DerivedPayload extends Payload {
  parentToken: string;
  access?: AccessRules;
}
/**
 * Parameters required for building a new token
 */
export interface TokenBuildParams {
  token_type: TokenType;
  payload: Payload;
}
/**
 * Core token class for creating, signing, and managing tokens in the TAT Protocol.
 *
 * Token represents both fungible tokens (with amounts) and Transferable Access Tokens (TATs).
 * Each token contains a header with metadata, a payload with token data, and a signature.
 * Tokens are encoded as JWTs for transport and storage.
 *
 * Key features:
 * - Support for fungible and non-fungible (TAT) token types
 * - Schnorr signature-based authentication
 * - Multiple lock mechanisms: P2PK (public key), time locks, and HTLC (hash time-locked contracts)
 * - JWT encoding/decoding for standardized format
 *
 * @example
 * ```typescript
 * // Create a new fungible token
 * const token = new Token({
 *   token_type: TokenType.FUNGIBLE,
 *   payload: {
 *     iss: 'forgePubkey',
 *     iat: Date.now(),
 *     amount: 100
 *   }
 * });
 * ```
 */
export default class Token {
  hash: string;
  signature: string;
  header: Header;
  payload: Payload;
  data: Blob | undefined;
  constructor(opts?: TokenBuildParams);
  /**
   * Builds a new token with provided parameters
   */
  build(opts: TokenBuildParams): Promise<Token>;
  getTokenType(): TokenType;
  /**
   * Restores a token from its JWT string representation.
   *
   * This method deserializes a JWT-encoded token back into a Token instance,
   * parsing the header, payload, and signature. Use this to work with tokens
   * received from others or loaded from storage.
   *
   * @param token_string - The JWT-encoded token string
   * @returns The restored Token instance
   * @throws {Error} If the JWT format is invalid or cannot be decoded
   *
   * @example
   * ```typescript
   * const token = await new Token().restore(jwtString);
   * console.log('Token amount:', token.payload.amount);
   * console.log('Token issuer:', token.payload.iss);
   * ```
   *
   * @see toJWT for the reverse operation
   */
  restore(token_string: string): Promise<Token>;
  /**
   * Signs data using Schnorr signatures.
   *
   * This method creates a cryptographic signature over the provided data using
   * the supplied key pair. In the TAT Protocol, tokens are signed by their issuer
   * (forge), and signatures are also used for P2PK lock verification.
   *
   * @param data - The data to sign (typically the token hash)
   * @param keys - The key pair containing the private key for signing
   * @returns The signature as a Uint8Array
   *
   * @example
   * ```typescript
   * const dataToSign = await token.data_to_sign();
   * const signature = await token.sign(dataToSign, forgeKeys);
   * ```
   */
  sign(data: Uint8Array, keys: KeyPair): Promise<Uint8Array>;
  /**
   * Prepares the data to be signed
   */
  data_to_sign(): Promise<Uint8Array>;
  /**
   * Creates complete token string including signature in JWT format
   */
  toJWT(signature: string): Promise<string>;
  /**
   * Reconstructs token from its string representation
   */
  fromJWT(jwt: string): Promise<Token>;
  /**
   * Converts the token to a JSON string
   */
  toJSON(): string;
  /**
   * Encodes header to base64 without padding
   */
  encode_header(): string;
  /**
   * Encodes payload to base64 without padding
   */
  encode_payload(): string;
  /**
   * Creates double hash of payload for token identification
   * @param readerPubkey - Optional reader's public key for access control
   * @param timeWindow - Optional time window for nonce
   */
  create_token_hash(
    readerPubkey?: string,
    timeWindow?: number,
  ): Promise<string>;
  /**
   * Checks if token has a P2PKlock requirement
   */
  hasP2PKLock(): boolean;
  /**
   * Checks if token is currently time locked
   */
  isTimeLocked(): boolean;
  /**
   * Checks if token is currently time locked
   */
  hasHTLC(): boolean;
  /**
   * Gets token amount, defaults to 0 if not set
   */
  getAmount(): number;
  getHeader(): Header;
  getPayload(): Payload;
  /**
   * Gets issuer (forge) public key
   */
  getIssuer(): string;
  /**
   * Creates a standard token header
   */
  static createHeader(typ: TokenType, tokenHash: string): Header;
  /**
   * Creates a token payload from a parameter object.
   *
   * This static helper method constructs a properly formatted payload with
   * required and optional fields. It automatically sets the issued-at timestamp
   * and includes any provided locks, amounts, or metadata.
   *
   * @param payloadObj - Object containing payload parameters (iss, amount, locks, etc.)
   * @returns A formatted Payload or DerivedPayload object
   *
   * @example
   * ```typescript
   * const payload = Token.createPayload({
   *   iss: 'forgePubkey',
   *   amount: 50,
   *   P2PKlock: 'recipientPubkey',
   *   exp: Math.floor(Date.now() / 1000) + 86400 // 24 hours
   * });
   * ```
   */
  static createPayload(
    payloadObj: Record<string, unknown>,
  ): Payload | DerivedPayload;
  /**
   * Checks if the token has expired
   */
  isExpired(): boolean;
  /**
   * Validates the token's structure and required fields.
   *
   * This method performs type-specific validation to ensure the token has all
   * required fields and meets the constraints for its token type. It checks:
   * - Presence of issuer and issued-at timestamp
   * - Expiration status
   * - Type-specific requirements (amount for fungible, tokenID for TATs)
   *
   * @returns True if the token is valid
   * @throws {Error} If validation fails, with a descriptive error message
   *
   * @example
   * ```typescript
   * try {
   *   await token.validate();
   *   console.log('Token is valid');
   * } catch (error) {
   *   console.error('Token validation failed:', error.message);
   * }
   * ```
   */
  validate(): Promise<boolean>;
  /**
   * Locks the token with a specific lock type
   */
  lock(lockType: "P2PK" | "HTLC" | "TIME", lockValue: string | number): void;
  /**
   * Unlocks the token
   */
  unlock(lockType: "P2PK" | "HTLC" | "TIME"): void;
  /**
   * Checks if token is locked
   */
  isLocked(): boolean;
  /**
   * Gets the lock type if any
   */
  getLockType(): "P2PK" | "HTLC" | "TIME" | null;
  /**
   * Gets the access rules for the token
   */
  getAccessRules(): AccessRules | undefined;
  /**
   * Creates a derived token with flexible access control rules.
   *
   * Derived tokens are linked to a parent token and can have restricted access rights.
   * This is useful for creating temporary passes, delegation tokens, or scoped access
   * credentials. The derived token references the parent's hash and includes custom
   * access rules that define what the holder can do.
   *
   * @param tokenType - The type of derived token to create
   * @param parentToken - The parent token to derive from (must have a valid hash)
   * @param accessRules - Flexible access control rules defining permissions
   * @returns A new derived token instance
   * @throws {Error} If the parent token doesn't have a valid hash
   *
   * @example
   * ```typescript
   * // Create a temporary access pass from a master ticket
   * const derivedToken = await Token.createDerivedToken(
   *   TokenType.TAT,
   *   masterTicket,
   *   {
   *     features: ['basic_access'],
   *     expiresAt: Date.now() + 3600000 // 1 hour
   *   }
   * );
   * ```
   */
  static createDerivedToken(
    tokenType: TokenType,
    parentToken: Token,
    accessRules: AccessRules,
  ): Promise<Token>;
}
