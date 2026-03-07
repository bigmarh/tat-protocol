# Token Format Specification

Tokens in TAT Protocol use JWT (JSON Web Token) format with Schnorr signatures.

## Structure

```
BASE64URL(Header) . BASE64URL(Payload) . BASE64URL(Signature)
```

## Header

All fields are required.

```json
{
  "alg": "Schnorr",
  "typ": "FUNGIBLE",
  "token_hash": "a1b2c3d4...",
  "ver": "1.0.0"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `alg` | `string` | MUST be `"Schnorr"` (secp256k1 Schnorr signatures) |
| `typ` | `string` | `"FUNGIBLE"` or `"TAT"` |
| `token_hash` | `string` | Hex-encoded SHA-256 hash of the canonical payload JSON |
| `ver` | `string` | Protocol version (semantic versioning) |

## Payload

### Common fields (all token types)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `iss` | `string` | Yes | Issuer public key (64-char hex, 32-byte x-coordinate) |
| `iat` | `number` | Yes | Issued-at timestamp (Unix seconds, not milliseconds) |
| `exp` | `number` | No | Expiration timestamp (Unix seconds). Token invalid after this time. |
| `P2PKlock` | `string` | No | Pay-to-Public-Key lock (64-char hex). Only this key can unlock. |
| `timeLock` | `number` | No | Time lock (Unix seconds). Cannot spend before this time. |
| `HTLC` | `string` | No | Hash Time-Locked Contract (hex SHA-256 hash). Must provide preimage to unlock. |
| `data_uri` | `string` | No | URI to external metadata |
| `ext` | `object` | No | Extension fields (arbitrary JSON, application-defined) |

### Fungible token fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `amount` | `number` | Yes | Token value (positive integer or float) |
| `setID` | `string` | No | Token set identifier (e.g., `"USD"`, `"loyalty-points"`) |

### TAT (non-fungible) token fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tokenID` | `string` | Yes | Unique identifier (no format constraints) |

## Lock priority

When multiple locks are present, they are evaluated in this order:

1. **HTLC** (highest priority) — must provide preimage
2. **P2PKlock** — must prove key ownership
3. **timeLock** (lowest priority) — must wait until timestamp

## Signature

The signature is computed over the encoded header and payload:

```
message = BASE64URL(header) + "." + BASE64URL(payload)
signature = Schnorr_Sign(secretKey, SHA256(message))
```

- Algorithm: Schnorr signatures over secp256k1
- Format: 64-byte signature (r || s)
- Encoding: hex string (128 characters)

## Validation rules

A token is valid if ALL of the following are true:

1. **Structure** — valid JWT format with all required fields present
2. **Signature** — Schnorr signature verifies against the `iss` public key
3. **Hash** — `token_hash` in the header matches SHA-256 of the payload
4. **Expiration** — if `exp` is present, current time < `exp`
5. **Time lock** — if `timeLock` is present, current time >= `timeLock`
6. **Not spent** — token hash is not in the issuer's spent-token set
7. **Type-specific**:
   - FUNGIBLE: `amount` is present and positive
   - TAT: `tokenID` is present and non-empty

## Examples

### Fungible token

```json
{
  "header": {
    "alg": "Schnorr",
    "typ": "FUNGIBLE",
    "token_hash": "a1b2c3d4e5f6...",
    "ver": "1.0.0"
  },
  "payload": {
    "iss": "abc123def456...",
    "iat": 1703001600,
    "amount": 100,
    "setID": "loyalty-points",
    "P2PKlock": "def456abc123...",
    "ext": {
      "merchant": "Example Store",
      "promotion": "Holiday2025"
    }
  },
  "signature": "xyz789..."
}
```

### TAT (non-fungible) token

```json
{
  "header": {
    "alg": "Schnorr",
    "typ": "TAT",
    "token_hash": "f1e2d3c4b5a6...",
    "ver": "1.0.0"
  },
  "payload": {
    "iss": "abc123def456...",
    "iat": 1703001600,
    "exp": 1735624800,
    "tokenID": "ticket-vip-001",
    "P2PKlock": "ghi789jkl012...",
    "ext": {
      "event": "Concert 2026",
      "seat": "A1",
      "venue": "Madison Square Garden"
    }
  },
  "signature": "uvw456..."
}
```

## Extension fields

The `ext` object supports arbitrary JSON. It is:
- Included in the token hash
- Signed by the issuer
- Application-defined (no standardized fields)

```json
{
  "ext": {
    "custom_field": "any value",
    "nested": { "data": "structures" },
    "arrays": [1, 2, 3]
  }
}
```
