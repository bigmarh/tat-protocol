# @tat-protocol/config

Configuration module for TAT Protocol - Default settings and configuration options.

## Overview

The Config module provides default configuration values for TAT Protocol packages, including default relay URLs and other protocol-wide settings.

## Installation

```bash
npm install @tat-protocol/config
```

## Usage

```typescript
import { defaultConfig } from '@tat-protocol/config';

console.log(defaultConfig.relays);
// []
```

## Configuration

### Default Config

The `defaultConfig` object includes:

- `relays`: Array of default Nostr relay URLs (currently empty by default)

## Customization

You can override the default config in your application:

```typescript
import { defaultConfig } from '@tat-protocol/config';

const myConfig = {
  ...defaultConfig,
  relays: [
    'wss://relay.damus.io',
    'wss://relay.nostr.band',
    'wss://relay.snort.social'
  ]
};
```

Or provide custom configuration directly to TAT Protocol packages:

```typescript
import { Pocket } from '@tat-protocol/pocket';

const pocket = await Pocket.create({
  relays: ['wss://your-relay.com'],
  // ... other config
});
```

## License

MIT License. See [LICENSE](../../LICENSE) for details.
