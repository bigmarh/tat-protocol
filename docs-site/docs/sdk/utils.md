# Utils

> `@tat-protocol/utils` — Crypto helpers, Nostr encryption, logging, and Bloom filter.

## Installation

```bash
npm install @tat-protocol/utils
```

Or use `@tat-protocol/tdk` which includes this package.

## Overview

Utility functions used internally by the protocol packages. You may use these directly for low-level operations.

## Crypto helpers

```ts
import { CryptoHelpers } from "@tat-protocol/utils";

// SHA-256 hash
const hash = CryptoHelpers.createHash(data);

// Schnorr sign
const signature = await CryptoHelpers.signMessage(data, keys);

// Schnorr verify
const valid = await CryptoHelpers.verifySignature(data, signature, pubkey);
```

## Nostr encryption (Wrap/Unwrap)

Encrypt and decrypt messages using NIP-44 + NIP-59 gift wrap:

```ts
import { Wrap, Unwrap, WrapWithSigner, UnwrapWithSigner } from "@tat-protocol/utils";

// Encrypt with direct keys
await Wrap(ndk, content, keys, recipientPubkey);

// Encrypt with signer abstraction
await WrapWithSigner(ndk, content, signer, recipientPubkey);

// Decrypt with direct keys
const plaintext = await Unwrap(content, keys, senderPubkey);

// Decrypt with signer
const plaintext2 = await UnwrapWithSigner(content, signer, senderPubkey);
```

## DebugLogger

Structured logging with module-level enable/disable:

```ts
import { DebugLogger } from "@tat-protocol/utils";

const debug = DebugLogger.getInstance();
debug.enableAll();          // Enable all modules
debug.enable("NWPC");       // Enable specific module
debug.disable("Storage");   // Disable specific module
```

## BloomFilter

Memory-efficient probabilistic data structure for event deduplication:

```ts
import { BloomFilter } from "@tat-protocol/utils";

const filter = new BloomFilter();
filter.add("event-id-123");
filter.has("event-id-123"); // true (probably)
filter.has("event-id-456"); // false (definitely)
```

Used internally by NWPC for replay protection (hybrid LRU + Bloom filter).

## Related

- [NWPC](/sdk/nwpc) — uses Wrap/Unwrap for all messaging
- [Token](/sdk/token) — uses CryptoHelpers for signing
