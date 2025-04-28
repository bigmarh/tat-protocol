# @tat-protocol/utils

The Utils module provides common utility functions and helpers used across the TAT Protocol SDK.

## Features

- Common utility functions
- Data validation
- Format conversion
- Cryptographic helpers
- Error handling utilities

## Installation

```bash
npm install @tat-protocol/utils
# or
yarn add @tat-protocol/utils
# or
pnpm add @tat-protocol/utils
```

## Usage

```typescript
import { 
  validateToken,
  formatAddress,
  encryptData,
  decryptData,
  // ... other utilities
} from '@tat-protocol/utils';

// Validate token data
const isValid = validateToken(tokenData);

// Format an address
const formattedAddress = formatAddress(rawAddress);

// Encrypt sensitive data
const encrypted = await encryptData(data, key);

// Decrypt data
const decrypted = await decryptData(encrypted, key);
```

## API Reference

### Validation Functions

- `validateToken(data: any): boolean`
- `validateAddress(address: string): boolean`
- `validateKey(key: string): boolean`

### Format Functions

- `formatAddress(address: string): string`
- `formatKey(key: string): string`
- `formatTokenId(id: string): string`

### Cryptographic Functions

- `encryptData(data: any, key: string): Promise<string>`
- `decryptData(encrypted: string, key: string): Promise<any>`
- `hashData(data: any): string`

### Error Handling

- `createError(message: string, code: number): Error`
- `isProtocolError(error: any): boolean`
- `handleError(error: any): void`

## Dependencies

- `@tat-protocol/types`: Shared type definitions

## Development

```bash
# Build the module
npm run build

# Run tests
npm test
```

## Contributing

Please refer to the main [CONTRIBUTING.md](../../CONTRIBUTING.md) for contribution guidelines. 