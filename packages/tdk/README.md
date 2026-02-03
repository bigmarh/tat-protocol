# @tat-protocol/tdk

TAT Protocol Developer Kit - Complete SDK for building on TAT Protocol.

## Overview

The TAT Protocol TDK (Token Development Kit) is a unified SDK that provides all the tools you need to build decentralized token applications. It re-exports all core TAT Protocol packages in a single, convenient import.

## Installation

```bash
npm install @tat-protocol/tdk
```

## What's Included

The TDK includes all TAT Protocol packages:

- **@tat-protocol/forge** - Token minting and issuance
- **@tat-protocol/pocket** - Token wallet and management
- **@tat-protocol/nwpc** - Nostr Wrapped Procedure Calls
- **@tat-protocol/token** - Token creation and validation
- **@tat-protocol/storage** - Pluggable storage backends
- **@tat-protocol/utils** - Utility functions and helpers
- **@tat-protocol/hdkeys** - Hierarchical deterministic key management
- **@tat-protocol/boxoffice** - Booth protocol (TAT sales)
- **@tat-protocol/turnstile** - Gate protocol (access verification)

## Quick Start

### Single Import

```typescript
import {
  Pocket,
  Forge,
  Token,
  NodeStorage,
  DebugLogger
} from '@tat-protocol/tdk';

// Enable debug logging
const Debug = DebugLogger.getInstance();
Debug.enableAll();

// Create a pocket (wallet)
const pocket = await Pocket.create({
  storage: new NodeStorage({ path: './.pocket' }),
  keys: yourKeyPair,
  relays: ['wss://relay.damus.io']
});

// Create a forge (token issuer)
const forge = await Forge.create({
  storage: new NodeStorage({ path: './.forge' }),
  keys: forgeKeyPair,
  relays: ['wss://relay.damus.io']
});
```

### Individual Package Imports

You can also import packages individually:

```bash
npm install @tat-protocol/pocket
npm install @tat-protocol/forge
```

```typescript
import { Pocket } from '@tat-protocol/pocket';
import { Forge } from '@tat-protocol/forge';
```

## Documentation

For detailed documentation on each package, see:

- [Forge Documentation](../forge/README.md)
- [Pocket Documentation](../pocket/README.md)
- [NWPC Documentation](../nwpc/README.md)
- [Token Documentation](../token/README.md)
- [Storage Documentation](../storage/README.md)
- [Utils Documentation](../utils/README.md)
- [HDKeys Documentation](../hdkeys/README.md)

## Architecture

See [TAT_PROTOCOL.md](../../TAT_PROTOCOL.md) for the complete protocol specification.

## Examples

Check the [examples directory](../../examples) for complete working examples:

- Running a Forge
- Creating a Pocket
- Token transfers
- And more

## Requirements

- Node.js >= 16.0.0
- TypeScript 5.x (for development)

## License

MIT License. See [LICENSE](../../LICENSE) for details.

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for contribution guidelines.

## Support

- GitHub Issues: [https://github.com/tat-protocol/tat-protocol/issues](https://github.com/tat-protocol/tat-protocol/issues)
- Documentation: [https://docs.tat-protocol.org](https://docs.tat-protocol.org)
