# @tat-protocol/forge

The Forge module is the core component of the TAT Protocol SDK responsible for token creation, management, and lifecycle operations.

## Features

- Token creation and initialization
- Token verification and access control
- Authorized forger management
- Token transfer handling
- State management and persistence

## Installation

```bash
npm install @tat-protocol/forge
# or
yarn add @tat-protocol/forge
# or
pnpm add @tat-protocol/forge
```

## Usage

```typescript
import { Forge } from '@tat-protocol/forge';
import { KeyPair } from '@tat-protocol/types';

// Initialize the forge with configuration
const forge = new Forge({
  owner: 'owner-public-key',
  keys: {
    publicKey: 'your-public-key',
    privateKey: 'your-private-key'
  },
  authorizedForgers: ['authorized-forger-public-key']
});

// Initialize the forge
await forge.initialize();

// Get the forge's public key
const publicKey = forge.getPublicKey();

// Sign data
const signature = await forge.sign(data);

// Verify a token
const isValid = await forge.verifyToken(
  tokenHash,
  signature,
  publicKey,
  readerPubkey,
  timeWindow
);

// Manage authorized forgers
await forge.addAuthorizedForger('new-forger-public-key');
await forge.removeAuthorizedForger('forger-public-key');
const authorizedForgers = forge.getAuthorizedForgers();

// Verify access to a token
const hasAccess = await forge.verifyAccess(
  tokenJWT,
  requiredAccess,
  ownerPubkey
);
```

## API Reference

### Forge Class

#### Constructor
```typescript
constructor(config: ForgeConfig)
```

#### Methods

- `initialize(forgeId?: number): Promise<void>`
- `getPublicKey(): string | undefined`
- `sign(data: Uint8Array): Promise<Uint8Array>`
- `verifyToken(tokenHash: string, signature: string, publicKey: string, readerPubkey?: string, timeWindow?: number, currentTime?: number): Promise<boolean>`
- `addAuthorizedForger(pubkey: string): Promise<void>`
- `removeAuthorizedForger(pubkey: string): Promise<void>`
- `getAuthorizedForgers(): string[]`
- `verifyAccess(tokenJWT: string, requiredAccess: { [key: string]: any }, ownerPubkey?: string): Promise<boolean>`

## Dependencies

- `@tat-protocol/types`: Shared type definitions
- `@tat-protocol/utils`: Utility functions
- `@tat-protocol/storage`: Data persistence
- `@tat-protocol/nwpc`: Network protocol components
- `@nostr-dev-kit/ndk`: Nostr development kit
- `nostr-tools`: Nostr tools library

## Development

```bash
# Build the module
npm run build

# Run tests
npm test
```

## Contributing

Please refer to the main [CONTRIBUTING.md](../../CONTRIBUTING.md) for contribution guidelines. 