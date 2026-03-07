# Config

> `@tat-protocol/config` — Protocol version and default relay configuration.

## Installation

```bash
npm install @tat-protocol/config
```

Or use `@tat-protocol/tdk` which includes this package.

## Overview

Provides protocol-wide defaults. Most applications won't need to interact with this directly — the defaults are used automatically by other packages.

## Exports

```ts
import { PROTOCOL_VERSION, defaultConfig } from "@tat-protocol/config";
```

### `PROTOCOL_VERSION`

The current protocol version string (e.g., `"1.0.0"`). Included in all token headers and NWPC messages.

### `defaultConfig`

Default configuration values for relays and protocol settings. Override these when creating components:

```ts
const forge = await createFungibleForgeWithKey({
  // ...
  relays: ["wss://my-relay.example.com"], // Overrides default relays
});
```

## Related

- [NWPC](/sdk/nwpc) — uses protocol version in all messages
- [Token](/sdk/token) — includes version in token headers
