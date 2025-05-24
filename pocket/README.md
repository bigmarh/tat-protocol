# @tat-protocol/pocket

The **Pocket** package is the client for managing tokens, balances, and transactions in the TAT Protocol. It provides a secure, extensible interface for interacting with the protocol, including sending and receiving both fungible and non-fungible (TAT) tokens.

## Features

- Manage balances and tokens
- Send and receive fungible and non-fungible (TAT) tokens
- Query transaction history and state
- Integrate with Forge and NWPC for full protocol support

## Installation

```bash
pnpm add @tat-protocol/pocket
# or
npm install @tat-protocol/pocket
# or
yarn add @tat-protocol/pocket
```

## Usage Example

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

## Development

This package is part of the [TAT Protocol SDK](../README.md) monorepo. To contribute or run tests, see the main SDK instructions.

## License

MIT License. See [LICENSE](../LICENSE) for details. 