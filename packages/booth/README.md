# @tat-protocol/booth

Booth services for catalog, invoicing, and payment orchestration.

## Install

```bash
npm install @tat-protocol/booth
```

## Exports

- `BoothServerSpec` (spec-oriented NWPC booth server)
- `BoothAgent` (advanced/extended implementation)
- `BoothBase`, `BoothServer`, `Booth`, `TATPaymentProvider`
- Types from `types.ts` and `spec-types.ts`

## Quick Start (Spec Server)

```ts
import { BoothServerSpec } from "@tat-protocol/booth";
import { NodeStore } from "@tat-protocol/storage";
import { KeySigner } from "@tat-protocol/signers";

const booth = await BoothServerSpec.create({
  signer: new KeySigner(process.env.BOOTH_SECRET_KEY!),
  storage: new NodeStore(".booth"),
  relays: ["wss://relay.damus.io"],
  boxOfficeName: "TAT Booth",
  fee: 0.025,
  supportedPaymentMethods: ["tat"],
});

await booth.addCatalogItem({
  id: "premium-pass",
  issuer: process.env.FORGE_PUBKEY!,
  name: "Premium Pass",
  description: "Access tier",
  price: { amount: 100, currency: "USD" },
  tokenType: "FUNGIBLE",
});
```

## Protocol Flow

1. Client requests `booth.catalog`.
2. Client requests `booth.invoice`.
3. Client submits payment via `booth.pay`.
4. Client checks settlement with `booth.status`.

## Current Payment Support

- `tat`: implemented.
- `lightning` / `card`: scaffolded for extension.
