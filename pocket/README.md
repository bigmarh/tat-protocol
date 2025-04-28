# @tat-protocol/pocket

The Pocket module provides integration with the Pocket Network for the TAT Protocol.

## Features

- Pocket Network integration
- Node management
- Network status monitoring
- Transaction handling
- Pocket-specific utilities

## Installation

```bash
npm install @tat-protocol/pocket
# or
yarn add @tat-protocol/pocket
# or
pnpm add @tat-protocol/pocket
```

## Usage

```typescript
import { PocketManager } from '@tat-protocol/pocket';

// Initialize the pocket manager
const pocketManager = new PocketManager({
  // configuration options
});

// Connect to Pocket Network
await pocketManager.connect();

// Get node status
const status = await pocketManager.getNodeStatus();

// Send a transaction
const result = await pocketManager.sendTransaction({
  // transaction data
});

// Monitor network status
pocketManager.onStatusChange((status) => {
  // handle status changes
});
```

## API Reference

### PocketManager Class

#### Methods

- `connect(): Promise<void>`
- `disconnect(): Promise<void>`
- `getNodeStatus(): Promise<NodeStatus>`
- `sendTransaction(data: TransactionData): Promise<TransactionResult>`
- `onStatusChange(callback: (status: NetworkStatus) => void): void`

## Dependencies

- `@tat-protocol/types`: Shared type definitions
- `@tat-protocol/utils`: Utility functions
- `@tat-protocol/nwpc`: Network protocol components

## Development

```bash
# Build the module
npm run build

# Run tests
npm test
```

## Contributing

Please refer to the main [CONTRIBUTING.md](../../CONTRIBUTING.md) for contribution guidelines. 