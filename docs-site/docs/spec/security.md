# Security Model

## Threat model

### Protected against

| Threat | Protection |
|--------|-----------|
| **Token forgery** | Schnorr signature verification — only the issuer's key can sign valid tokens |
| **Double-spending** | Forge maintains an authoritative spent-token set |
| **Replay attacks** | Event ID deduplication via Bloom filter + LRU cache |
| **Man-in-the-middle** | End-to-end NIP-44 encryption on all messages |
| **Impersonation** | Cryptographic Schnorr signatures on all events |
| **Metadata leakage** | NIP-59 gift wrap hides sender identity from relay operators |

### Not protected against

| Threat | Mitigation |
|--------|-----------|
| **Issuer misbehavior** | Trust model — users must trust the issuer to honor tokens |
| **Key compromise** | User responsibility — use HD keys, encrypted storage, secure backups |
| **Relay censorship** | Connect to multiple independent relays |
| **Denial of service** | Implement rate limiting on Forge and Gate |

## Trust model

TAT Protocol uses an **issuer authority model**. Users trust:

1. **Cryptography** — Schnorr signatures, NIP-44 encryption
2. **Issuer reputation** — like trusting a bank or loyalty program
3. **Open protocol** — anyone can verify token structure
4. **Relay infrastructure** — for message delivery (not content integrity)

Users do NOT need to trust:
- Network consensus (no blockchain)
- Miners or validators
- Smart contract execution
- Relay operators (messages are encrypted)

## Security requirements

### MUST (required for conforming implementations)

1. Validate all token signatures before accepting
2. Check token expiration (`exp` field) if present
3. Verify token is not in the spent set before accepting
4. Use cryptographically secure randomness for key generation
5. Encrypt all NWPC messages with NIP-44
6. Track processed event IDs to prevent replay
7. Use NIP-59 gift wrap for all protocol messages

### SHOULD (recommended)

1. Encrypt keys at rest
2. Use HD key derivation (BIP-32) for deterministic key management
3. Connect to multiple Nostr relays for redundancy
4. Implement rate limiting on Forge and Gate endpoints
5. Log security-relevant events for audit
6. Provide key backup and recovery mechanisms

### MAY (optional)

1. Support hardware wallets for key storage
2. Implement multi-signature schemes
3. Add application-specific validation rules
4. Cache verification results for performance

## Encryption layers

Messages go through multiple encryption layers:

```
Application data (JSON)
  └─► NIP-44 encrypt (XChaCha20-Poly1305 + HKDF)
        └─► NIP-59 gift wrap (sealed sender)
              └─► Nostr event (kind 1059)
                    └─► Relay delivery
```

1. **NIP-44** — encrypts the message content so only the recipient can read it
2. **NIP-59** — wraps the encrypted message in a "gift wrap" that hides the true sender from relay operators
3. **Nostr signatures** — the outer event is signed, but the signer is an ephemeral key (not the real sender)

## Token validation chain

When a Gate or Pocket receives a token, validation follows this chain:

1. **Parse** — decode JWT, extract header/payload/signature
2. **Structure** — verify all required fields are present
3. **Hash** — verify `token_hash` matches SHA-256 of payload
4. **Signature** — verify Schnorr signature against `iss` public key
5. **Expiration** — if `exp` present, verify not expired
6. **Locks** — if locked, verify unlock conditions are met
7. **Spent** — verify token hash is not in the issuer's spent set

## Double-spend prevention

The Forge maintains a **spent-token set** — a persistent collection of token hashes that have been consumed.

- When a token is transferred, burned, or redeemed, its hash is added to the spent set
- Before processing any transfer, the Forge checks all input token hashes against the spent set
- The spent set is persisted to storage and survives restarts
- Event ID deduplication prevents the same transfer request from being processed twice
