# TAT Protocol SDK

TypeScript SDK and reference implementation for issuing, transferring, validating, and redeeming TAT protocol tokens over Nostr.

## What You Can Build

- Forges that mint fungible and non-fungible tokens.
- Wallet/pocket clients that hold tokens and build transfer transactions.
- NWPC services and clients for encrypted RPC over Nostr relays.
- Gate services for access verification.
- Booth services for commerce and checkout flows.

## Installation

### Unified SDK (recommended for app teams)

```bash
npm install @tat-protocol/tdk
```

### Package-by-package (recommended for infra teams)

```bash
npm install \
  @tat-protocol/forge \
  @tat-protocol/pocket \
  @tat-protocol/token \
  @tat-protocol/nwpc \
  @tat-protocol/storage
```

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
  totalSupply: 1_000_000,
});

console.log("Pocket pubkey:", pocket.getPublicKey());
console.log("Forge pubkey:", forge.getPublicKey());
```

## Package Map

- `@tat-protocol/tdk`: Unified SDK surface, factory helpers.
- `@tat-protocol/forge`: Fungible and non-fungible forges.
- `@tat-protocol/pocket`: Wallet/client state and transfer flows.
- `@tat-protocol/token`: Token model, parsing, and validation.
- `@tat-protocol/nwpc`: Encrypted request/response over Nostr.
- `@tat-protocol/storage`: Node/browser storage backends.
- `@tat-protocol/gate`: Access verification services.
- `@tat-protocol/booth`: Commerce/invoice/payment services.
- `@tat-protocol/signers`: KeySigner + NIP-07 signer adapters.
- `@tat-protocol/types`: Shared Signer and event types.
- `@tat-protocol/hdkeys`: HD key derivation helpers.
- `@tat-protocol/utils`: Crypto and protocol utilities.
- `@tat-protocol/config`: Default relay/protocol config.

## Documentation

- Getting started: `GETTING_STARTED.md`
- Protocol spec: `PROTOCOL_SPEC.md`
- Adoption guide: `docs/ADOPTION_GUIDE.md`
- Contributing: `CONTRIBUTING.md`
- Docs index: `docs/README.md`

## Local Development

```bash
pnpm install
pnpm build
pnpm test
```

## Repository Layout

- `packages/`: publishable SDK packages.
- `examples/`: runnable example flows.
- `tests/`: unit/integration/e2e coverage.
- `docs/`: adoption and protocol docs.
- `site/`: static GitHub Pages-ready marketing site.

## License

MIT
