# Token

> `@tat-protocol/token` — Token model, JWT serialization, validation, and lock mechanisms.

## Installation

```bash
npm install @tat-protocol/token
```

Or use `@tat-protocol/tdk` which includes this package.

## Overview

The `Token` class is the core data structure for all TAT Protocol tokens. Tokens are JWTs with a header, payload, and Schnorr signature. This package handles building, serializing, validating, and managing lock conditions on tokens.

## TokenType

```ts
enum TokenType {
  FUNGIBLE = "FUNGIBLE",
  TAT = "TAT",
}
```

## Token structure

### Header

| Field | Type | Description |
|-------|------|-------------|
| `alg` | `string` | `"Schnorr"` — signature algorithm |
| `typ` | `TokenType` | `FUNGIBLE` or `TAT` |
| `token_hash` | `string` | SHA-256 hash of the payload |
| `ver` | `string` | Protocol version (`"1.0.0"`) |

### Payload

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `iss` | `string` | Yes | Issuer (Forge) public key |
| `iat` | `number` | Yes | Issued-at timestamp (seconds) |
| `exp` | `number` | No | Expiration timestamp (seconds) |
| `amount` | `number` | Fungible | Token value |
| `tokenID` | `string` | TAT | Unique identifier |
| `P2PKlock` | `string` | No | Pay-to-Public-Key lock |
| `timeLock` | `number` | No | Earliest spend time |
| `HTLC` | `string` | No | Hash for hash time-locked contract |
| `data_uri` | `string` | No | URI for additional metadata |
| `ext` | `Record<string, unknown>` | No | Extension fields |

Lock priority order: **HTLC > TimeLock > P2PK**

## API Reference

### Building tokens

#### `build()`

```ts
async build(opts: TokenBuildParams): Promise<Token>
```

Build a new token from parameters.

```ts
const token = await new Token().build({
  token_type: TokenType.FUNGIBLE,
  payload: {
    iss: forgePubkey,
    iat: Math.floor(Date.now() / 1000),
    amount: 100,
    P2PKlock: recipientPubkey,
  },
});
```

#### `Token.createHeader()`

```ts
static createHeader(typ: TokenType, tokenHash: string): Header
```

Create a standard token header.

#### `Token.createPayload()`

```ts
static createPayload(payloadObj: Record<string, unknown>): Payload
```

Create a payload from a parameter object with defaults.

### Serialization

#### `restore()`

```ts
async restore(jwt: string): Promise<Token>
```

Reconstruct a token from a JWT string.

```ts
const token = await new Token().restore(tokenJWT);
```

#### `toJWT()`

```ts
async toJWT(signature: string): Promise<string>
```

Serialize token to JWT format: `base64(header).base64(payload).base64(signature)`.

#### `fromJWT()`

```ts
async fromJWT(jwt: string): Promise<Token>
```

Parse a JWT string back into a Token instance.

#### `toJSON()`

```ts
toJSON(): string
```

Convert token to JSON string.

### Signing & verification

#### `sign()`

```ts
async sign(data: Uint8Array, keys: KeyPair): Promise<Uint8Array>
```

Sign data using Schnorr signature (secp256k1).

#### `data_to_sign()`

```ts
async data_to_sign(): Promise<Uint8Array>
```

Prepare the data that needs to be signed (header + payload encoding).

#### `validate()`

```ts
async validate(): Promise<boolean>
```

Validate token structure and required fields (issuer, timestamp, type).

#### `verifyTokenHash()`

```ts
async verifyTokenHash(): Promise<boolean>
```

Verify that the token hash in the header matches the current payload. Non-mutating.

#### `verifyTokenSignature()`

```ts
async verifyTokenSignature(): Promise<boolean>
```

Verify the Schnorr signature against the token hash.

#### `create_token_hash()`

```ts
async create_token_hash(
  readerPubkey?: string,
  timeWindow?: number
): Promise<string>
```

Compute the SHA-256 double-hash of the payload for token identification.

### Accessors

#### `getTokenType()`

```ts
getTokenType(): TokenType
```

#### `getAmount()`

```ts
getAmount(): number
```

Returns the token amount (defaults to 0 if not set).

#### `getIssuer()`

```ts
getIssuer(): string
```

Returns the issuer (Forge) public key.

#### `getHeader()`

```ts
getHeader(): Header
```

#### `getPayload()`

```ts
getPayload(): Payload
```

#### `isExpired()`

```ts
isExpired(): boolean
```

Returns `true` if the token's `exp` timestamp has passed.

### Lock mechanisms

#### `lock()`

```ts
lock(lockType: "P2PK" | "HTLC" | "TIME", lockValue: string | number): void
```

Apply a lock to the token.

```ts
// Lock to a specific public key
token.lock("P2PK", recipientPubkey);

// Lock until a specific time
token.lock("TIME", Math.floor(Date.now() / 1000) + 86400); // 24 hours

// Lock with HTLC hash
token.lock("HTLC", sha256Hash);
```

#### `unlock()`

```ts
unlock(lockType: "P2PK" | "HTLC" | "TIME"): void
```

Remove a lock from the token.

#### `isLocked()`

```ts
isLocked(): boolean
```

Returns `true` if any lock is active.

#### `getLockType()`

```ts
getLockType(): "P2PK" | "HTLC" | "TIME" | null
```

Returns the active lock type, or `null` if unlocked.

#### `hasP2PKLock()`

```ts
hasP2PKLock(): boolean
```

#### `isTimeLocked()`

```ts
isTimeLocked(): boolean
```

Returns `true` if the token has a time lock that hasn't expired yet.

#### `hasHTLC()`

```ts
hasHTLC(): boolean
```

### Derived tokens

#### `Token.createDerivedToken()`

```ts
static async createDerivedToken(
  tokenType: TokenType,
  parentToken: Token,
  accessRules: AccessRules
): Promise<Token>
```

Create a derived token that references a parent token and carries access control rules. Useful for delegation and sub-access.

#### `getAccessRules()`

```ts
getAccessRules(): AccessRules | undefined
```

Get the access rules for a derived token.

#### `isDerivedFrom()` (DerivedToken)

```ts
isDerivedFrom(parentTokenHash: string): boolean
```

Verify if a token is derived from a specific parent.

## Related

- [Forge](/sdk/forge) — mints and signs tokens
- [Pocket](/sdk/pocket) — stores and transfers tokens
- [Token Format Spec](/spec/token-format) — formal specification
