# @tat-protocol/utils

The **Utils** package provides utility functions for the TAT Protocol. It includes helpers for cryptography, encoding, and other common tasks used throughout the SDK.

## Features

- Utility functions for cryptography, encoding, and more
- Used by Pocket, Forge, NWPC, and other modules
- Lightweight and easy to use

## Installation

```bash
pnpm add @tat-protocol/utils
# or
npm install @tat-protocol/utils
# or
yarn add @tat-protocol/utils
```

## Usage Example

```typescript
import { DebugLogger } from '@tat-protocol/utils';

const logger = DebugLogger.getInstance();
logger.log('Hello from TAT Protocol Utils!');
```

## Development

This package is part of the [TAT Protocol SDK](../README.md) monorepo. To contribute or run tests, see the main SDK instructions.

## License

MIT License. See [LICENSE](../LICENSE) for details. 