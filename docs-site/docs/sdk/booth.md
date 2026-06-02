# Booth

> `@tat-protocol/booth` — Commerce runtime for catalogs, invoicing, payments, and receipts.

## Installation

```bash
npm install @tat-protocol/booth
```

Or use `@tat-protocol/tdk` which includes this package.

## Overview

The Booth is a **merchant/operator** component that handles commerce flows. It manages a catalog of items, creates orders, processes payments, and generates receipts. The typical flow is:

```
Catalog → Invoice → Payment → Fulfillment → Receipt
```

## Classes

| Class                | Description                                                       |
| -------------------- | ----------------------------------------------------------------- |
| `BoothBase`          | Abstract base with order, payment, inventory, and analytics logic |
| `BoothServer`        | NWPC-compatible server with network handlers                      |
| `BoothServerSpec`    | Extended spec-compliant server with catalog management            |
| `BoothAgent`         | Lightweight agent for orchestration                               |
| `TATPaymentProvider` | Payment provider that accepts TAT tokens                          |
| `BoothWebhookServer` | Optional dependency-free HTTP/HTTPS webhook helper                |

## Quick start

```ts
const booth = await BoothServer.create({
  storage: new NodeStore(".booth"),
  signer: new KeySigner(secretKey),
  relays: ["wss://relay.damus.io"],
  forgePubkey: forgePk,
  paymentProviders: [
    new TATPaymentProvider({
      forgePubkey: forgePk,
      amount: 10,
      autoRefund: true,
    }),
  ],
});
```

## API Reference

### BoothBase

#### Order management

```ts
async createOrder(orderData): Promise<TokenOrder>
async getOrder(orderId: string): Promise<TokenOrder | undefined>
async updateOrderStatus(orderId: string, status: OrderStatus): Promise<void>
async cancelOrder(orderId: string, reason?: string): Promise<void>
```

#### Payments

```ts
async initializePayment(orderId: string): Promise<{
  payment: Payment;
  paymentUrl?: string;
  paymentAddress?: string;
  expiresAt?: number;
}>

async verifyPayment(paymentId: string): Promise<PaymentVerificationResult>
```

#### Inventory

```ts
async addInventoryItem(item: InventoryItem): Promise<void>
async updateInventory(itemId: string, delta: number): Promise<void>
async getInventoryItem(itemId: string): Promise<InventoryItem | undefined>
async listInventory(activeOnly?: boolean): Promise<InventoryItem[]>
```

#### Receipts & refunds

```ts
async getReceipt(receiptId: string): Promise<Receipt | undefined>
async getReceiptByOrderId(orderId: string): Promise<Receipt | undefined>
async requestRefund(orderId: string, amount: Price, reason: string): Promise<RefundRequest>
async processRefund(refundId: string, approved: boolean): Promise<void>
```

#### Analytics

```ts
async getSalesAnalytics(
  startTime: number,
  endTime: number
): Promise<SalesAnalytics>
```

Returns: total orders, total revenue, orders by status, top items, and time period.

### BoothServerSpec

Adds catalog management and spec-oriented NWPC methods. It also supports external payment adapters plus a fulfillment callback:

```ts
const booth = await BoothServerSpec.create({
  storage,
  signer,
  relays,
  boxOfficeName: "Ticket Booth",
  fee: 0.025,
  paymentAdapters: [lightningAdapter],
  async fulfill({ invoice, buyerPubkey }) {
    const tat = await forge.mintTicket({
      to: buyerPubkey,
      item: invoice.catalogItem,
    });
    return { tat, tokenID: invoice.catalogItem.id };
  },
});
```

```ts
async addCatalogItem(item: CatalogItem): Promise<void>
async removeCatalogItem(itemId: string): Promise<void>
async updateCatalogItem(itemId: string, updates: Partial<CatalogItem>): Promise<void>
async confirmInvoice(invoiceId: string, payment): Promise<{ success: boolean; receipt?: Receipt }>
```

Use `confirmInvoice()` from payment webhooks. It is idempotent: already-fulfilled invoices return the existing receipt instead of minting again.

### Webhooks

Booth does not need to own your HTTP server. You can call `confirmInvoice()` from any framework. For simple deployments, `BoothWebhookServer` provides a tiny Node server:

```ts
const webhooks = new BoothWebhookServer({
  port: 8080,
  routes: [
    {
      path: "/webhooks/lightning",
      methods: ["POST"],
      handler: async (req) => {
        const event = await lightningAdapter.parseWebhook!(req);
        if (event.status === "completed" && event.invoiceId) {
          await booth.confirmInvoice(event.invoiceId, event);
        }
        return { body: { ok: true } };
      },
    },
  ],
});

await webhooks.start();
```

### TATPaymentProvider

Accepts TAT Protocol tokens as payment.

```ts
const provider = new TATPaymentProvider({
  forgePubkey: forgePk, // Which forge's tokens to accept
  amount: 10, // Cost per unit
  autoRefund: true, // Auto-refund on failure
});
```

#### Methods

```ts
async initializePayment(payment: Payment): Promise<PaymentInitResult>
async verifyPayment(paymentId: string): Promise<PaymentVerificationResult>
async processTATPayment(paymentId: string, tokens: string[]): Promise<PaymentVerificationResult>
async validateTokens(tokens: string[]): Promise<{ valid: boolean; reason?: string }>
async refundPayment(paymentId: string, amount: Price, reason: string): Promise<RefundResult>
async getPaymentStatus(paymentId: string): Promise<PaymentStatus>
async cancelPayment(paymentId: string): Promise<boolean>
getReceivedTokens(paymentId: string): string[]
```

## Key types

### OrderStatus

```ts
type OrderStatus =
  | "pending"
  | "paid"
  | "confirmed"
  | "fulfilled"
  | "cancelled"
  | "refunded"
  | "failed";
```

### PaymentMethod

```ts
type PaymentMethod = "TAT" | "LIGHTNING" | "CARD" | "BANK_TRANSFER";
```

### PaymentStatus

```ts
type PaymentStatus = "pending" | "completed" | "failed" | "refunded";
```

### PaymentProvider interface

Implement this to add custom payment methods:

```ts
interface PaymentProvider {
  readonly name: string;
  readonly supportedMethods: PaymentMethod[];
  initializePayment(payment: Payment): Promise<PaymentInitResult>;
  verifyPayment(paymentId: string): Promise<PaymentVerificationResult>;
  refundPayment(
    paymentId: string,
    amount: Price,
    reason: string,
  ): Promise<RefundResult>;
}
```

## BoothState

| Property    | Type                         | Description        |
| ----------- | ---------------------------- | ------------------ |
| `orders`    | `Map<string, TokenOrder>`    | All orders         |
| `payments`  | `Map<string, Payment>`       | Payment records    |
| `receipts`  | `Map<string, Receipt>`       | Generated receipts |
| `inventory` | `Map<string, InventoryItem>` | Inventory items    |
| `refunds`   | `Map<string, RefundRequest>` | Refund requests    |

## Related

- [Commerce guide](/guides/commerce) — step-by-step walkthrough
- [Booth Protocol Spec](/spec/extensions) — NWPC methods
- [Forge](/sdk/forge) — the issuer that fulfills orders
