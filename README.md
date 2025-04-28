# TAT Protocol SDK

A comprehensive TypeScript SDK for the TAT Protocol, providing tools and utilities for token management and transactions.

## Installation

```bash
npm install @tat-protocol/core
# or
yarn add @tat-protocol/core
# or
pnpm add @tat-protocol/core
```

## Modules

The SDK is split into several modular packages:

- `@tat-protocol/forge`: Core token forging functionality
- `@tat-protocol/nwpc`: Network protocol components
- `@tat-protocol/storage`: Data persistence layer
- `@tat-protocol/hdkeys`: Hierarchical deterministic key management
- `@tat-protocol/types`: Shared TypeScript type definitions
- `@tat-protocol/utils`: Common utility functions
- `@tat-protocol/token`: Token-specific functionality
- `@tat-protocol/pocket`: Pocket network integration

## Usage

```typescript
import { 
  // Import specific modules as needed
  Forge,
  NWPC,
  Storage,
  HDKeys,
  // ... other imports
} from '@tat-protocol/core';

// Example usage
const forge = new Forge();
const nwpc = new NWPC();
// ... implementation
```

## Development

This is a monorepo managed with pnpm workspaces. To get started:

1. Install dependencies:
```bash
pnpm install
```

2. Build all packages:
```bash
pnpm build
```

3. Run tests:
```bash
pnpm test
```

## Module Documentation

### Forge
The Forge module handles token creation and management. [Read more](./forge/README.md)

### NWPC
Network Protocol Components for handling network communications. [Read more](./nwpc/README.md)

### Storage
Persistent storage layer for the protocol. [Read more](./storage/README.md)

### HDKeys
Hierarchical deterministic key management system. [Read more](./hdkeys/README.md)

### Types
Shared TypeScript type definitions. [Read more](./types/README.md)

### Utils
Common utility functions. [Read more](./utils/README.md)

### Token
Token-specific functionality. [Read more](./token/README.md)

### Pocket
Pocket network integration. [Read more](./pocket/README.md)

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details. 