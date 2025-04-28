# @tat-protocol/token

The Token module provides token-specific functionality and operations for the TAT Protocol.

## Features

- Token operations and management
- Token metadata handling
- Token state management
- Token transfer operations
- Token validation

## Installation

```bash
npm install @tat-protocol/token
# or
yarn add @tat-protocol/token
# or
pnpm add @tat-protocol/token
```

## Usage

```typescript
import { TokenManager } from '@tat-protocol/token';

// Initialize the token manager
const tokenManager = new TokenManager({
  // configuration options
});

// Create a new token
const token = await tokenManager.create({
  // token configuration
});

// Transfer a token
await tokenManager.transfer(token.id, {
  to: 'recipient-address',
  amount: 100
});

// Get token balance
const balance = await tokenManager.getBalance(token.id);

// Update token metadata
await tokenManager.updateMetadata(token.id, {
  // new metadata
});
```

## API Reference

### TokenManager Class

#### Methods

- `create(config: TokenConfig): Promise<Token>`
- `transfer(tokenId: string, transferConfig: TransferConfig): Promise<void>`
- `getBalance(tokenId: string): Promise<number>`
- `updateMetadata(tokenId: string, metadata: TokenMetadata): Promise<void>`
- `validate(tokenId: string): Promise<boolean>`

## Dependencies

- `@tat-protocol/types`: Shared type definitions
- `@tat-protocol/utils`: Utility functions
- `@tat-protocol/storage`: Data persistence
- `@tat-protocol/hdkeys`: Key management

## Development

```bash
# Build the module
npm run build

# Run tests
npm test
```

## Contributing

Please refer to the main [CONTRIBUTING.md](../../CONTRIBUTING.md) for contribution guidelines. 