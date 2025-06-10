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

## Usage

### Browser
```ts
import { Storage } from '@tat-protocol/storage';
import { BrowserStore } from '@tat-protocol/storage';

const storage = new Storage(new BrowserStore());
```

### Node.js
```ts
import { Storage } from '@tat-protocol/storage';
import { NodeStore } from '@tat-protocol/storage';

const storage = new Storage(new NodeStore());
```

## API
- `Storage` is a universal class that requires a backend implementing `StorageInterface`.
- Use `BrowserStore` for browser (localStorage), `NodeStore` for Node.js (filesystem).

## Entry Points
- `main` (Node.js): `./node.js`
- `browser`: `./browser.js`

## Migration
- You must now explicitly provide a backend to `Storage`. There is no longer any environment detection or dynamic import.

## Development

This package is part of the [TAT Protocol SDK](../README.md) monorepo. To contribute or run tests, see the main SDK instructions.

## License

MIT License. See [LICENSE](../LICENSE) for details. 