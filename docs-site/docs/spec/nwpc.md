# NWPC Protocol Specification

NWPC (Nostr Wrapped Procedure Call) provides RPC-style communication over Nostr events with end-to-end encryption.

## Properties

- **Request/Response** pattern (JSON-RPC 2.0 style)
- **End-to-end encrypted** (NIP-44: XChaCha20-Poly1305 with HKDF)
- **Authenticated** (Nostr Schnorr signatures)
- **Sealed sender** (NIP-59 gift wrap)
- **Replay protected** (event ID deduplication)

## Transport

All NWPC messages are Nostr events using gift wrap (kind 1059):

| Kind | Description | Usage |
|------|-------------|-------|
| 1059 | Gift Wrap | All NWPC messages (encrypted outer envelope) |
| 1060 | Gift Wrapped Seal | Inner sealed message |

All protocol messages MUST use NIP-59 gift wrap for sender anonymity, receiver privacy, and message confidentiality.

## Message format

### Request

```json
{
  "method": "mint",
  "params": { "recipient": "abc123...", "amount": 100 },
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "ver": "1.0.0"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `method` | `string` | Yes | Method name |
| `params` | `object` | Yes | Method parameters |
| `id` | `string` | Yes | Unique request ID (UUID) |
| `ver` | `string` | Yes | Protocol version |

### Response (success)

```json
{
  "result": { "token": "eyJ...", "token_hash": "abc..." },
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "ver": "1.0.0"
}
```

### Response (error)

```json
{
  "error": { "code": 2003, "message": "Insufficient balance" },
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "ver": "1.0.0"
}
```

## Standard methods

### Token methods

#### `mint`

Forge mints new tokens to a recipient.

**Request params:**
```json
{
  "token_type": "FUNGIBLE",
  "recipient": "pubkey_hex",
  "amount": 100,
  "exp": 1735624800,
  "ext": { "memo": "Welcome bonus" }
}
```

**Response result:**
```json
{
  "token": "eyJhbGci...",
  "token_hash": "abc123..."
}
```

#### `transfer`

Transfer tokens to a new recipient. The Forge validates inputs, marks them as spent, and mints new tokens.

**Request params:**
```json
{
  "tokens": ["jwt1", "jwt2"],
  "recipient": "pubkey_hex",
  "amount": 50,
  "unlock": {
    "signature": "witness_signature_hex"
  }
}
```

**Response result:**
```json
{
  "tokens": ["new_jwt_for_recipient"],
  "change": ["change_jwt_for_sender"]
}
```

#### `burn`

Destroy tokens permanently.

**Request params:**
```json
{
  "tokens": ["jwt1", "jwt2"]
}
```

**Response result:**
```json
{
  "burned": ["hash1", "hash2"]
}
```

### Query methods

#### `verify`

Check if tokens are valid and unspent.

**Request params:**
```json
{
  "token_hashes": ["hash1", "hash2"]
}
```

**Response result:**
```json
{
  "valid": { "hash1": true, "hash2": false },
  "spent": { "hash1": false, "hash2": true }
}
```

#### `getSupply`

Query supply information.

**Request params:**
```json
{
  "setID": "loyalty-points"
}
```

**Response result:**
```json
{
  "total": 1000000,
  "circulating": 750000,
  "burned": 50000
}
```

## Custom methods

Applications can define custom methods with the `x-` prefix:

```json
{
  "method": "x-custom-method",
  "params": { }
}
```

Standard methods use no prefix. Custom methods SHOULD use `x-` prefix to avoid collisions.

## Replay protection

Both Forge and Pocket MUST track processed events:

1. **Event ID tracking** — store Nostr event IDs in Bloom filter + LRU cache
2. **Token hash tracking** — store spent token hashes permanently
3. **Idempotency** — re-processing the same event ID returns a cached response

## Error codes

See [Error Codes](/spec/error-codes) for the full reference.

## Versioning

All messages include a `ver` field. Implementations MUST:
- Include `ver` in all messages
- Reject tokens with unsupported MAJOR version
- Accept tokens with same MAJOR, any MINOR/PATCH
