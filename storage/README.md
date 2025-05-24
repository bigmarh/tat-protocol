# @tat-protocol/storage

The **Storage** package provides persistent storage solutions for the TAT Protocol. It enables secure, reliable storage of protocol state, tokens, and other data, supporting both browser and Node.js environments.

## Features

- Persistent storage for protocol state and tokens
- Supports browser and Node.js environments
- Integrates with Pocket and Forge
- Pluggable storage backends

## Installation

```bash
pnpm add @tat-protocol/storage
# or
npm install @tat-protocol/storage
# or
yarn add @tat-protocol/storage
```

## Usage Example

```typescript
import { Storage } from '@tat-protocol/storage';

// Initialize storage
const storage = new Storage();

// Store an item
await storage.setItem('key', 'value');

// Retrieve an item
const value = await storage.getItem('key');
```

## Development

This package is part of the [TAT Protocol SDK](../README.md) monorepo. To contribute or run tests, see the main SDK instructions.

## License

MIT License. See [LICENSE](../LICENSE) for details. 