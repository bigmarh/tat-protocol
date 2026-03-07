# Types

> `@tat-protocol/types` — Shared `Signer` interface and Nostr event types.

## Installation

```bash
npm install @tat-protocol/types
```

Or use `@tat-protocol/tdk` which includes this package.

## Overview

This package defines the shared interfaces that all TAT Protocol packages depend on. The most important is `Signer` — the abstraction used for key operations across the entire protocol.

## Signer

```ts
interface Signer {
  getPublicKey(): Promise<string>;
  sign(message: Uint8Array): Promise<string>;
  signEvent(event: UnsignedNostrEvent): Promise<NostrEvent>;
  nip44: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}
```

Implemented by `KeySigner` (server) and `NIP07Signer` (browser) in the [Signers](/sdk/signers) package.

## UnsignedNostrEvent

```ts
interface UnsignedNostrEvent {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
}
```

## NostrEvent

```ts
interface NostrEvent extends UnsignedNostrEvent {
  id: string;      // Event hash
  pubkey: string;  // Author public key
  sig: string;     // Schnorr signature
}
```

## Related

- [Signers](/sdk/signers) — implementations of the Signer interface
- [NWPC](/sdk/nwpc) — uses these types for encrypted messaging
