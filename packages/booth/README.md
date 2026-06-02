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
- `BoothWebhookServer` / `createBoothWebhookServer` for optional webhook hosting
- `BoothPaymentAdapter` and `BoothFulfillmentHandler` extension types
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
3. Booth returns payment options from configured adapters.
4. Payment provider confirms payment via webhook or custom backend.
5. App calls `booth.confirmInvoice(invoiceId, payment)`.
6. Booth runs `fulfill(...)`, stores a receipt, and makes status idempotent.

## External Payments and Webhooks

Booth does **not** require an HTTP server. You can use your existing Express/Hono/Fastify app and call `confirmInvoice()` from your webhook handler. For simple SDK usage, use the dependency-free helper:

```ts
import { BoothWebhookServer } from "@tat-protocol/booth";

const webhooks = new BoothWebhookServer({
  port: 8080,
  routes: [
    {
      path: "/webhooks/lightning",
      methods: ["POST"],
      handler: async (req) => {
        const event = await lightningAdapter.parseWebhook!(req);
        if (event.status === "completed" && event.invoiceId) {
          await booth.confirmInvoice(event.invoiceId, {
            method: event.method,
            providerPaymentId: event.providerPaymentId,
            amount: event.amount,
            currency: event.currency,
            details: event.metadata,
          });
        }
        return { body: { ok: true } };
      },
    },
  ],
});

await webhooks.start();
```

## Fulfillment

Pass a `fulfill` callback to mint/deliver real tokens after payment confirmation:

```ts
const booth = await BoothServerSpec.create({
  // ...signer, storage, relays...
  boxOfficeName: "Ticket Booth",
  fee: 0.025,
  paymentAdapters: [lightningAdapter],
  async fulfill({ invoice, buyerPubkey }) {
    const tat = await ticketForge.mintTicket({
      to: buyerPubkey,
      item: invoice.catalogItem,
    });
    return { tat, tokenID: invoice.catalogItem.id };
  },
});
```

## Current Payment Support

- `tat`: implemented in-protocol.
- `lightning` / `card`: supported through `BoothPaymentAdapter` implementations and webhooks.
