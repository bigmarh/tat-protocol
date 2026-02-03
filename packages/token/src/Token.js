import { base64 } from "@scure/base";
import { bytesToHex } from "@noble/hashes/utils";
import { createHash, removeBase64Padding, signMessage, DebugLogger, } from "@tat-protocol/utils";
export var TokenType;
(function (TokenType) {
    /**
     * Fungible tokens - interchangeable and identical
     * Example: Credit tokens
     */
    TokenType["FUNGIBLE"] = "FUNGIBLE";
    /**
     * Non-fungible tokens - unique and non-interchangeable
     * Transferable Access Token
     * Example: Digital art, collectibles
     */
    TokenType["TAT"] = "TAT";
})(TokenType || (TokenType = {}));
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
    hash;
    signature;
    header;
    payload;
    data;
    constructor(opts) {
        if (opts) {
            // Use void to handle the promise without awaiting
            void this.build(opts);
        }
    }
    /**
     * Builds a new token with provided parameters
     */
    async build(opts) {
        this.header = {
            alg: "Schnorr",
            typ: opts.token_type,
            token_hash: "",
            ver: "1.0.0",
        };
        this.payload = opts.payload;
        await this.create_token_hash();
        return this;
    }
    getTokenType() {
        return this.header.typ;
    }
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
    restore(token_string) {
        return this.fromJWT(token_string);
    }
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
    async sign(data, keys) {
        return signMessage(data, keys);
    }
    /**
     * Prepares the data to be signed
     */
    async data_to_sign() {
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
    async toJWT(signature) {
        const header_payload = `${this.encode_header()}.${this.encode_payload()}`;
        this.signature = signature;
        return `${header_payload}.${signature}`;
    }
    /**
     * Reconstructs token from its string representation
     */
    async fromJWT(jwt) {
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
            const paddedPayload = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
            try {
                const headerBytes = base64.decode(paddedHeader);
                const payloadBytes = base64.decode(paddedPayload);
                this.header = JSON.parse(new TextDecoder().decode(headerBytes));
                this.payload = JSON.parse(new TextDecoder().decode(payloadBytes));
                this.signature = signature; // Store the signature as is
            }
            catch (error) {
                throw new Error("Invalid JWT format");
            }
            return this;
        }
        catch (error) {
            if (error instanceof Error && error.message === "Invalid JWT format") {
                throw error;
            }
            throw new Error("Invalid JWT format");
        }
    }
    /**
     * Converts the token to a JSON string
     */
    toJSON() {
        return JSON.stringify({
            header: this.header,
            payload: this.payload,
            signature: this.signature,
        }, null, 2);
    }
    /**
     * Encodes header to base64 without padding
     */
    encode_header() {
        const data = new TextEncoder().encode(JSON.stringify(this.header));
        return removeBase64Padding(base64.encode(data));
    }
    /**
     * Encodes payload to base64 without padding
     */
    encode_payload() {
        const data = new TextEncoder().encode(JSON.stringify(this.payload));
        return removeBase64Padding(base64.encode(data));
    }
    /**
     * Creates double hash of payload for token identification
     * @param readerPubkey - Optional reader's public key for access control
     * @param timeWindow - Optional time window for nonce
     */
    async create_token_hash(readerPubkey, timeWindow) {
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
    hasP2PKLock() {
        return !!this.payload.P2PKlock;
    }
    /**
     * Checks if token is currently time locked
     */
    isTimeLocked() {
        if (!this.payload.timeLock)
            return false;
        return this.payload.timeLock > Date.now();
    }
    /**
     * Checks if token is currently time locked
     */
    hasHTLC() {
        return !!this.payload.HTLC;
    }
    /**
     * Gets token amount, defaults to 0 if not set
     */
    getAmount() {
        return this.payload.amount ?? 0;
    }
    getHeader() {
        return this.header;
    }
    getPayload() {
        return this.payload;
    }
    /**
     * Gets issuer (forge) public key
     */
    getIssuer() {
        return this.payload.iss;
    }
    /**
     * Creates a standard token header
     */
    static createHeader(typ, tokenHash) {
        return {
            alg: "Schnorr",
            typ,
            token_hash: tokenHash,
            ver: "1.0.0",
        };
    }
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
    static createPayload(payloadObj) {
        const payload = {
            iss: payloadObj.iss,
            iat: Math.floor(Date.now() / 1000), // Convert to seconds
        };
        if (payloadObj.amount !== undefined && payloadObj.amount !== null) {
            payload.amount = payloadObj.amount;
        }
        if (payloadObj.P2PKlock) {
            payload.P2PKlock = payloadObj.P2PKlock;
        }
        if (payloadObj.timeLock) {
            payload.timeLock = payloadObj.timeLock;
        }
        if (payloadObj.tokenID !== undefined && payloadObj.tokenID !== null) {
            payload.tokenID = payloadObj.tokenID;
        }
        if (payloadObj.data_uri) {
            payload.data_uri = payloadObj.data_uri;
        }
        if (payloadObj.HTLC) {
            payload.HTLC = payloadObj.HTLC;
        }
        if (payloadObj.exp) {
            payload.exp = payloadObj.exp;
        }
        return payload;
    }
    /**
     * Checks if the token has expired
     */
    isExpired() {
        if (this.payload.exp) {
            const now = Math.floor(Date.now() / 1000);
            return now >= this.payload.exp;
        }
        return false;
    }
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
    async validate() {
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
    lock(lockType, lockValue) {
        switch (lockType) {
            case "P2PK":
                this.payload.P2PKlock = lockValue;
                break;
            case "HTLC":
                this.payload.HTLC = lockValue;
                break;
            case "TIME":
                this.payload.timeLock = lockValue;
                break;
            default:
                throw new Error("Invalid lock type");
        }
    }
    /**
     * Unlocks the token
     */
    unlock(lockType) {
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
    isLocked() {
        return !!(this.payload.P2PKlock ||
            this.payload.HTLC ||
            this.payload.timeLock);
    }
    /**
     * Gets the lock type if any
     */
    getLockType() {
        if (this.payload.P2PKlock)
            return "P2PK";
        if (this.payload.HTLC)
            return "HTLC";
        if (this.payload.timeLock)
            return "TIME";
        return null;
    }
    /**
     * Gets the access rules for the token
     */
    getAccessRules() {
        return this.payload.access;
    }
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
    static async createDerivedToken(tokenType, parentToken, accessRules) {
        // Verify parent token is valid
        if (!parentToken.header.token_hash) {
            throw new Error("Parent token must have a valid hash");
        }
        // Create derived token payload with correct type
        const derivedPayload = {
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
    parentToken;
    accessRules;
    payload;
    constructor(parentToken, accessRules) {
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
    async build(opts) {
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
    isDerivedFrom(parentTokenHash) {
        return this.payload.parentToken === parentTokenHash;
    }
    /**
     * Gets the accessible features
     */
    getFeatures() {
        const features = this.payload.access?.features;
        if (Array.isArray(features)) {
            return features.filter((f) => typeof f === 'string');
        }
        return undefined;
    }
    /**
     * Gets the access rules for the token
     */
    getAccessRules() {
        return this.payload.access;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiVG9rZW4uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJUb2tlbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLEVBQUUsTUFBTSxFQUFFLE1BQU0sYUFBYSxDQUFDO0FBQ3JDLE9BQU8sRUFBRSxVQUFVLEVBQUUsTUFBTSxxQkFBcUIsQ0FBQztBQUNqRCxPQUFPLEVBQ0wsVUFBVSxFQUNWLG1CQUFtQixFQUNuQixXQUFXLEVBQ1gsV0FBVyxHQUNaLE1BQU0scUJBQXFCLENBQUM7QUFtQjdCLE1BQU0sQ0FBTixJQUFZLFNBYVg7QUFiRCxXQUFZLFNBQVM7SUFDbkI7OztPQUdHO0lBQ0gsa0NBQXFCLENBQUE7SUFFckI7Ozs7T0FJRztJQUNILHdCQUFXLENBQUE7QUFDYixDQUFDLEVBYlcsU0FBUyxLQUFULFNBQVMsUUFhcEI7QUE0Q0Q7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0F5Qkc7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLEtBQUs7SUFDakIsSUFBSSxDQUFVO0lBQ2QsU0FBUyxDQUFVO0lBQ25CLE1BQU0sQ0FBVTtJQUNoQixPQUFPLENBQVc7SUFDbEIsSUFBSSxDQUFtQjtJQUU5QixZQUFZLElBQXVCO1FBQ2pDLElBQUksSUFBSSxFQUFFLENBQUM7WUFDVCxrREFBa0Q7WUFDbEQsS0FBSyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ3hCLENBQUM7SUFDSCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsS0FBSyxDQUFDLElBQXNCO1FBQ2hDLElBQUksQ0FBQyxNQUFNLEdBQUc7WUFDWixHQUFHLEVBQUUsU0FBUztZQUNkLEdBQUcsRUFBRSxJQUFJLENBQUMsVUFBVTtZQUNwQixVQUFVLEVBQUUsRUFBRTtZQUNkLEdBQUcsRUFBRSxPQUFPO1NBQ2IsQ0FBQztRQUNGLElBQUksQ0FBQyxPQUFPLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQztRQUM1QixNQUFNLElBQUksQ0FBQyxpQkFBaUIs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U0FBUyxDQUFDO0lBQ25CLENBQUM7SUFFRDs7T0FFRztJQUNILGNBQWM7UUFDWixPQUFPLElBQUksQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDO0lBQzdCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGJhc2U2NCB9IGZyb20gXCJAc2N1cmUvYmFzZVwiO1xuaW1wb3J0IHsgYnl0ZXNUb0hleCB9IGZyb20gXCJAbm9ibGUvaGFzaGVzL3V0aWxzXCI7XG5pbXBvcnQge1xuICBjcmVhdGVIYXNoLFxuICByZW1vdmVCYXNlNjRQYWRkaW5nLFxuICBzaWduTWVzc2FnZSxcbiAgRGVidWdMb2dnZXIsXG59IGZyb20gXCJAdGF0LXByb3RvY29sL3V0aWxzXCI7XG5pbXBvcnQgeyBLZXlQYWlyIH0gZnJvbSBcIkB0YXQtcHJvdG9jb2wvaGRrZXlzXCI7XG5cbi8qKlxuICogUmVjdXJzaXZlIHR5cGUgZm9yIGFjY2VzcyBjb250cm9sIHJ1bGVzXG4gKi9cbmV4cG9ydCB0eXBlIEFjY2Vzc1J1bGUgPVxuICB8IHN0cmluZ1xuICB8IG51bWJlclxuICB8IGJvb2xlYW5cbiAgfCBudWxsXG4gIHwgQWNjZXNzUnVsZVtdXG4gIHwgeyBba2V5OiBzdHJpbmddOiBBY2Nlc3NSdWxlIH07XG5cbi8qKlxuICogQWNjZXNzIHJ1bGVzIG9iamVjdFxuICovXG5leHBvcnQgdHlwZSBBY2Nlc3NSdWxlcyA9IHsgW2tleTogc3RyaW5nXTogQWNjZXNzUnVsZSB9O1xuXG5leHBvcnQgZW51bSBUb2tlblR5cGUge1xuICAvKipcbiAgICogRnVuZ2libGUgdG9rZW5zIC0gaW50ZXJjaGFuZ2VhYmxlIGFuZCBpZGVudGljYWxcbiAgICogRXhhbXBsZTogQ3JlZGl0IHRva2Vuc1xuICAgKi9cbiAgRlVOR0lCTEUgPSBcIkZVTkdJQkxFXCIsXG5cbiAgLyoqXG4gICAqIE5vbi1mdW5naWJsZSB0b2tlbnMgLSB1bmlxdWUgYW5kIG5vbi1pbnRlcmNoYW5nZWFibGVcbiAgICogVHJhbnNmZXJhYmxlIEFjY2VzcyBUb2tlblxuICAgKiBFeGFtcGxlOiBEaWdpdGFsIGFydCwgY29sbGVjdGlibGVzXG4gICAqL1xuICBUQVQgPSBcIlRBVFwiLFxufVxuXG4vKipcbiAqIEpXVCBoZWFkZXIgc3RydWN0dXJlIGZvciB0b2tlblxuICovXG5leHBvcnQgaW50ZXJmYWNlIEhlYWRlciB7XG4gIGFsZzogc3RyaW5nOyAvLyBTaWduYXR1cmUgYWxnb3JpdGhtIChlLmcuLCBcIlNjaG5vcnJcIilcbiAgdHlwOiBUb2tlblR5cGU7IC8vIFRva2VuIHR5cGUgaWRlbnRpZmllclxuICB0b2tlbl9oYXNoOiBzdHJpbmc7IC8vIEhhc2ggb2YgdGhlIHRva2VuIHBheWxvYWRcbiAgdmVyOiBzdHJpbmc7IC8vIFByb3RvY29sIHZlcnNpb24gKGUuZy4sIFwiMS4wLjBcIilcbn1cblxuLyoqXG4gKiBUb2tlbiBwYXlsb2FkIHN0cnVjdHVyZVxuICovXG5leHBvcnQgaW50ZXJmYWNlIFBheWxvYWQge1xuICBpc3M6IHN0cmluZzsgLy8gSXNzdWVyIChmb3JnZSkgcHVia2V5XG4gIGlhdDogbnVtYmVyOyAvLyBJc3N1ZWQgYXQgdGltZXN0YW1wXG4gIGV4cD86IG51bWJlcjsgLy8gRXhwaXJhdGlvbiB0aW1lc3RhbXAgKGluIHNlY29uZHMpXG4gIGFtb3VudD86IG51bWJlcjsgLy8gVG9rZW4gYW1vdW50L3ZhbHVlXG4gIEhUTEM/OiBzdHJpbmc7IC8vIEhhc2ggb2Ygc2VjcmV0IHByZS1pbWFnZSBQcmlvcml0eSAjMVxuICB0aW1lTG9jaz86IG51bWJlcjsgLy8gVGltZWxvY2sgY29uc3RyYWludCBQcmlvcml0eSAjMlxuICBQMlBLbG9jaz86IHN0cmluZzsgLy8gUHVibGljIGtleSBsb2NrIFByaW9yaXR5ICMzXG4gIHRva2VuSUQ/OiBzdHJpbmc7IC8vIFVuaXF1ZSB0b2tlbiBpZGVudGlmaWVyXG4gIGRhdGFfdXJpPzogc3RyaW5nOyAvLyBPcHRpb25hbCBkYXRhIFVSSVxuICBleHQ/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjsgLy8gT3B0aW9uYWwgZXh0ZW5zaW9uIGZpZWxkc1xufVxuXG4vKipcbiAqIERlcml2ZWQgdG9rZW4gcGF5bG9hZCBzdHJ1Y3R1cmVcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBEZXJpdmVkUGF5bG9hZCBleHRlbmRzIFBheWxvYWQge1xuICBwYXJlbnRUb2tlbjogc3RyaW5nO1xuICBhY2Nlc3M/OiBBY2Nlc3NSdWxlczsgLy8gRmxleGlibGUgYWNjZXNzIGNvbnRyb2wgcnVsZXNcbn1cblxuLyoqXG4gKiBQYXJhbWV0ZXJzIHJlcXVpcmVkIGZvciBidWlsZGluZyBhIG5ldyB0b2tlblxuICovXG5leHBvcnQgaW50ZXJmYWNlIFRva2VuQnVpbGRQYXJhbXMge1xuICB0b2tlbl90eXBlOiBUb2tlblR5cGU7XG4gIHBheWxvYWQ6IFBheWxvYWQ7XG59XG5cbi8qKlxuICogQ29yZSB0b2tlbiBjbGFzcyBmb3IgY3JlYXRpbmcsIHNpZ25pbmcsIGFuZCBtYW5hZ2luZyB0b2tlbnMgaW4gdGhlIFRBVCBQcm90b2NvbC5cbiAqXG4gKiBUb2tlbiByZXByZXNlbnRzIGJvdGggZnVuZ2libGUgdG9rZW5zICh3aXRoIGFtb3VudHMpIGFuZCBUcmFuc2ZlcmFibGUgQWNjZXNzIFRva2VucyAoVEFUcykuXG4gKiBFYWNoIHRva2VuIGNvbnRhaW5zIGEgaGVhZGVyIHdpdGggbWV0YWRhdGEsIGEgcGF5bG9hZCB3aXRoIHRva2VuIGRhdGEsIGFuZCBhIHNpZ25hdHVyZS5cbiAqIFRva2VucyBhcmUgZW5jb2RlZCBhcyBKV1RzIGZvciB0cmFuc3BvcnQgYW5kIHN0b3JhZ2UuXG4gKlxuICogS2V5IGZlYXR1cmVzOlxuICogLSBTdXBwb3J0IGZvciBmdW5naWJsZSBhbmQgbm9uLWZ1bmdpYmxlIChUQVQpIHRva2VuIHR5cGVzXG4gKiAtIFNjaG5vcnIgc2lnbmF0dXJlLWJhc2VkIGF1dGhlbnRpY2F0aW9uXG4gKiAtIE11bHRpcGxlIGxvY2sgbWVjaGFuaXNtczogUDJQSyAocHVibGljIGtleSksIHRpbWUgbG9ja3MsIGFuZCBIVExDIChoYXNoIHRpbWUtbG9ja2VkIGNvbnRyYWN0cylcbiAqIC0gSldUIGVuY29kaW5nL2RlY29kaW5nIGZvciBzdGFuZGFyZGl6ZWQgZm9ybWF0XG4gKlxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIENyZWF0ZSBhIG5ldyBmdW5naWJsZSB0b2tlblxuICogY29uc3QgdG9rZW4gPSBuZXcgVG9rZW4oe1xuICogICB0b2tlbl90eXBlOiBUb2tlblR5cGUuRlVOR0lCTEUsXG4gKiAgIHBheWxvYWQ6IHtcbiAqICAgICBpc3M6ICdmb3JnZVB1YmtleScsXG4gKiAgICAgaWF0OiBEYXRlLm5vdygpLFxuICogICAgIGFtb3VudDogMTAwXG4gKiAgIH1cbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFRva2VuIHtcbiAgcHVibGljIGhhc2ghOiBzdHJpbmc7XG4gIHB1YmxpYyBzaWduYXR1cmUhOiBzdHJpbmc7XG4gIHB1YmxpYyBoZWFkZXIhOiBIZWFkZXI7XG4gIHB1YmxpYyBwYXlsb2FkITogUGF5bG9hZDtcbiAgcHVibGljIGRhdGE6IEJsb2IgfCB1bmRlZmluZWQ7XG5cbiAgY29uc3RydWN0b3Iob3B0cz86IFRva2VuQnVpbGRQYXJhbXMpIHtcbiAgICBpZiAob3B0cykge1xuICAgICAgLy8gVXNlIHZvaWQgdG8gaGFuZGxlIHRoZSBwcm9taXNlIHdpdGhvdXQgYXdhaXRpbmdcbiAgICAgIHZvaWQgdGhpcy5idWlsZChvcHRzKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgbmV3IHRva2VuIHdpdGggcHJvdmlkZWQgcGFyYW1ldGVyc1xuICAgKi9cbiAgYXN5bmMgYnVpbGQob3B0czogVG9rZW5CdWlsZFBhcmFtcyk6IFByb21pc2U8VG9rZW4+IHtcbiAgICB0aGlzLmhlYWRlciA9IHtcbiAgICAgIGFsZzogXCJTY2hub3JyXCIsXG4gICAgICB0eXA6IG9wdHMudG9rZW5fdHlwZSxcbiAgICAgIHRva2VuX2hhc2g6IFwiXCIsXG4gICAgICB2ZXI6IFwiMS4wLjBcIixcbiAgICB9O1xuICAgIHRoaXMucGF5bG9hZCA9IG9wdHMucGF5bG9hZDtcbiAgICBhd2FpdCB0aGlzLmNyZWF0ZV90b2tlbl9oYXNoKCk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBnZXRUb2tlblR5cGUoKTogVG9rZW5UeXBlIHtcbiAgICByZXR1cm4gdGhpcy5oZWFkZXIudHlwO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlc3RvcmVzIGEgdG9rZW4gZnJvbSBpdHMgSldUIHN0cmluZyByZXByZXNlbnRhdGlvbi5cbiAgICpcbiAgICogVGhpcyBtZXRob2QgZGVzZXJpYWxpemVzIGEgSldULWVuY29kZWQgdG9rZW4gYmFjayBpbnRvIGEgVG9rZW4gaW5zdGFuY2UsXG4gICAqIHBhcnNpbmcgdGhlIGhlYWRlciwgcGF5bG9hZCwgYW5kIHNpZ25hdHVyZS4gVXNlIHRoaXMgdG8gd29yayB3aXRoIHRva2Vuc1xuICAgKiByZWNlaXZlZCBmcm9tIG90aGVycyBvciBsb2FkZWQgZnJvbSBzdG9yYWdlLlxuICAgKlxuICAgKiBAcGFyYW0gdG9rZW5fc3RyaW5nIC0gVGhlIEpXVC1lbmNvZGVkIHRva2VuIHN0cmluZ1xuICAgKiBAcmV0dXJucyBUaGUgcmVzdG9yZWQgVG9rZW4gaW5zdGFuY2VcbiAgICogQHRocm93cyB7RXJyb3J9IElmIHRoZSBKV1QgZm9ybWF0IGlzIGludmFsaWQgb3IgY2Fubm90IGJlIGRlY29kZWRcbiAgICpcbiAgICogQGV4YW1wbGVcbiAgICogYGBgdHlwZXNjcmlwdFxuICAgKiBjb25zdCB0b2tlbiA9IGF3YWl0IG5ldyBUb2tlbigpLnJlc3RvcmUoand0U3RyaW5nKTtcbiAgICogY29uc29sZS5sb2coJ1Rva2VuIGFtb3VudDonLCB0b2tlbi5wYXlsb2FkLmFtb3VudCk7XG4gICAqIGNvbnNvbGUubG9nKCdUb2tlbiBpc3N1ZXI6JywgdG9rZW4ucGF5bG9hZC5pc3MpO1xuICAgKiBgYGBcbiAgICpcbiAgICogQHNlZSB0b0pXVCBmb3IgdGhlIHJldmVyc2Ugb3BlcmF0aW9uXG4gICAqL1xuICByZXN0b3JlKHRva2VuX3N0cmluZzogc3RyaW5nKTogUHJvbWlzZTxUb2tlbj4ge1xuICAgIHJldHVybiB0aGlzLmZyb21KV1QodG9rZW5fc3RyaW5nKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTaWducyBkYXRhIHVzaW5nIFNjaG5vcnIgc2lnbmF0dXJlcy5cbiAgICpcbiAgICogVGhpcyBtZXRob2QgY3JlYXRlcyBhIGNyeXB0b2dyYXBoaWMgc2lnbmF0dXJlIG92ZXIgdGhlIHByb3ZpZGVkIGRhdGEgdXNpbmdcbiAgICogdGhlIHN1cHBsaWVkIGtleSBwYWlyLiBJbiB0aGUgVEFUIFByb3RvY29sLCB0b2tlbnMgYXJlIHNpZ25lZCBieSB0aGVpciBpc3N1ZXJcbiAgICogKGZvcmdlKSwgYW5kIHNpZ25hdHVyZXMgYXJlIGFsc28gdXNlZCBmb3IgUDJQSyBsb2NrIHZlcmlmaWNhdGlvbi5cbiAgICpcbiAgICogQHBhcmFtIGRhdGEgLSBUaGUgZGF0YSB0byBzaWduICh0eXBpY2FsbHkgdGhlIHRva2VuIGhhc2gpXG4gICAqIEBwYXJhbSBrZXlzIC0gVGhlIGtleSBwYWlyIGNvbnRhaW5pbmcgdGhlIHByaXZhdGUga2V5IGZvciBzaWduaW5nXG4gICAqIEByZXR1cm5zIFRoZSBzaWduYXR1cmUgYXMgYSBVaW50OEFycmF5XG4gICAqXG4gICAqIEBleGFtcGxlXG4gICAqIGBgYHR5cGVzY3JpcHRcbiAgICogY29uc3QgZGF0YVRvU2lnbiA9IGF3YWl0IHRva2VuLmRhdGFfdG9fc2lnbigpO1xuICAgKiBjb25zdCBzaWduYXR1cmUgPSBhd2FpdCB0b2tlbi5zaWduKGRhdGFUb1NpZ24sIGZvcmdlS2V5cyk7XG4gICAqIGBgYFxuICAgKi9cbiAgYXN5bmMgc2lnbihkYXRhOiBVaW50OEFycmF5LCBrZXlzOiBLZXlQYWlyKTogUHJvbWlzZTxVaW50OEFycmF5PiB7XG4gICAgcmV0dXJuIHNpZ25NZXNzYWdlKGRhdGEsIGtleXMpO1xuICB9XG5cbiAgLyoqXG4gICAqIFByZXBhcmVzIHRoZSBkYXRhIHRvIGJlIHNpZ25lZFxuICAgKi9cbiAgYXN5bmMgZGF0YV90b19zaWduKCk6IFByb21pc2U8VWludDhBcnJheT4ge1xuICAgIC8vIEZpcnN0IGVuc3VyZSB3ZSBoYXZlIGEgdG9rZW4gaGFzaFxuICAgIGlmICghdGhpcy5oZWFkZXIudG9rZW5faGFzaCkge1xuICAgICAgYXdhaXQgdGhpcy5jcmVhdGVfdG9rZW5faGFzaCgpO1xuICAgIH1cbiAgICAvLyBTaWduIG9ubHkgdGhlIHRva2VuIGhhc2hcbiAgICByZXR1cm4gbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKHRoaXMuaGVhZGVyLnRva2VuX2hhc2gpO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgY29tcGxldGUgdG9rZW4gc3RyaW5nIGluY2x1ZGluZyBzaWduYXR1cmUgaW4gSldUIGZvcm1hdFxuICAgKi9cbiAgYXN5bmMgdG9KV1Qoc2lnbmF0dXJlOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGNvbnN0IGhlYWRlcl9wYXlsb2FkID0gYCR7dGhpcy5lbmNvZGVfaGVhZGVyKCl9LiR7dGhpcy5lbmNvZGVfcGF5bG9hZCgpfWA7XG4gICAgdGhpcy5zaWduYXR1cmUgPSBzaWduYXR1cmU7XG4gICAgcmV0dXJuIGAke2hlYWRlcl9wYXlsb2FkfS4ke3NpZ25hdHVyZX1gO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY29uc3RydWN0cyB0b2tlbiBmcm9tIGl0cyBzdHJpbmcgcmVwcmVzZW50YXRpb25cbiAgICovXG4gIGFzeW5jIGZyb21KV1Qoand0OiBzdHJpbmcpOiBQcm9taXNlPFRva2VuPiB7XG4gICAgY29uc3QgcGFydHMgPSBqd3Quc3BsaXQoXCIuXCIpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggIT09IDMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkludmFsaWQgSldUIGZvcm1hdFwiKTtcbiAgICB9XG5cbiAgICBEZWJ1Z0xvZ2dlci5nZXRJbnN0YW5jZSgpLmxvZyhcIkZyb20gSldUXCIsIFwiW1RPS0VOXVwiLCB7IHBhcnRzIH0pO1xuICAgIGNvbnN0IFtoZWFkZXIsIHBheWxvYWQsIHNpZ25hdHVyZV0gPSBwYXJ0cztcbiAgICBpZiAoIWhlYWRlciB8fCAhcGF5bG9hZCB8fCAhc2lnbmF0dXJlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIEpXVCBmb3JtYXRcIik7XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIC8vIEFkZCBwcm9wZXIgcGFkZGluZyBiZWZvcmUgZGVjb2RpbmdcbiAgICAgIGNvbnN0IHBhZGRlZEhlYWRlciA9IGhlYWRlci5wYWRFbmQoTWF0aC5jZWlsKGhlYWRlci5sZW5ndGggLyA0KSAqIDQsIFwiPVwiKTtcbiAgICAgIGNvbnN0IHBhZGRlZFBheWxvYWQgPSBwYXlsb2FkLnBhZEVuZChcbiAgICAgICAgTWF0aC5jZWlsKHBheWxvYWQubGVuZ3RoIC8gNCkgKiA0LFxuICAgICAgICBcIj1cIixcbiAgICAgICk7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGhlYWRlckJ5dGVzID0gYmFzZTY0LmRlY29kZShwYWRkZWRIZWFkZXIpO1xuICAgICAgICBjb25zdCBwYXlsb2FkQnl0ZXMgPSBiYXNlNjQuZGVjb2RlKHBhZGRlZFBheWxvYWQpO1xuXG4gICAgICAgIHRoaXMuaGVhZGVyID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUoaGVhZGVyQnl0ZXMpKTtcbiAgICAgICAgdGhpcy5wYXlsb2FkID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUocGF5bG9hZEJ5dGVzKSk7XG4gICAgICAgIHRoaXMuc2lnbmF0dXJlID0gc2lnbmF0dXJlOyAvLyBTdG9yZSB0aGUgc2lnbmF0dXJlIGFzIGlzXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIEpXVCBmb3JtYXRcIik7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiBlcnJvci5tZXNzYWdlID09PSBcIkludmFsaWQgSldUIGZvcm1hdFwiKSB7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCBKV1QgZm9ybWF0XCIpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDb252ZXJ0cyB0aGUgdG9rZW4gdG8gYSBKU09OIHN0cmluZ1xuICAgKi9cbiAgdG9KU09OKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KFxuICAgICAge1xuICAgICAgICBoZWFkZXI6IHRoaXMuaGVhZGVyLFxuICAgICAgICBwYXlsb2FkOiB0aGlzLnBheWxvYWQsXG4gICAgICAgIHNpZ25hdHVyZTogdGhpcy5zaWduYXR1cmUsXG4gICAgICB9LFxuICAgICAgbnVsbCxcbiAgICAgIDIsXG4gICAgKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFbmNvZGVzIGhlYWRlciB0byBiYXNlNjQgd2l0aG91dCBwYWRkaW5nXG4gICAqL1xuICBlbmNvZGVfaGVhZGVyKCk6IHN0cmluZyB7XG4gICAgY29uc3QgZGF0YSA9IG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShKU09OLnN0cmluZ2lmeSh0aGlzLmhlYWRlcikpO1xuICAgIHJldHVybiByZW1vdmVCYXNlNjRQYWRkaW5nKGJhc2U2NC5lbmNvZGUoZGF0YSkpO1xuICB9XG5cbiAgLyoqXG4gICAqIEVuY29kZXMgcGF5bG9hZCB0byBiYXNlNjQgd2l0aG91dCBwYWRkaW5nXG4gICAqL1xuICBlbmNvZGVfcGF5bG9hZCgpOiBzdHJpbmcge1xuICAgIGNvbnN0IGRhdGEgPSBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoSlNPTi5zdHJpbmdpZnkodGhpcy5wYXlsb2FkKSk7XG4gICAgcmV0dXJuIHJlbW92ZUJhc2U2NFBhZGRpbmcoYmFzZTY0LmVuY29kZShkYXRhKSk7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBkb3VibGUgaGFzaCBvZiBwYXlsb2FkIGZvciB0b2tlbiBpZGVudGlmaWNhdGlvblxuICAgKiBAcGFyYW0gcmVhZGVyUHVia2V5IC0gT3B0aW9uYWwgcmVhZGVyJ3MgcHVibGljIGtleSBmb3IgYWNjZXNzIGNvbnRyb2xcbiAgICogQHBhcmFtIHRpbWVXaW5kb3cgLSBPcHRpb25hbCB0aW1lIHdpbmRvdyBmb3Igbm9uY2VcbiAgICovXG4gIGFzeW5jIGNyZWF0ZV90b2tlbl9oYXNoKFxuICAgIHJlYWRlclB1YmtleT86IHN0cmluZyxcbiAgICB0aW1lV2luZG93PzogbnVtYmVyLFxuICApOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIC8vIENyZWF0ZSBiYXNlIHBheWxvYWQgaGFzaFxuICAgIGNvbnN0IGRhdGFUb0hhc2ggPSB0aGlzLmVuY29kZV9wYXlsb2FkKCk7XG4gICAgY29uc3QgaGFzaDEgPSBhd2FpdCBjcmVhdGVIYXNoKEpTT04uc3RyaW5naWZ5KGRhdGFUb0hhc2gpKTtcblxuICAgIC8vIEFkZCB0aW1lLWJhc2VkIG5vbmNlIGlmIHByb3ZpZGVkXG4gICAgbGV0IG5vbmNlRGF0YSA9IG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShoYXNoMSk7XG4gICAgaWYgKHRpbWVXaW5kb3cpIHtcbiAgICAgIGNvbnN0IHRpbWVTbG90ID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gKHRpbWVXaW5kb3cgKiAxMDAwKSk7XG4gICAgICBub25jZURhdGEgKz0gYDoke3RpbWVTbG90fWA7XG4gICAgfVxuXG4gICAgLy8gQWRkIHJlYWRlciBwdWJrZXkgaWYgcHJvdmlkZWRcbiAgICBpZiAocmVhZGVyUHVia2V5KSB7XG4gICAgICBub25jZURhdGEgKz0gYDoke3JlYWRlclB1YmtleX1gO1xuICAgIH1cblxuICAgIC8vIENyZWF0ZSBmaW5hbCBoYXNoXG4gICAgY29uc3QgaGFzaDIgPSBhd2FpdCBjcmVhdGVIYXNoKG5vbmNlRGF0YSk7XG4gICAgdGhpcy5oZWFkZXIudG9rZW5faGFzaCA9IGJ5dGVzVG9IZXgobmV3IFVpbnQ4QXJyYXkoaGFzaDIpKTtcbiAgICByZXR1cm4gdGhpcy5oZWFkZXIudG9rZW5faGFzaDtcbiAgfVxuXG4gIC8vIFV0aWxpdHkgbWV0aG9kcyBmcm9tIHByZXZpb3VzIHZlcnNpb25cblxuICAvKipcbiAgICogQ2hlY2tzIGlmIHRva2VuIGhhcyBhIFAyUEtsb2NrIHJlcXVpcmVtZW50XG4gICAqL1xuICBoYXNQMlBLTG9jaygpOiBib29sZWFuIHtcbiAgICByZXR1cm4gISF0aGlzLnBheWxvYWQuUDJQS2xvY2s7XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIGlmIHRva2VuIGlzIGN1cnJlbnRseSB0aW1lIGxvY2tlZFxuICAgKi9cbiAgaXNUaW1lTG9ja2VkKCk6IGJvb2xlYW4ge1xuICAgIGlmICghdGhpcy5wYXlsb2FkLnRpbWVMb2NrKSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIHRoaXMucGF5bG9hZC50aW1lTG9jayA+IERhdGUubm93KCk7XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIGlmIHRva2VuIGlzIGN1cnJlbnRseSB0aW1lIGxvY2tlZFxuICAgKi9cbiAgaGFzSFRMQygpOiBib29sZWFuIHtcbiAgICByZXR1cm4gISF0aGlzLnBheWxvYWQuSFRMQztcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRva2VuIGFtb3VudCwgZGVmYXVsdHMgdG8gMCBpZiBub3Qgc2V0XG4gICAqL1xuICBnZXRBbW91bnQoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5wYXlsb2FkLmFtb3VudCA/PyAwO1xuICB9XG5cbiAgZ2V0SGVhZGVyKCk6IEhlYWRlciB7XG4gICAgcmV0dXJuIHRoaXMuaGVhZGVyO1xuICB9XG5cbiAgZ2V0UGF5bG9hZCgpOiBQYXlsb2FkIHtcbiAgICByZXR1cm4gdGhpcy5wYXlsb2FkO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgaXNzdWVyIChmb3JnZSkgcHVibGljIGtleVxuICAgKi9cbiAgZ2V0SXNzdWVyKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMucGF5bG9hZC5pc3M7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhIHN0YW5kYXJkIHRva2VuIGhlYWRlclxuICAgKi9cbiAgc3RhdGljIGNyZWF0ZUhlYWRlcih0eXA6IFRva2VuVHlwZSwgdG9rZW5IYXNoOiBzdHJpbmcpOiBIZWFkZXIge1xuICAgIHJldHVybiB7XG4gICAgICBhbGc6IFwiU2Nobm9yclwiLFxuICAgICAgdHlwLFxuICAgICAgdG9rZW5faGFzaDogdG9rZW5IYXNoLFxuICAgICAgdmVyOiBcIjEuMC4wXCIsXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgdG9rZW4gcGF5bG9hZCBmcm9tIGEgcGFyYW1ldGVyIG9iamVjdC5cbiAgICpcbiAgICogVGhpcyBzdGF0aWMgaGVscGVyIG1ldGhvZCBjb25zdHJ1Y3RzIGEgcHJvcGVybHkgZm9ybWF0dGVkIHBheWxvYWQgd2l0aFxuICAgKiByZXF1aXJlZCBhbmQgb3B0aW9uYWwgZmllbGRzLiBJdCBhdXRvbWF0aWNhbGx5IHNldHMgdGhlIGlzc3VlZC1hdCB0aW1lc3RhbXBcbiAgICogYW5kIGluY2x1ZGVzIGFueSBwcm92aWRlZCBsb2NrcywgYW1vdW50cywgb3IgbWV0YWRhdGEuXG4gICAqXG4gICAqIEBwYXJhbSBwYXlsb2FkT2JqIC0gT2JqZWN0IGNvbnRhaW5pbmcgcGF5bG9hZCBwYXJhbWV0ZXJzIChpc3MsIGFtb3VudCwgbG9ja3MsIGV0Yy4pXG4gICAqIEByZXR1cm5zIEEgZm9ybWF0dGVkIFBheWxvYWQgb3IgRGVyaXZlZFBheWxvYWQgb2JqZWN0XG4gICAqXG4gICAqIEBleGFtcGxlXG4gICAqIGBgYHR5cGVzY3JpcHRcbiAgICogY29uc3QgcGF5bG9hZCA9IFRva2VuLmNyZWF0ZVBheWxvYWQoe1xuICAgKiAgIGlzczogJ2ZvcmdlUHVia2V5JyxcbiAgICogICBhbW91bnQ6IDUwLFxuICAgKiAgIFAyUEtsb2NrOiAncmVjaXBpZW50UHVia2V5JyxcbiAgICogICBleHA6IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApICsgODY0MDAgLy8gMjQgaG91cnNcbiAgICogfSk7XG4gICAqIGBgYFxuICAgKi9cbiAgc3RhdGljIGNyZWF0ZVBheWxvYWQoXG4gICAgcGF5bG9hZE9iajogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gICk6IFBheWxvYWQgfCBEZXJpdmVkUGF5bG9hZCB7XG4gICAgY29uc3QgcGF5bG9hZDogUGF5bG9hZCA9IHtcbiAgICAgIGlzczogcGF5bG9hZE9iai5pc3MgYXMgc3RyaW5nLFxuICAgICAgaWF0OiBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKSwgLy8gQ29udmVydCB0byBzZWNvbmRzXG4gICAgfTtcblxuICAgIGlmIChwYXlsb2FkT2JqLmFtb3VudCAhPT0gdW5kZWZpbmVkICYmIHBheWxvYWRPYmouYW1vdW50ICE9PSBudWxsKSB7XG4gICAgICBwYXlsb2FkLmFtb3VudCA9IHBheWxvYWRPYmouYW1vdW50IGFzIG51bWJlcjtcbiAgICB9XG4gICAgaWYgKHBheWxvYWRPYmouUDJQS2xvY2spIHtcbiAgICAgIHBheWxvYWQuUDJQS2xvY2sgPSBwYXlsb2FkT2JqLlAyUEtsb2NrIGFzIHN0cmluZztcbiAgICB9XG4gICAgaWYgKHBheWxvYWRPYmoudGltZUxvY2spIHtcbiAgICAgIHBheWxvYWQudGltZUxvY2sgPSBwYXlsb2FkT2JqLnRpbWVMb2NrIGFzIG51bWJlcjtcbiAgICB9XG4gICAgaWYgKHBheWxvYWRPYmoudG9rZW5JRCAhPT0gdW5kZWZpbmVkICYmIHBheWxvYWRPYmoudG9rZW5JRCAhPT0gbnVsbCkge1xuICAgICAgcGF5bG9hZC50b2tlbklEID0gcGF5bG9hZE9iai50b2tlbklEIGFzIHN0cmluZztcbiAgICB9XG4gICAgaWYgKHBheWxvYWRPYmouZGF0YV91cmkpIHtcbiAgICAgIHBheWxvYWQuZGF0YV91cmkgPSBwYXlsb2FkT2JqLmRhdGFfdXJpIGFzIHN0cmluZztcbiAgICB9XG4gICAgaWYgKHBheWxvYWRPYmouSFRMQykge1xuICAgICAgcGF5bG9hZC5IVExDID0gcGF5bG9hZE9iai5IVExDIGFzIHN0cmluZztcbiAgICB9XG4gICAgaWYgKHBheWxvYWRPYmouZXhwKSB7XG4gICAgICBwYXlsb2FkLmV4cCA9IHBheWxvYWRPYmouZXhwIGFzIG51bWJlcjtcbiAgICB9XG5cbiAgICByZXR1cm4gcGF5bG9hZDtcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3MgaWYgdGhlIHRva2VuIGhhcyBleHBpcmVkXG4gICAqL1xuICBpc0V4cGlyZWQoKTogYm9vbGVhbiB7XG4gICAgaWYgKHRoaXMucGF5bG9hZC5leHApIHtcbiAgICAgIGNvbnN0IG5vdyA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApO1xuICAgICAgcmV0dXJuIG5vdyA+PSB0aGlzLnBheWxvYWQuZXhwO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIHRoZSB0b2tlbidzIHN0cnVjdHVyZSBhbmQgcmVxdWlyZWQgZmllbGRzLlxuICAgKlxuICAgKiBUaGlzIG1ldGhvZCBwZXJmb3JtcyB0eXBlLXNwZWNpZmljIHZhbGlkYXRpb24gdG8gZW5zdXJlIHRoZSB0b2tlbiBoYXMgYWxsXG4gICAqIHJlcXVpcmVkIGZpZWxkcyBhbmQgbWVldHMgdGhlIGNvbnN0cmFpbnRzIGZvciBpdHMgdG9rZW4gdHlwZS4gSXQgY2hlY2tzOlxuICAgKiAtIFByZXNlbmNlIG9mIGlzc3VlciBhbmQgaXNzdWVkLWF0IHRpbWVzdGFtcFxuICAgKiAtIEV4cGlyYXRpb24gc3RhdHVzXG4gICAqIC0gVHlwZS1zcGVjaWZpYyByZXF1aXJlbWVudHMgKGFtb3VudCBmb3IgZnVuZ2libGUsIHRva2VuSUQgZm9yIFRBVHMpXG4gICAqXG4gICAqIEByZXR1cm5zIFRydWUgaWYgdGhlIHRva2VuIGlzIHZhbGlkXG4gICAqIEB0aHJvd3Mge0Vycm9yfSBJZiB2YWxpZGF0aW9uIGZhaWxzLCB3aXRoIGEgZGVzY3JpcHRpdmUgZXJyb3IgbWVzc2FnZVxuICAgKlxuICAgKiBAZXhhbXBsZVxuICAgKiBgYGB0eXBlc2NyaXB0XG4gICAqIHRyeSB7XG4gICAqICAgYXdhaXQgdG9rZW4udmFsaWRhdGUoKTtcbiAgICogICBjb25zb2xlLmxvZygnVG9rZW4gaXMgdmFsaWQnKTtcbiAgICogfSBjYXRjaCAoZXJyb3IpIHtcbiAgICogICBjb25zb2xlLmVycm9yKCdUb2tlbiB2YWxpZGF0aW9uIGZhaWxlZDonLCBlcnJvci5tZXNzYWdlKTtcbiAgICogfVxuICAgKiBgYGBcbiAgICovXG4gIGFzeW5jIHZhbGlkYXRlKCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIC8vIENoZWNrIHJlcXVpcmVkIGZpZWxkc1xuICAgIGlmICghdGhpcy5wYXlsb2FkLmlzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVG9rZW4gbXVzdCBoYXZlIGFuIGlzc3VlclwiKTtcbiAgICB9XG4gICAgaWYgKCF0aGlzLnBheWxvYWQuaWF0KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJUb2tlbiBtdXN0IGhhdmUgYW4gaXNzdWVkIGF0IHRpbWVzdGFtcFwiKTtcbiAgICB9XG5cbiAgICAvLyBDaGVjayBleHBpcmF0aW9uXG4gICAgaWYgKHRoaXMuaXNFeHBpcmVkKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlRva2VuIGhhcyBleHBpcmVkXCIpO1xuICAgIH1cblxuICAgIC8vIFR5cGUtc3BlY2lmaWMgdmFsaWRhdGlvblxuICAgIHN3aXRjaCAodGhpcy5oZWFkZXIudHlwKSB7XG4gICAgICBjYXNlIFRva2VuVHlwZS5GVU5HSUJMRTpcbiAgICAgICAgaWYgKHRoaXMucGF5bG9hZC5hbW91bnQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkZ1bmdpYmxlIHRva2VuIG11c3QgaGF2ZSBhbiBhbW91bnRcIik7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIFRva2VuVHlwZS5UQVQ6XG4gICAgICAgIGlmICh0aGlzLnBheWxvYWQudG9rZW5JRCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVHJhbnNmZXJhYmxlIEFjY2VzcyBUb2tlbiBtdXN0IGhhdmUgYSB0b2tlbklEXCIpO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHRva2VuIHR5cGU6ICR7dGhpcy5oZWFkZXIudHlwfWApO1xuICAgIH1cblxuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLyoqXG4gICAqIExvY2tzIHRoZSB0b2tlbiB3aXRoIGEgc3BlY2lmaWMgbG9jayB0eXBlXG4gICAqL1xuICBsb2NrKGxvY2tUeXBlOiBcIlAyUEtcIiB8IFwiSFRMQ1wiIHwgXCJUSU1FXCIsIGxvY2tWYWx1ZTogc3RyaW5nIHwgbnVtYmVyKTogdm9pZCB7XG4gICAgc3dpdGNoIChsb2NrVHlwZSkge1xuICAgICAgY2FzZSBcIlAyUEtcIjpcbiAgICAgICAgdGhpcy5wYXlsb2FkLlAyUEtsb2NrID0gbG9ja1ZhbHVlIGFzIHN0cmluZztcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIFwiSFRMQ1wiOlxuICAgICAgICB0aGlzLnBheWxvYWQuSFRMQyA9IGxvY2tWYWx1ZSBhcyBzdHJpbmc7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBcIlRJTUVcIjpcbiAgICAgICAgdGhpcy5wYXlsb2FkLnRpbWVMb2NrID0gbG9ja1ZhbHVlIGFzIG51bWJlcjtcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIGxvY2sgdHlwZVwiKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVW5sb2NrcyB0aGUgdG9rZW5cbiAgICovXG4gIHVubG9jayhsb2NrVHlwZTogXCJQMlBLXCIgfCBcIkhUTENcIiB8IFwiVElNRVwiKTogdm9pZCB7XG4gICAgc3dpdGNoIChsb2NrVHlwZSkge1xuICAgICAgY2FzZSBcIlAyUEtcIjpcbiAgICAgICAgZGVsZXRlIHRoaXMucGF5bG9hZC5QMlBLbG9jaztcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIFwiSFRMQ1wiOlxuICAgICAgICBkZWxldGUgdGhpcy5wYXlsb2FkLkhUTEM7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBcIlRJTUVcIjpcbiAgICAgICAgZGVsZXRlIHRoaXMucGF5bG9hZC50aW1lTG9jaztcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIGxvY2sgdHlwZVwiKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIGlmIHRva2VuIGlzIGxvY2tlZFxuICAgKi9cbiAgaXNMb2NrZWQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuICEhKFxuICAgICAgdGhpcy5wYXlsb2FkLlAyUEtsb2NrIHx8XG4gICAgICB0aGlzLnBheWxvYWQuSFRMQyB8fFxuICAgICAgdGhpcy5wYXlsb2FkLnRpbWVMb2NrXG4gICAgKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBsb2NrIHR5cGUgaWYgYW55XG4gICAqL1xuICBnZXRMb2NrVHlwZSgpOiBcIlAyUEtcIiB8IFwiSFRMQ1wiIHwgXCJUSU1FXCIgfCBudWxsIHtcbiAgICBpZiAodGhpcy5wYXlsb2FkLlAyUEtsb2NrKSByZXR1cm4gXCJQMlBLXCI7XG4gICAgaWYgKHRoaXMucGF5bG9hZC5IVExDKSByZXR1cm4gXCJIVExDXCI7XG4gICAgaWYgKHRoaXMucGF5bG9hZC50aW1lTG9jaykgcmV0dXJuIFwiVElNRVwiO1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIGFjY2VzcyBydWxlcyBmb3IgdGhlIHRva2VuXG4gICAqL1xuICBnZXRBY2Nlc3NSdWxlcygpOiBBY2Nlc3NSdWxlcyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuICh0aGlzLnBheWxvYWQgYXMgRGVyaXZlZFBheWxvYWQpLmFjY2VzcztcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgZGVyaXZlZCB0b2tlbiB3aXRoIGZsZXhpYmxlIGFjY2VzcyBjb250cm9sIHJ1bGVzLlxuICAgKlxuICAgKiBEZXJpdmVkIHRva2VucyBhcmUgbGlua2VkIHRvIGEgcGFyZW50IHRva2VuIGFuZCBjYW4gaGF2ZSByZXN0cmljdGVkIGFjY2VzcyByaWdodHMuXG4gICAqIFRoaXMgaXMgdXNlZnVsIGZvciBjcmVhdGluZyB0ZW1wb3JhcnkgcGFzc2VzLCBkZWxlZ2F0aW9uIHRva2Vucywgb3Igc2NvcGVkIGFjY2Vzc1xuICAgKiBjcmVkZW50aWFscy4gVGhlIGRlcml2ZWQgdG9rZW4gcmVmZXJlbmNlcyB0aGUgcGFyZW50J3MgaGFzaCBhbmQgaW5jbHVkZXMgY3VzdG9tXG4gICAqIGFjY2VzcyBydWxlcyB0aGF0IGRlZmluZSB3aGF0IHRoZSBob2xkZXIgY2FuIGRvLlxuICAgKlxuICAgKiBAcGFyYW0gdG9rZW5UeXBlIC0gVGhlIHR5cGUgb2YgZGVyaXZlZCB0b2tlbiB0byBjcmVhdGVcbiAgICogQHBhcmFtIHBhcmVudFRva2VuIC0gVGhlIHBhcmVudCB0b2tlbiB0byBkZXJpdmUgZnJvbSAobXVzdCBoYXZlIGEgdmFsaWQgaGFzaClcbiAgICogQHBhcmFtIGFjY2Vzc1J1bGVzIC0gRmxleGlibGUgYWNjZXNzIGNvbnRyb2wgcnVsZXMgZGVmaW5pbmcgcGVybWlzc2lvbnNcbiAgICogQHJldHVybnMgQSBuZXcgZGVyaXZlZCB0b2tlbiBpbnN0YW5jZVxuICAgKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIHBhcmVudCB0b2tlbiBkb2Vzbid0IGhhdmUgYSB2YWxpZCBoYXNoXG4gICAqXG4gICAqIEBleGFtcGxlXG4gICAqIGBgYHR5cGVzY3JpcHRcbiAgICogLy8gQ3JlYXRlIGEgdGVtcG9yYXJ5IGFjY2VzcyBwYXNzIGZyb20gYSBtYXN0ZXIgdGlja2V0XG4gICAqIGNvbnN0IGRlcml2ZWRUb2tlbiA9IGF3YWl0IFRva2VuLmNyZWF0ZURlcml2ZWRUb2tlbihcbiAgICogICBUb2tlblR5cGUuVEFULFxuICAgKiAgIG1hc3RlclRpY2tldCxcbiAgICogICB7XG4gICAqICAgICBmZWF0dXJlczogWydiYXNpY19hY2Nlc3MnXSxcbiAgICogICAgIGV4cGlyZXNBdDogRGF0ZS5ub3coKSArIDM2MDAwMDAgLy8gMSBob3VyXG4gICAqICAgfVxuICAgKiApO1xuICAgKiBgYGBcbiAgICovXG4gIHN0YXRpYyBhc3luYyBjcmVhdGVEZXJpdmVkVG9rZW4oXG4gICAgdG9rZW5UeXBlOiBUb2tlblR5cGUsXG4gICAgcGFyZW50VG9rZW46IFRva2VuLFxuICAgIGFjY2Vzc1J1bGVzOiBBY2Nlc3NSdWxlcyxcbiAgKTogUHJvbWlzZTxUb2tlbj4ge1xuICAgIC8vIFZlcmlmeSBwYXJlbnQgdG9rZW4gaXMgdmFsaWRcbiAgICBpZiAoIXBhcmVudFRva2VuLmhlYWRlci50b2tlbl9oYXNoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJQYXJlbnQgdG9rZW4gbXVzdCBoYXZlIGEgdmFsaWQgaGFzaFwiKTtcbiAgICB9XG5cbiAgICAvLyBDcmVhdGUgZGVyaXZlZCB0b2tlbiBwYXlsb2FkIHdpdGggY29ycmVjdCB0eXBlXG4gICAgY29uc3QgZGVyaXZlZFBheWxvYWQ6IERlcml2ZWRQYXlsb2FkID0ge1xuICAgICAgLi4ucGFyZW50VG9rZW4ucGF5bG9hZCxcbiAgICAgIHBhcmVudFRva2VuOiBwYXJlbnRUb2tlbi5oZWFkZXIudG9rZW5faGFzaCxcbiAgICAgIGFjY2VzczogYWNjZXNzUnVsZXMsXG4gICAgfTtcblxuICAgIC8vIENyZWF0ZSB0aGUgZGVyaXZlZCB0b2tlblxuICAgIGNvbnN0IGRlcml2ZWRUb2tlbiA9IG5ldyBEZXJpdmVkVG9rZW4ocGFyZW50VG9rZW4sIGFjY2Vzc1J1bGVzKTtcbiAgICBhd2FpdCBkZXJpdmVkVG9rZW4uYnVpbGQoe1xuICAgICAgdG9rZW5fdHlwZTogdG9rZW5UeXBlLFxuICAgICAgcGF5bG9hZDogZGVyaXZlZFBheWxvYWQsXG4gICAgfSk7XG5cbiAgICByZXR1cm4gZGVyaXZlZFRva2VuO1xuICB9XG59XG5cbi8qKlxuICogRGVyaXZlZCB0b2tlbiBjbGFzcyBmb3IgaGFuZGxpbmcgZGVyaXZlZCB0b2tlbiBvcGVyYXRpb25zXG4gKi9cbmNsYXNzIERlcml2ZWRUb2tlbiBleHRlbmRzIFRva2VuIHtcbiAgcHVibGljIHBhcmVudFRva2VuOiBUb2tlbjtcbiAgcHVibGljIGFjY2Vzc1J1bGVzOiBBY2Nlc3NSdWxlcztcbiAgcHVibGljIHBheWxvYWQ6IERlcml2ZWRQYXlsb2FkO1xuICBjb25zdHJ1Y3RvcihwYXJlbnRUb2tlbjogVG9rZW4sIGFjY2Vzc1J1bGVzOiBBY2Nlc3NSdWxlcykge1xuICAgIHN1cGVyKCk7XG4gICAgaWYgKCFwYXJlbnRUb2tlbi5oZWFkZXIudG9rZW5faGFzaCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUGFyZW50IHRva2VuIG11c3QgaGF2ZSBhIHZhbGlkIGhhc2hcIik7XG4gICAgfVxuICAgIHRoaXMucGFyZW50VG9rZW4gPSBwYXJlbnRUb2tlbjtcbiAgICB0aGlzLmFjY2Vzc1J1bGVzID0gYWNjZXNzUnVsZXM7XG4gICAgdGhpcy5wYXlsb2FkID0ge1xuICAgICAgcGFyZW50VG9rZW46IHBhcmVudFRva2VuLmhlYWRlci50b2tlbl9oYXNoLFxuICAgICAgYWNjZXNzOiBhY2Nlc3NSdWxlcyxcbiAgICAgIC4uLnBhcmVudFRva2VuLnBheWxvYWQsXG4gICAgfTtcbiAgfVxuXG4gIGFzeW5jIGJ1aWxkKG9wdHM6IFRva2VuQnVpbGRQYXJhbXMpOiBQcm9taXNlPFRva2VuPiB7XG4gICAgaWYgKCF0aGlzLnBhcmVudFRva2VuLmhlYWRlci50b2tlbl9oYXNoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJQYXJlbnQgdG9rZW4gbXVzdCBoYXZlIGEgdmFsaWQgaGFzaFwiKTtcbiAgICB9XG4gICAgYXdhaXQgc3VwZXIuYnVpbGQob3B0cyk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogVmVyaWZpZXMgaWYgdGhpcyB0b2tlbiBpcyBkZXJpdmVkIGZyb20gYSBwYXJlbnQgdG9rZW5cbiAgICogQHBhcmFtIHBhcmVudFRva2VuSGFzaCAtIFRoZSBoYXNoIG9mIHRoZSBwYXJlbnQgdG9rZW4gdG8gdmVyaWZ5IGFnYWluc3RcbiAgICogQHJldHVybnMgdHJ1ZSBpZiB0aGlzIHRva2VuIGlzIGRlcml2ZWQgZnJvbSB0aGUgZ2l2ZW4gcGFyZW50IHRva2VuXG4gICAqL1xuICBpc0Rlcml2ZWRGcm9tKHBhcmVudFRva2VuSGFzaDogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMucGF5bG9hZC5wYXJlbnRUb2tlbiA9PT0gcGFyZW50VG9rZW5IYXNoO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIGFjY2Vzc2libGUgZmVhdHVyZXNcbiAgICovXG4gIGdldEZlYXR1cmVzKCk6IHN0cmluZ1tdIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBmZWF0dXJlcyA9ICh0aGlzLnBheWxvYWQgYXMgRGVyaXZlZFBheWxvYWQpLmFjY2Vzcz8uZmVhdHVyZXM7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkoZmVhdHVyZXMpKSB7XG4gICAgICByZXR1cm4gZmVhdHVyZXMuZmlsdGVyKChmKTogZiBpcyBzdHJpbmcgPT4gdHlwZW9mIGYgPT09ICdzdHJpbmcnKTtcbiAgICB9XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBhY2Nlc3MgcnVsZXMgZm9yIHRoZSB0b2tlblxuICAgKi9cbiAgZ2V0QWNjZXNzUnVsZXMoKTogQWNjZXNzUnVsZXMgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLnBheWxvYWQuYWNjZXNzO1xuICB9XG59XG4iXX0=