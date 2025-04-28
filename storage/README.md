# @tat-protocol/storage

The Storage module provides a persistent data storage layer for the TAT Protocol, handling data persistence and retrieval operations.

## Features

- Persistent data storage
- Data encryption and security
- Efficient data retrieval
- Transaction support
- Data versioning

## Installation

```bash
npm install @tat-protocol/storage
# or
yarn add @tat-protocol/storage
# or
pnpm add @tat-protocol/storage
```

## Usage

```typescript
import { Storage } from '@tat-protocol/storage';

// Initialize the storage
const storage = new Storage({
  // storage configuration
});

// Store data
await storage.set('key', {
  // data to store
});

// Retrieve data
const data = await storage.get('key');

// Delete data
await storage.delete('key');

// Transaction support
await storage.transaction(async (tx) => {
  await tx.set('key1', 'value1');
  await tx.set('key2', 'value2');
});
```

## API Reference

### Storage Class

#### Methods

- `set(key: string, value: any): Promise<void>`
- `get(key: string): Promise<any>`
- `delete(key: string): Promise<void>`
- `transaction(callback: (tx: Transaction) => Promise<void>): Promise<void>`
- `clear(): Promise<void>`

### Transaction Class

#### Methods

- `set(key: string, value: any): Promise<void>`
- `get(key: string): Promise<any>`
- `delete(key: string): Promise<void>`

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