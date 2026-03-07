# HD Keys

> `@tat-protocol/hdkeys` — BIP32/BIP39 hierarchical deterministic key derivation.

## Installation

```bash
npm install @tat-protocol/hdkeys
```

Or use `@tat-protocol/tdk` which includes this package.

## Overview

HD (Hierarchical Deterministic) keys let you derive an unlimited number of keypairs from a single mnemonic phrase. This is how Pockets generate single-use receive addresses — each address is derived from the master key using a different path.

## Why use HD keys?

- **Backup** — one mnemonic recovers all keys
- **Privacy** — each receive address is a different key, making tokens unlinkable
- **Deterministic** — same mnemonic always produces the same keys

## API Reference

### Generate a mnemonic

```ts
import { HDKey } from "@tat-protocol/hdkeys";

const mnemonic = HDKey.generateMnemonic(256); // 24 words
// or
const mnemonic12 = HDKey.generateMnemonic(128); // 12 words
```

### Create master key from mnemonic

```ts
const seed = await HDKey.mnemonicToSeed(mnemonic);
const master = HDKey.fromMasterSeed(seed);
```

### Derive child keys

```ts
// BIP-32 derivation path
const child = master.derive("m/44'/1237'/0'/0/0");

// Access the keypair
const secretKey = child.privateKey;  // Uint8Array
const publicKey = child.publicKey;   // Uint8Array
```

### Key properties

```ts
master.privateKey         // Uint8Array - 32-byte secret key
master.publicKey          // Uint8Array - 33-byte compressed public key
master.privateExtendedKey // string - extended private key (for serialization)
```

## Derivation paths

TAT Protocol uses BIP-44 style paths:

```
m / purpose' / coin_type' / account' / change / index
m / 44'      / 1237'      / 0'       / 0      / 0
```

- `1237` is the Nostr coin type (from SLIP-44)
- Pocket increments the `index` for each new receive address

## Related

- [Pocket](/sdk/pocket) — uses HD keys for single-use addresses
- [Key Management](/deployment/key-management) — mnemonic backup best practices
- [Core Concepts](/learn/concepts) — single-use keys and privacy
