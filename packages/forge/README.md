# @tat-protocol/forge

Token issuer implementations for fungible and non-fungible assets.

## Install

```bash
npm install @tat-protocol/forge
```

## Exports

- `FungibleForge`
- `NonFungibleForge`
- `TATForge` (alias of `NonFungibleForge`)
- `ForgeBase`
- Types: `ForgeConfig`, `ForgeState`

## Quick Start

```ts
import { FungibleForge } from "@tat-protocol/forge";
import { NodeStore } from "@tat-protocol/storage";
import { KeySigner } from "@tat-protocol/signers";

const signer = new KeySigner(process.env.FORGE_SECRET_KEY!);

const forge = new FungibleForge({
  owner: process.env.FORGE_OWNER_PUBKEY!,
  signer,
  storage: new NodeStore(".forge"),
  relays: ["wss://relay.damus.io"],
  totalSupply: 1_000_000,
});

await forge.initialize();
console.log("Forge ready:", forge.getPublicKey());
```

## NWPC Methods Provided by Forge

- `forge`: mint new output tokens.
- `transfer`: consume inputs and produce outputs.
- `burn`: permanently destroy token value.
- `verify`: check spent status for token hashes.

## Operational Notes

- Prefer signer-based configuration in production.
- Persist forge state in dedicated storage.
- Enforce access controls via `owner` and `authorizedForgers`.
