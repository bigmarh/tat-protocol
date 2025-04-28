# @tat-protocol/hdkeys

The HDKeys module provides hierarchical deterministic key management for the TAT Protocol, enabling secure key generation and management.

## Features

- Hierarchical deterministic key generation
- Key derivation paths
- Secure key storage
- Key recovery support
- Multi-account management

## Installation

```bash
npm install @tat-protocol/hdkeys
# or
yarn add @tat-protocol/hdkeys
# or
pnpm add @tat-protocol/hdkeys
```

## Usage

```typescript
import { HDKeys } from '@tat-protocol/hdkeys';

// Initialize the HDKeys manager
const hdkeys = new HDKeys({
  // configuration options
});

// Generate a master key
const masterKey = await hdkeys.generateMasterKey();

// Derive a child key
const childKey = await hdkeys.deriveKey(masterKey, {
  path: "m/44'/0'/0'/0/0"
});

// Export a key
const exportedKey = await hdkeys.exportKey(childKey);

// Import a key
const importedKey = await hdkeys.importKey(exportedKey);
```

## API Reference

### HDKeys Class

#### Methods

- `generateMasterKey(): Promise<HDKey>`
- `deriveKey(parentKey: HDKey, options: DeriveOptions): Promise<HDKey>`
- `exportKey(key: HDKey): Promise<string>`
- `importKey(exportedKey: string): Promise<HDKey>`
- `sign(data: Buffer, key: HDKey): Promise<Buffer>`
- `verify(data: Buffer, signature: Buffer, key: HDKey): Promise<boolean>`

## Dependencies

- `@tat-protocol/types`: Shared type definitions
- `@tat-protocol/utils`: Utility functions

## Development

```bash
# Build the module
npm run build

# Run tests
npm test
```

## Contributing

Please refer to the main [CONTRIBUTING.md](../../CONTRIBUTING.md) for contribution guidelines. 