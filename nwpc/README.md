# @tat-protocol/nwpc

The Network Protocol Components (NWPC) module provides a Nostr-based RPC (Remote Procedure Call) system for the TAT Protocol, enabling secure communication between nodes.

## Features

- Nostr-based RPC system
- Secure message wrapping and unwrapping
- Middleware support
- Request/response handling
- Message hooks for custom processing

## Installation

```bash
npm install @tat-protocol/nwpc
# or
yarn add @tat-protocol/nwpc
# or
pnpm add @tat-protocol/nwpc
```

## Usage

### Server Setup

```typescript
import { NWPCServer } from '@tat-protocol/nwpc';

// Initialize the server
const server = new NWPCServer({
  keys: {
    publicKey: 'your-public-key',
    privateKey: 'your-private-key'
  },
  hooks: {
    beforeRequest: async (request, context) => {
      // Custom pre-request processing
      return true;
    },
    afterRequest: async (request, context) => {
      // Custom post-request processing
    }
  }
});

// Register a handler for a method
server.use('methodName', async (request, context, res) => {
  // Process the request
  return await res.send('response data');
});

// Register a handler with middleware
server.use('protectedMethod', [
  async (request, context, next) => {
    // Authentication middleware
    if (!isAuthenticated(context.sender)) {
      throw new Error('Unauthorized');
    }
    return next();
  }
], async (request, context, res) => {
  // Handle protected method
  return await res.send('protected data');
});
```

### Client Setup

```typescript
import { NWPCPeer } from '@tat-protocol/nwpc';

// Initialize the client
const client = new NWPCPeer({
  keys: {
    publicKey: 'your-public-key',
    privateKey: 'your-private-key'
  },
  hooks: {
    beforeRequest: async (request, context) => {
      // Custom pre-request processing
      return true;
    },
    afterResponse: async (response, context) => {
      // Custom post-response processing
    }
  }
});

// Make a request to a server
try {
  const response = await client.request(
    'methodName',
    ['param1', 'param2'],
    'server-public-key',
    30000 // timeout in milliseconds
  );
  console.log('Response:', response);
} catch (error) {
  console.error('Error:', error);
}
```

## API Reference

### NWPCServer Class

#### Methods

- `use(method: string, handler: NWPCHandler): void`
- `use(method: string, middleware: NWPCMiddleware[], handler: NWPCHandler): void`
- `sendResponse(response: NWPCResponse, recipientPubkey: string): Promise<void>`
- `broadcastResponse(response: NWPCResponse, recipientPubkeys: string[]): Promise<void>`

### NWPCPeer Class

#### Methods

- `request(method: string, params: any[], recipientPubkey: string, timeout?: number): Promise<NWPCResponse>`
- `sendResponse(response: NWPCResponse, recipientPubkey: string): Promise<void>`
- `broadcastResponse(response: NWPCResponse, recipientPubkeys: string[]): Promise<void>`

## Dependencies

- `@nostr-dev-kit/ndk`: Nostr development kit
- `@tat-protocol/storage`: Storage interface
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