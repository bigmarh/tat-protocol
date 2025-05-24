# @tat-protocol/token

The **Token** package provides token logic and utilities for the TAT Protocol. It enables creation, parsing, and validation of both fungible and non-fungible (TAT) tokens, and is used throughout the SDK.

## Features

- Create and parse fungible and non-fungible tokens
- Validate token structure and signatures
- Integrates with Pocket, Forge, and NWPC
- Utility functions for token management

## Installation

```bash
pnpm add @tat-protocol/token
# or
npm install @tat-protocol/token
# or
yarn add @tat-protocol/token
```

## Usage Example

```typescript
import { Token } from '@tat-protocol/token';

// Create a new token instance
const token = new Token();

// Parse a JWT token string
await token.fromJWT('tokenJWTstring');

// Access token payload
const payload = token.getPayload();
```

## Development

This package is part of the [TAT Protocol SDK](../README.md) monorepo. To contribute or run tests, see the main SDK instructions.

## License

MIT License. See [LICENSE](../LICENSE) for details. 