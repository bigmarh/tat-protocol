# Cryptographic Primitives

TAT Protocol uses established cryptographic standards from the Nostr and Bitcoin ecosystems.

## Signing: Schnorr (secp256k1)

All tokens and events are signed using Schnorr signatures over the secp256k1 curve.

| Property | Value |
|----------|-------|
| Algorithm | Schnorr (BIP-340) |
| Curve | secp256k1 |
| Signature size | 64 bytes (r \|\| s) |
| Signature encoding | Hex string (128 characters) |
| Library compatibility | nostr-tools, @noble/curves |

### Signature computation

```
message = BASE64URL(header) + "." + BASE64URL(payload)
signature = Schnorr_Sign(secretKey, SHA256(message))
```

## Hashing: SHA-256

SHA-256 is used for token hashes and HTLC commitments.

| Property | Value |
|----------|-------|
| Algorithm | SHA-256 (FIPS 180-4) |
| Output size | 32 bytes (256 bits) |
| Output encoding | Hex string (64 characters) |

Token hashes are computed as SHA-256 of the canonical payload JSON.

## Encryption: NIP-44

All NWPC messages are encrypted using NIP-44.

| Property | Value |
|----------|-------|
| Cipher | XChaCha20-Poly1305 |
| Key derivation | HKDF (HMAC-based Key Derivation Function) |
| Authentication | AEAD (Authenticated Encryption with Associated Data) |
| Shared secret | ECDH over secp256k1 |

## Sealed sender: NIP-59

All protocol messages use NIP-59 gift wrap for sender anonymity:

1. Encrypt the message content with NIP-44
2. Create a "seal" event signed by the true sender
3. Wrap the seal in a "gift wrap" event signed by an ephemeral key
4. Only the recipient can decrypt to discover the true sender

This means relay operators can see that events are being delivered but cannot determine who sent them or what they contain.

## Key formats

### Public keys

- Format: 32-byte x-coordinate (Nostr/BIP-340 format)
- Encoding: hex string (64 characters)
- Example: `7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e`

### Secret keys

- Format: 32-byte scalar
- Encoding: hex string (64 characters)
- Storage: MUST be encrypted at rest in production

### Signatures

- Format: 64-byte Schnorr signature (r || s)
- Encoding: hex string (128 characters)

## Key derivation: BIP-32 / BIP-39

For deterministic key management:

| Standard | Purpose |
|----------|---------|
| BIP-39 | Mnemonic phrase (12-24 words) → seed |
| BIP-32 | Seed → hierarchical key tree |
| secp256k1 | Curve for all derived keys |

Derivation path: `m/44'/1237'/account'/change/index`

## Nostr event kinds

| Kind | Name | TAT Protocol usage |
|------|------|--------------------|
| 1059 | Gift Wrap | All NWPC messages (encrypted outer envelope) |
| 1060 | Gift Wrapped Seal | Inner sealed message |

## References

- [BIP-340: Schnorr Signatures](https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki)
- [NIP-44: Encrypted Payloads](https://github.com/nostr-protocol/nips/blob/master/44.md)
- [NIP-59: Gift Wrap](https://github.com/nostr-protocol/nips/blob/master/59.md)
- [BIP-32: HD Keys](https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki)
- [BIP-39: Mnemonic](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki)
- [RFC 7519: JWT](https://tools.ietf.org/html/rfc7519)
