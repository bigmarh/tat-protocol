# @tat-protocol/nwpc

The **NWPC** package provides the network protocol and peer communication layer for the TAT Protocol. It enables decentralized, secure messaging and transaction relay between protocol participants.

## Features

- Peer-to-peer network communication
- Secure message relay and event handling
- Integrates with Pocket and Forge
- Extensible protocol for custom use cases

## Installation

```bash
pnpm add @tat-protocol/nwpc
# or
npm install @tat-protocol/nwpc
# or
yarn add @tat-protocol/nwpc
```

## Usage Example

```typescript
import { NWPCPeer } from '@tat-protocol/nwpc';

// Initialize a network peer
const peer = new NWPCPeer({
  relays: ['wss://relay.example.com'],
});

// Subscribe to events
await peer.subscribe('somePublicKey', (event) => {
  console.log('Received event:', event);
});

// Send a request
const response = await peer.request('method', { data: 'payload' }, 'recipientPubKey');
```

## Development

This package is part of the [TAT Protocol SDK](../README.md) monorepo. To contribute or run tests, see the main SDK instructions.

## License

MIT License. See [LICENSE](../LICENSE) for details. 