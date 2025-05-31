# @tat-protocol/hdkeys

The **HDKeys** package provides hierarchical deterministic (HD) key management for the TAT Protocol. It enables secure generation, derivation, and management of cryptographic keys for use across the protocol.

## Features

- Generate and manage HD key pairs
- Derive child keys for different protocol uses
- Integrates with Pocket and Forge
- Secure, standards-based cryptography

## Installation

```bash
pnpm add @tat-protocol/hdkeys
# or
npm install @tat-protocol/hdkeys
# or
yarn add @tat-protocol/hdkeys
```

## Usage Example

```typescript
import { HDKey } from '@tat-protocol/hdkeys';

// Generate a new mnemonic
const mnemonic = HDKey.generateMnemonic();

// Derive a master key from the mnemonic
const seed = await HDKey.mnemonicToSeed(mnemonic);
const masterKey = HDKey.fromMasterSeed(seed);

// Derive a child key
const childKey = masterKey.derive("m/44'/0'/0'/0/0");
```

## Development

This package is part of the [TAT Protocol SDK](../README.md) monorepo. To contribute or run tests, see the main SDK instructions.

## License

MIT License. See [LICENSE](../LICENSE) for details. 