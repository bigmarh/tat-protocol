# @tat-protocol/tdk

Unified developer kit that re-exports all major protocol packages and includes factory helpers.

## Install

```bash
npm install @tat-protocol/tdk
```

## Includes

- Core: forge, pocket, token, nwpc, storage, utils, hdkeys, types, signers
- Services: gate, booth
- Factory helpers from `@tat-protocol/tdk`:
  - `createPocketWithNIP07`
  - `createPocketWithKey`
  - `createFungibleForgeWithNIP07`
  - `createFungibleForgeWithKey`
  - `createTATForgeWithKey`
  - `detectSigner`

## Quick Start

```ts
import {
  NodeStore,
  createPocketWithKey,
  createFungibleForgeWithKey,
} from "@tat-protocol/tdk";

const relays = ["wss://relay.damus.io"];

const pocket = await createPocketWithKey({
  secretKey: process.env.POCKET_SECRET_KEY!,
  storage: new NodeStore(".pocket"),
  relays,
});

const forge = await createFungibleForgeWithKey({
  secretKey: process.env.FORGE_SECRET_KEY!,
  owner: process.env.FORGE_OWNER_PUBKEY!,
  storage: new NodeStore(".forge"),
  relays,
});

console.log(pocket.getPublicKey(), forge.getPublicKey());
```

## When To Use TDK

- Use TDK for fast app integration and single-import ergonomics.
- Use package-level imports when you want tighter dependency boundaries.
