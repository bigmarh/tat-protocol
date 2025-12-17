# TAT Protocol Specification v1.0.0

**Status**: Draft
**Version**: 1.0.0
**Last Updated**: 2025-12-17
**Authors**: TAT Protocol Contributors

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Design Principles](#2-design-principles)
3. [Token Format Specification](#3-token-format-specification)
4. [NWPC Protocol](#4-nwpc-protocol)
5. [Cryptographic Primitives](#5-cryptographic-primitives)
6. [Message Flow](#6-message-flow)
7. [Security Model](#7-security-model)
8. [Extension Mechanism](#8-extension-mechanism)
9. [Versioning](#9-versioning)

---

## 1. Introduction

### 1.1 Purpose

TAT Protocol is an open, decentralized protocol for tokenized asset management built on Nostr. Unlike blockchain-based tokenization, TAT Protocol maintains the **issuer as the authority** over their tokens while providing:

- Cryptographic ownership
- Token portability
- Open ecosystem
- Decentralized infrastructure

### 1.2 Comparison to Traditional Tokenization

| Aspect | Blockchain Tokens | TAT Protocol |
|--------|------------------|--------------|
| Authority | Network consensus | Token issuer |
| Finality | Probabilistic/Deterministic | Issuer validation |
| Infrastructure | Blockchain nodes | Nostr relays |
| Smart Contracts | On-chain code | Application logic |
| Cost | Gas fees | Relay costs (minimal) |
| Scalability | Limited by consensus | Limited by issuer capacity |

### 1.3 Key Concepts

- **Token**: A signed JWT representing value or access rights
- **Forge**: The issuer/authority that mints and validates tokens
- **Pocket**: A client/wallet that holds and transfers tokens
- **NWPC**: Nostr Wrapped Procedure Call - the RPC layer
- **TAT**: Transferable Access Token - non-fungible token type
- **Issuer Authority**: The forge has final say on token validity

---

## 2. Design Principles

### 2.1 Issuer Authority Model

**Core Principle**: The issuer (Forge) is the ultimate authority for their tokens.

- **Minting**: Only the issuer can create new tokens
- **Validation**: Issuer validates all transfers
- **Revocation**: Issuer can mark tokens as spent/invalid
- **Supply Management**: Issuer enforces circulation limits

This differs from blockchain models where network consensus determines validity. In TAT Protocol, the issuer's signature and validation is authoritative.

### 2.2 Trust Model

Users trust:
1. **Cryptography**: ECDSA signatures, encryption
2. **Issuer Reputation**: Like trusting a bank or loyalty program
3. **Open Protocol**: Anyone can verify token structure
4. **Relay Infrastructure**: For message delivery (but not content)

Users do NOT need to trust:
- Network consensus
- Miners/validators
- Smart contract execution

### 2.3 Protocol Design Goals

- **Openness**: Any language can implement the protocol
- **Simplicity**: Minimal required functionality
- **Extensibility**: Custom fields and methods allowed
- **Privacy**: End-to-end encryption by default
- **Portability**: Tokens work across implementations

---

## 3. Token Format Specification

### 3.1 Token Structure

Tokens use JWT (JSON Web Token) format with three components:

```
BASE64URL(Header).BASE64URL(Payload).BASE64URL(Signature)
```

### 3.2 Header

**Required Fields:**

```typescript
{
  "alg": "Schnorr",           // REQUIRED: Signature algorithm
  "typ": "FUNGIBLE" | "TAT",  // REQUIRED: Token type
  "token_hash": string,       // REQUIRED: SHA-256 hash of payload
  "ver": "1.0.0"             // REQUIRED: Protocol version
}
```

**Field Specifications:**

- `alg`: MUST be "Schnorr" (secp256k1 Schnorr signatures)
- `typ`: Token type identifier
  - `FUNGIBLE`: Interchangeable tokens with amounts
  - `TAT`: Non-fungible tokens with unique IDs
- `token_hash`: Hex-encoded SHA-256 hash of canonical payload JSON
- `ver`: Semantic version of protocol (MAJOR.MINOR.PATCH)

### 3.3 Payload

**Common Fields (All Token Types):**

```typescript
{
  "iss": string,              // REQUIRED: Issuer public key (hex)
  "iat": number,              // REQUIRED: Issued at (Unix timestamp, seconds)
  "exp"?: number,             // OPTIONAL: Expiration (Unix timestamp, seconds)
  "P2PKlock"?: string,        // OPTIONAL: Locked to public key (hex)
  "timeLock"?: number,        // OPTIONAL: Cannot spend before (Unix timestamp)
  "HTLC"?: string,            // OPTIONAL: Hash for HTLC (hex)
  "data_uri"?: string,        // OPTIONAL: URI to external data
  "ext"?: object              // OPTIONAL: Extension fields
}
```

**FUNGIBLE Token Additional Fields:**

```typescript
{
  "amount": number,           // REQUIRED for FUNGIBLE: Token amount
  "setID"?: string           // OPTIONAL: Token set identifier
}
```

**TAT Token Additional Fields:**

```typescript
{
  "tokenID": string          // REQUIRED for TAT: Unique token identifier
}
```

**Field Specifications:**

- `iss`: 64-character hex string (32-byte public key)
- `iat`: Unix timestamp in seconds (not milliseconds)
- `exp`: If present, token invalid after this time
- `P2PKlock`: 64-char hex public key; only this key can unlock
- `timeLock`: Unix timestamp; cannot spend before this time
- `HTLC`: SHA-256 hash; must provide preimage to unlock
- `amount`: Positive integer or float for fungible tokens
- `tokenID`: Unique string identifier for TATs (no format constraints)
- `setID`: Groups related fungible tokens (e.g., "USD", "loyalty-points")

**Lock Priority (when multiple locks present):**
1. HTLC (highest priority)
2. P2PKlock
3. timeLock (lowest priority)

### 3.4 Signature

The signature is computed over the entire JWT string (header + payload):

```
message = BASE64URL(header) + "." + BASE64URL(payload)
signature = Schnorr_Sign(secretKey, SHA256(message))
```

### 3.5 Token Validation Rules

A token is valid if ALL of the following are true:

1. **Structure**: Valid JWT format with all required fields
2. **Signature**: Schnorr signature verifies against `iss` public key
3. **Hash**: `token_hash` matches SHA-256 of payload
4. **Expiration**: If `exp` present, current time < exp
5. **Time Lock**: If `timeLock` present, current time >= timeLock
6. **Not Spent**: Token hash not in issuer's spent set
7. **Type-Specific**:
   - FUNGIBLE: `amount` present and positive
   - TAT: `tokenID` present and non-empty

### 3.6 Example Tokens

**Example FUNGIBLE Token:**

```json
{
  "header": {
    "alg": "Schnorr",
    "typ": "FUNGIBLE",
    "token_hash": "a1b2c3d4e5f6...",
    "ver": "1.0.0"
  },
  "payload": {
    "iss": "abc123...",
    "iat": 1703001600,
    "amount": 100,
    "setID": "loyalty-points",
    "P2PKlock": "def456...",
    "ext": {
      "merchant": "Example Store",
      "promotion": "Holiday2025"
    }
  },
  "signature": "xyz789..."
}
```

**Example TAT Token:**

```json
{
  "header": {
    "alg": "Schnorr",
    "typ": "TAT",
    "token_hash": "f1e2d3c4b5a6...",
    "ver": "1.0.0"
  },
  "payload": {
    "iss": "abc123...",
    "iat": 1703001600,
    "exp": 1735624800,
    "tokenID": "ticket-vip-001",
    "P2PKlock": "ghi789...",
    "ext": {
      "event": "Concert 2025",
      "seat": "A1",
      "venue": "Madison Square Garden"
    }
  },
  "signature": "uvw456..."
}
```

---

## 4. NWPC Protocol

### 4.1 Overview

NWPC (Nostr Wrapped Procedure Call) provides RPC-style communication over Nostr events.

**Key Properties:**
- Request/Response pattern
- End-to-end encrypted (NIP-44)
- Authenticated (Nostr signatures)
- Sealed sender (NIP-59 gift wrap)

### 4.2 Message Format

All NWPC messages are Nostr events (kind 1059 - Gift Wrap).

**Request Message:**

```typescript
{
  "method": string,           // REQUIRED: Method name
  "params": object,           // REQUIRED: Method parameters
  "id": string,              // REQUIRED: Unique request ID (UUID)
  "ver": "1.0.0"            // REQUIRED: Protocol version
}
```

**Response Message:**

```typescript
{
  "result": any,             // Present on success
  "error": {                 // Present on error
    "code": number,
    "message": string,
    "data"?: any
  },
  "id": string,              // REQUIRED: Matches request ID
  "ver": "1.0.0"            // REQUIRED: Protocol version
}
```

### 4.3 Standard Methods

#### 4.3.1 Token Methods

**`mint`** - Forge mints new token to recipient

Request:
```typescript
{
  "method": "mint",
  "params": {
    "token_type": "FUNGIBLE" | "TAT",
    "recipient": string,      // Public key or address
    "amount"?: number,        // Required for FUNGIBLE
    "tokenID"?: string,       // Required for TAT
    "exp"?: number,
    "ext"?: object
  },
  "id": "uuid",
  "ver": "1.0.0"
}
```

Response:
```typescript
{
  "result": {
    "token": string,          // Complete JWT token
    "token_hash": string
  },
  "id": "uuid",
  "ver": "1.0.0"
}
```

**`transfer`** - Transfer token to new recipient

Request:
```typescript
{
  "method": "transfer",
  "params": {
    "tokens": string[],       // Array of JWT tokens to spend
    "recipient": string,      // New owner public key
    "amount"?: number,        // For fungible transfers
    "unlock"?: {              // Unlock parameters if needed
      "preimage"?: string,    // HTLC preimage
      "signature"?: string    // P2PK signature proof
    }
  },
  "id": "uuid",
  "ver": "1.0.0"
}
```

Response:
```typescript
{
  "result": {
    "tokens": string[],       // New tokens for recipient
    "change"?: string[]       // Change tokens (fungible only)
  },
  "id": "uuid",
  "ver": "1.0.0"
}
```

**`burn`** - Destroy token

Request:
```typescript
{
  "method": "burn",
  "params": {
    "tokens": string[]        // Tokens to burn
  },
  "id": "uuid",
  "ver": "1.0.0"
}
```

Response:
```typescript
{
  "result": {
    "burned": string[]        // Hashes of burned tokens
  },
  "id": "uuid",
  "ver": "1.0.0"
}
```

#### 4.3.2 Query Methods

**`verify`** - Check if token is valid and unspent

Request:
```typescript
{
  "method": "verify",
  "params": {
    "token_hashes": string[]
  },
  "id": "uuid",
  "ver": "1.0.0"
}
```

Response:
```typescript
{
  "result": {
    "valid": { [hash: string]: boolean },
    "spent": { [hash: string]: boolean }
  },
  "id": "uuid",
  "ver": "1.0.0"
}
```

**`getSupply`** - Query token supply information

Request:
```typescript
{
  "method": "getSupply",
  "params": {
    "setID"?: string          // Optional for fungible tokens
  },
  "id": "uuid",
  "ver": "1.0.0"
}
```

Response:
```typescript
{
  "result": {
    "total": number,
    "circulating": number,
    "burned": number
  },
  "id": "uuid",
  "ver": "1.0.0"
}
```

### 4.4 Error Codes

Standard NWPC error codes:

| Code | Message | Description |
|------|---------|-------------|
| 1000 | Parse Error | Invalid JSON or message format |
| 1001 | Invalid Request | Missing required fields |
| 1002 | Method Not Found | Unknown method name |
| 1003 | Invalid Params | Parameter validation failed |
| 2000 | Token Invalid | Token signature or format invalid |
| 2001 | Token Expired | Token past expiration time |
| 2002 | Token Spent | Token already spent (double-spend) |
| 2003 | Insufficient Balance | Not enough tokens to transfer |
| 2004 | Unauthorized | Signature verification failed |
| 2005 | Supply Limit | Would exceed total supply |
| 3000 | Internal Error | Server-side processing error |

---

## 5. Cryptographic Primitives

### 5.1 Algorithms

**Signing:**
- Algorithm: Schnorr signatures over secp256k1
- Library: Compatible with nostr-tools, noble-curves
- Format: 64-byte signatures (r || s)

**Hashing:**
- Algorithm: SHA-256
- Use cases: Token hashes, HTLC commitments
- Output: 32-byte (256-bit) digest

**Encryption:**
- Algorithm: NIP-44 (ChaCha20-Poly1305 with HKDF)
- Use: All NWPC messages
- Properties: Authenticated encryption with associated data (AEAD)

**Key Derivation:**
- Standard: BIP-32 (HD keys)
- Mnemonic: BIP-39 (12-24 words)
- Curve: secp256k1

### 5.2 Key Formats

**Public Keys:**
- Format: 32-byte x-coordinate (Nostr format)
- Encoding: Hex string (64 characters)
- Example: `abc123def456...` (64 chars)

**Secret Keys:**
- Format: 32-byte scalar
- Encoding: Hex string (64 characters)
- Storage: MUST be encrypted at rest

**Signatures:**
- Format: 64-byte Schnorr signature (r || s)
- Encoding: Hex string (128 characters)

### 5.3 Nostr Event Types

TAT Protocol uses the following Nostr event kinds:

| Kind | Description | Usage |
|------|-------------|-------|
| 1059 | Gift Wrap | All NWPC messages (encrypted) |
| 1060 | Gift Wrapped Seal | Inner sealed message |

All protocol messages MUST use gift wrap (NIP-59) for:
- Sender anonymity
- Receiver privacy
- Message confidentiality

---

## 6. Message Flow

### 6.1 Token Minting Flow

```
┌────────┐                 ┌───────┐                 ┌────────┐
│ Pocket │                 │ Relay │                 │ Forge  │
└───┬────┘                 └───┬───┘                 └───┬────┘
    │                          │                         │
    │ 1. Request address       │                         │
    ├─────────────────────────────────────────────────>│
    │                          │                         │
    │ 2. Return address        │                         │
    │<─────────────────────────────────────────────────┤
    │                          │                         │
    │                          │ 3. mint request         │
    │                          │<────────────────────────┤
    │                          │                         │
    │ 4. Forward request       │                         │
    │<─────────────────────────┤                         │
    │                          │                         │
    │ 5. Process + store token │                         │
    │                          │                         │
    │ 6. mint response         │                         │
    ├─────────────────────────>│                         │
    │                          │ 7. Forward response     │
    │                          ├────────────────────────>│
```

### 6.2 Token Transfer Flow

```
┌────────┐     ┌────────┐     ┌───────┐     ┌───────┐
│Sender  │     │Receiver│     │ Relay │     │ Forge │
│Pocket  │     │Pocket  │     │       │     │       │
└───┬────┘     └───┬────┘     └───┬───┘     └───┬───┘
    │              │              │             │
    │ 1. transfer request         │             │
    ├──────────────────────────────────────────>│
    │              │              │             │
    │              │              │ 2. Validate │
    │              │              │ 3. Mark spent
    │              │              │             │
    │ 4. New tokens for receiver  │             │
    │<─────────────────────────────────────────┤
    │              │              │             │
    │ 5. Forward to receiver      │             │
    ├─────────────────────────────>│             │
    │              │<─────────────┤             │
    │              │              │             │
    │              │ 6. Store tokens            │
    │              │              │             │
```

### 6.3 Replay Protection

Both Forge and Pocket MUST track processed events:

1. **Event ID Tracking**: Store Nostr event IDs in bloom filter + LRU cache
2. **Token Hash Tracking**: Store spent token hashes permanently
3. **Idempotency**: Re-processing same event ID returns cached response

---

## 7. Security Model

### 7.1 Threat Model

**Protected Against:**
- Token forgery (signature verification)
- Double-spending (spent token tracking)
- Replay attacks (event ID tracking)
- Man-in-the-middle (end-to-end encryption)
- Impersonation (cryptographic signatures)

**NOT Protected Against:**
- Issuer misbehavior (trust model)
- Key compromise (user responsibility)
- Relay censorship (use multiple relays)
- Denial of service (rate limiting required)

### 7.2 Security Requirements

**Implementations MUST:**
1. Validate all token signatures
2. Check token expiration if `exp` present
3. Verify token not in spent set before accepting
4. Use cryptographically secure random for keys
5. Encrypt all NWPC messages with NIP-44
6. Track processed event IDs to prevent replay
7. Use gift wrap (NIP-59) for all messages

**Implementations SHOULD:**
1. Encrypt keys at rest
2. Use HD key derivation (BIP-32)
3. Connect to multiple Nostr relays
4. Implement rate limiting
5. Log security-relevant events
6. Provide key backup/recovery

**Implementations MAY:**
1. Support hardware wallets
2. Implement multi-signature schemes
3. Add application-specific validation rules
4. Cache verification results

---

## 8. Extension Mechanism

### 8.1 Extension Fields

Any token can include an `ext` object with custom data:

```typescript
{
  "ext": {
    "custom_field": "any value",
    "nested": {
      "data": "structures"
    },
    "arrays": [1, 2, 3]
  }
}
```

**Rules:**
1. `ext` is OPTIONAL
2. Must be valid JSON object
3. Included in token hash
4. Signed by issuer
5. No standardized fields (application-defined)

### 8.2 Custom Token Types

Future protocol versions may add token types:
- `typ: "DERIVED"` - Tokens derived from parent tokens
- `typ: "BUNDLE"` - Collections of tokens
- `typ: "FRACTIONAL"` - Divisible NFTs

### 8.3 Custom NWPC Methods

Applications can define custom methods:

```typescript
{
  "method": "x-custom-method",  // Prefix with "x-"
  "params": { /* custom */ }
}
```

Standard methods use no prefix. Custom methods use `x-` prefix.

---

## 9. Versioning

### 9.1 Protocol Version

Current version: **1.0.0** (Semantic Versioning)

**Version Number Format:** `MAJOR.MINOR.PATCH`

- **MAJOR**: Breaking changes (incompatible tokens)
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes (no protocol changes)

### 9.2 Version Field

All tokens and NWPC messages include `ver` field:

```typescript
{
  "ver": "1.0.0"
}
```

### 9.3 Compatibility Rules

**Implementations MUST:**
1. Include `ver` field in all messages
2. Reject tokens with unsupported MAJOR version
3. Accept tokens with same MAJOR, any MINOR/PATCH
4. Return error for unknown versions

**Example:**
- Implementation supports `1.5.0`
- Can accept: `1.0.0`, `1.5.2`, `1.9.9`
- Must reject: `2.0.0`, `0.9.0`

### 9.4 Future Versions

Planned for v1.1.0:
- Token revocation lists
- Multi-signature support
- Batch transfer operations

Planned for v2.0.0:
- Breaking: New signature algorithm option
- Breaking: Required metadata fields

---

## 10. Implementation Checklist

### 10.1 Minimum Viable Implementation

A conforming implementation MUST support:

- [ ] Token creation (FUNGIBLE and TAT types)
- [ ] Token signature generation and verification
- [ ] Token hash computation
- [ ] NWPC message encoding/decoding
- [ ] NIP-44 encryption/decryption
- [ ] NIP-59 gift wrap
- [ ] Spent token tracking
- [ ] Event ID replay protection
- [ ] Methods: mint, transfer, verify
- [ ] Protocol version checking

### 10.2 Recommended Features

Implementations SHOULD support:

- [ ] HD key derivation (BIP-32)
- [ ] Storage abstraction layer
- [ ] Multiple relay connections
- [ ] Token expiration handling
- [ ] P2PK lock validation
- [ ] HTLC support
- [ ] Supply tracking
- [ ] Methods: burn, getSupply

### 10.3 Optional Features

Implementations MAY support:

- [ ] Time locks
- [ ] Custom extension fields
- [ ] Token metadata standards
- [ ] Address book
- [ ] Transaction history
- [ ] Backup/restore
- [ ] Hardware wallet integration

---

## 11. References

### 11.1 Specifications

- [Nostr Protocol (NIPs)](https://github.com/nostr-protocol/nips)
- [NIP-01: Basic Protocol](https://github.com/nostr-protocol/nips/blob/master/01.md)
- [NIP-44: Encrypted Payloads](https://github.com/nostr-protocol/nips/blob/master/44.md)
- [NIP-59: Gift Wrap](https://github.com/nostr-protocol/nips/blob/master/59.md)
- [BIP-32: HD Keys](https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki)
- [BIP-39: Mnemonic](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki)
- [RFC 7519: JWT](https://tools.ietf.org/html/rfc7519)

### 11.2 Cryptography

- [Schnorr Signatures (BIP-340)](https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki)
- [secp256k1](https://www.secg.org/sec2-v2.pdf)
- [SHA-256 (FIPS 180-4)](https://csrc.nist.gov/publications/detail/fips/180/4/final)

### 11.3 Implementations

- **Reference (TypeScript)**: https://github.com/tat-protocol/tat-protocol
- **Rust**: (Community implementation - coming soon)
- **Python**: (Community implementation - coming soon)

---

## Appendix A: Glossary

- **Forge**: Token issuer/authority
- **Pocket**: Token wallet/client
- **TAT**: Transferable Access Token (NFT)
- **NWPC**: Nostr Wrapped Procedure Call
- **P2PK**: Pay to Public Key lock
- **HTLC**: Hash Time-Locked Contract
- **Gift Wrap**: NIP-59 sealed sender pattern
- **Schnorr**: Digital signature algorithm

---

## Appendix B: Change Log

### v1.0.0 (2025-12-17)
- Initial protocol specification
- Token format (FUNGIBLE, TAT)
- NWPC methods (mint, transfer, burn, verify)
- Cryptographic primitives
- Security model
- Extension mechanism

---

**Document Status**: Living specification
**License**: CC0 (Public Domain)
**Feedback**: Submit issues at https://github.com/tat-protocol/tat-protocol/issues
