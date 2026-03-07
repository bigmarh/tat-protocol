# TDK (Unified SDK)

> `@tat-protocol/tdk` — Single-import access to every TAT Protocol package with factory helpers.

## Installation

```bash
npm install @tat-protocol/tdk
```

## Overview

The TDK (TAT Developer Kit) re-exports all protocol packages so you can import everything from one place. It also provides factory functions that handle signer setup and initialization.

```ts
import {
  createPocketWithKey,
  createFungibleForgeWithKey,
  NodeStore,
  Token,
  // ...anything from any package
} from "@tat-protocol/tdk";
```

## Factory functions

These are the recommended way to create Forge and Pocket instances. They handle signer creation and initialization automatically.

### createPocketWithKey

Create a Pocket with a direct secret key. Recommended for server-side use.

```ts
async function createPocketWithKey(options: {
  secretKey: string;
  storage: StorageInterface;
  relays?: string[];
}): Promise<Pocket>
```

```ts
const pocket = await createPocketWithKey({
  secretKey: process.env.POCKET_SK!,
  storage: new NodeStore(".pocket"),
  relays: ["wss://relay.damus.io"],
});
```

### createPocketWithNIP07

Create a Pocket with a browser extension signer. Recommended for browser environments.

```ts
async function createPocketWithNIP07(options: {
  storage: StorageInterface;
  relays?: string[];
  timeoutMs?: number; // default: 3000
}): Promise<Pocket>
```

```ts
import { createPocketWithNIP07, BrowserStore } from "@tat-protocol/tdk";

const pocket = await createPocketWithNIP07({
  storage: new BrowserStore(),
  relays: ["wss://relay.damus.io"],
});
```

Throws if no NIP-07 extension (NostrPass, Alby, nos2x) is detected.

### createFungibleForgeWithKey

Create a fungible token Forge. Recommended for server-side use.

```ts
async function createFungibleForgeWithKey(options: {
  secretKey: string;
  owner: string;
  storage: StorageInterface;
  relays?: string[];
  totalSupply?: number;
}): Promise<FungibleForge>
```

```ts
const forge = await createFungibleForgeWithKey({
  secretKey: process.env.FORGE_SK!,
  owner: process.env.FORGE_OWNER_PK!,
  storage: new NodeStore(".forge"),
  relays: ["wss://relay.damus.io"],
  totalSupply: 1_000_000,
});
```

### createFungibleForgeWithNIP07

Create a fungible Forge with a browser extension signer. Primarily useful for testing or demos.

```ts
async function createFungibleForgeWithNIP07(options: {
  owner: string;
  storage: StorageInterface;
  relays?: string[];
  totalSupply?: number;
  timeoutMs?: number;
}): Promise<FungibleForge>
```

### createTATForgeWithKey

Create a TAT (non-fungible) Forge for unique tokens like tickets and memberships.

```ts
async function createTATForgeWithKey(options: {
  secretKey: string;
  owner: string;
  storage: StorageInterface;
  relays?: string[];
}): Promise<TATForge>
```

```ts
const tatForge = await createTATForgeWithKey({
  secretKey: process.env.FORGE_SK!,
  owner: process.env.FORGE_OWNER_PK!,
  storage: new NodeStore(".tat-forge"),
  relays: ["wss://relay.damus.io"],
});
```

### detectSigner

Auto-detect the best signer for the current environment.

```ts
async function detectSigner(secretKey?: string): Promise<Signer>
```

- In browser with NIP-07 extension available: returns `NIP07Signer`
- Otherwise: returns `KeySigner` using the provided secret key
- Throws if no extension and no key provided

```ts
const signer = await detectSigner(process.env.SECRET_KEY);
const pocket = await Pocket.create({ signer, storage, relays });
```

## Re-exported packages

The TDK re-exports everything from:

| Package | Key exports |
|---------|-------------|
| `@tat-protocol/forge` | `FungibleForge`, `TATForge`, `ForgeBase` |
| `@tat-protocol/pocket` | `Pocket` |
| `@tat-protocol/token` | `Token`, `TokenType` |
| `@tat-protocol/nwpc` | `NWPCServer`, `NWPCPeer`, `NWPCRouter` |
| `@tat-protocol/gate` | `Gate`, `GateBase`, `GateServerSpec` |
| `@tat-protocol/booth` | `Booth`, `BoothBase`, `BoothServer` |
| `@tat-protocol/storage` | `NodeStore`, `BrowserStore`, `Storage` |
| `@tat-protocol/signers` | `KeySigner`, `NIP07Signer`, `isNIP07Available` |
| `@tat-protocol/hdkeys` | `HDKey` |
| `@tat-protocol/utils` | `DebugLogger`, `CryptoHelpers`, `BloomFilter` |
| `@tat-protocol/types` | `Signer`, `NostrEvent`, `UnsignedNostrEvent` |

## Related

- [Package Overview](/sdk/packages) — choosing the right packages
- [Quickstart](/guides/quickstart) — get running in 5 minutes
