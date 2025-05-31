# TAT Protocol SDK

**TAT Protocol SDK** is a modular TypeScript framework for building secure, decentralized applications with tokenized asset management.  
It provides robust support for both fungible and non-fungible (TAT) tokens, advanced Pocket (client) features, and peer-to-peer network communication via the Forge and other protocol modules.

---

## Key Features

- **Pocket**: Manage balances, tokens, and transaction history in a secure, extensible client.
- **Forge**: Create and issue fungible and non-fungible tokens.
- **Token Transfers**: Easily construct and send token and TAT transfers.
- **HD Key Management**: Generate and manage hierarchical deterministic keys.
- **Decentralized Networking**: Communicate and transact with peers using the NWPC protocol.
- **Modular Design**: Use only the packages you need.

---

## Installation

```bash
pnpm add @tat-protocol/core
# or
npm install @tat-protocol/core
# or
yarn add @tat-protocol/core
```

---

## Packages Overview

- **@tat-protocol/pocket** – Pocket client for managing tokens, balances, and transactions
- **@tat-protocol/forge** – Token creation, issuance, and management
- **@tat-protocol/nwpc** – Network protocol and peer communication
- **@tat-protocol/storage** – Persistent storage solutions
- **@tat-protocol/hdkeys** – Hierarchical deterministic key management
- **@tat-protocol/types** – Shared TypeScript types
- **@tat-protocol/utils** – Utility functions
- **@tat-protocol/token** – Token logic and utilities

---

## Example Usage

```typescript
import { Pocket } from '@tat-protocol/pocket';

// Create a Pocket instance (asynchronously)
const pocket = await Pocket.create({
  keys: { secretKey: '...', publicKey: '...' },
  relays: ['wss://relay.example.com'],
});

// Send a fungible token transfer
await pocket.transfer('issuerPubKey', 'recipientPubKey', 100);

// Send a TAT (non-fungible token) transfer
await pocket.sendTAT('issuerPubKey', 'recipientPubKey', 'tokenID');

// Query balances and tokens
const balance = pocket.getBalance('issuerPubKey', '-');
const token = pocket.getToken('issuerPubKey', 'tokenHash');
const tat = pocket.getTAT('issuerPubKey', 'tokenID');
```

---

## Development

This monorepo uses pnpm workspaces for efficient dependency management.

1. **Install dependencies**
    ```bash
    pnpm install
    ```
2. **Build all packages**
    ```bash
    pnpm build
    ```
3. **Run tests**
    ```bash
    pnpm test
    ```

---

## Documentation

Each package contains its own README for detailed documentation:

- [Pocket](./pocket/README.md) – Pocket client usage and API
- [Forge](./forge/README.md) – Token creation and management
- [NWPC](./nwpc/README.md) – Network protocol
- [Storage](./storage/README.md) – Persistence
- [HDKeys](./hdkeys/README.md) – Key management
- [Utils](./utils/README.md) – Utilities
- [Token](./token/README.md) – Token logic

---

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License. See [LICENSE](LICENSE) for details.

## Node.js Usage

If you need direct access to the Node.js storage implementation (`NodeStore`), import it directly:

```js
import { NodeStore } from '@tat-protocol/storage/dist/DiskStorage';
```

This avoids including Node-only code in browser builds. 