# @tat-protocol/types

The Types module provides shared TypeScript type definitions and interfaces for the TAT Protocol SDK.

## Features

- Centralized type definitions
- Consistent type usage across modules
- Type safety and validation
- Documentation through types
- Shared interfaces and enums

## Installation

```bash
npm install @tat-protocol/types
# or
yarn add @tat-protocol/types
# or
pnpm add @tat-protocol/types
```

## Usage

```typescript
import { 
  Token,
  ProtocolMessage,
  HDKey,
  StorageConfig,
  // ... other types
} from '@tat-protocol/types';

// Use types in your code
const token: Token = {
  id: 'token-id',
  // ... token properties
};

const message: ProtocolMessage = {
  type: 'TOKEN_CREATE',
  payload: {
    // ... message payload
  }
};
```

## Type Definitions

### Core Types

- `Token`: Token data structure
- `ProtocolMessage`: Network protocol message format
- `HDKey`: Hierarchical deterministic key structure
- `StorageConfig`: Storage configuration options

### Utility Types

- `KeyPair`: Public/private key pair
- `Transaction`: Database transaction
- `ConnectionStatus`: Network connection status
- `TokenConfig`: Token creation configuration

## Development

```bash
# Build the module
npm run build

# Run type checks
npm run type-check
```

## Contributing

Please refer to the main [CONTRIBUTING.md](../../CONTRIBUTING.md) for contribution guidelines.

### Adding New Types

1. Create a new file in the appropriate directory
2. Define your types and interfaces
3. Export them from the main index.ts
4. Update the documentation
5. Submit a pull request 