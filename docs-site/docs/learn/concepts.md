# Core Concepts

This page covers the fundamental ideas behind TAT Protocol. For definitions of specific terms, see the [Glossary](/learn/glossary).

## Token lifecycle

Every token follows this lifecycle:

```
Mint → Hold → Transfer or Redeem → Spent
```

1. **Mint** — A Forge creates a new token, signs it with Schnorr, and sends it to a recipient's Pocket.
2. **Hold** — The Pocket stores the token locally and tracks the balance.
3. **Transfer** — The Pocket sends the token back to the Forge with a transfer request. The Forge validates it, marks the original as spent, and mints a new token for the new recipient (plus change tokens if needed).
4. **Redeem/Burn** — The token is consumed (e.g., a ticket is scanned at a Gate) or explicitly burned via the Forge.

Once a token is spent, the Forge records its hash in a spent-token set. Any future attempt to spend it is rejected.

## Token format

Tokens are JWTs with three parts: `Header.Payload.Signature`

**Header:**
| Field | Value | Description |
|-------|-------|-------------|
| `alg` | `"Schnorr"` | Signature algorithm (secp256k1) |
| `typ` | `"FUNGIBLE"` or `"TAT"` | Token type |
| `token_hash` | string | SHA-256 hash of the payload |
| `ver` | `"1.0.0"` | Protocol version |

**Payload:**
| Field | Required | Description |
|-------|----------|-------------|
| `iss` | Yes | Issuer public key (Forge) |
| `iat` | Yes | Issued-at timestamp (seconds) |
| `exp` | No | Expiration timestamp (seconds) |
| `amount` | Fungible only | Token value |
| `tokenID` | TAT only | Unique identifier |
| `P2PKlock` | No | Public key lock (ownership proof) |
| `timeLock` | No | Earliest spend time |
| `HTLC` | No | Hash for hash time-locked contracts |
| `data_uri` | No | URI for additional metadata |
| `ext` | No | Extension fields (arbitrary JSON) |

## Lock mechanisms

Tokens can be locked to restrict who can spend them and when.

### P2PK Lock (Pay-to-Public-Key)
The most common lock. The token can only be spent by the holder of a specific private key. When a Pocket generates a receive address, it creates a single-use keypair and the token is locked to that public key.

### Time Lock
Prevents spending until a specified timestamp. Useful for vesting schedules or delayed-release tokens.

### HTLC (Hash Time-Locked Contract)
Requires presenting a secret whose hash matches the stored value. Used for atomic swaps — two parties can exchange tokens across different Forges without trusting each other.

## Single-use keys and privacy

Pockets generate single-use keypairs for every receive address. This means:

- Each token is locked to a unique key, so observers cannot link multiple tokens to the same wallet
- The Forge knows which tokens it minted, but observers on relays see only encrypted messages between random-looking keys
- Combined with NIP-59 gift wrapping, even relay operators cannot see who is communicating

## Denominations

Fungible Forges define a set of **denominations** — the allowed token amounts they will mint. For example:

```ts
denomination: [1, 5, 10, 20, 50, 100]
```

When minting 73 units, the Forge creates: `50 + 20 + 1 + 1 + 1` (five tokens). When transferring, the Forge handles change automatically — if you send 30 from a 50-unit token, you receive a 20-unit change token.

## Supply management

Forges can optionally enforce a total supply cap:

- `totalSupply` — maximum tokens that can ever be minted
- `circulatingSupply` — currently active (unspent) tokens

When a token is burned, it reduces the circulating supply but not the total supply.

## NWPC (Nostr Wrapped Procedure Call)

All communication between protocol components uses NWPC — a JSON-RPC 2.0 layer over encrypted Nostr direct messages.

**Request:**
```json
{
  "id": "unique-request-id",
  "method": "forge",
  "params": "{ ... }",
  "timestamp": 1700000000
}
```

**Response:**
```json
{
  "id": "unique-request-id",
  "result": { ... },
  "timestamp": 1700000001
}
```

Every message is:
- **Encrypted** with NIP-44 (XChaCha20-Poly1305)
- **Wrapped** with NIP-59 gift wrap (sealed sender)
- **Signed** with Schnorr signatures
- **Deduplicated** to prevent replay attacks

## Derived tokens

Tokens can be derived from parent tokens to create access rules. A derived token references its parent hash and can carry flexible access control policies — useful for delegation, sub-access, and tiered permissions.

## Extensions

The protocol supports extension via:
- The `ext` field in token payloads (arbitrary JSON metadata)
- Custom NWPC methods (register new handlers on Forge/Gate/Booth)
- Discovery events (Nostr kind 30100-30131) for announcing services

## Next steps

- [Architecture](/learn/architecture) — how components connect
- [Quickstart](/guides/quickstart) — build something
- [Token Format Spec](/spec/token-format) — formal specification
