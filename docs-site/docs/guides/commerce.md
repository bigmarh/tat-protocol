# Commerce with Booth

The Booth component handles commerce flows — managing a catalog, creating invoices, processing payments, and generating receipts.

## Create a Booth

```ts
import {
  BoothServer,
  TATPaymentProvider,
  NodeStore,
  KeySigner,
} from "@tat-protocol/tdk";

const booth = await BoothServer.create({
  storage: new NodeStore(".booth"),
  signer: new KeySigner(process.env.BOOTH_SK!),
  relays: ["wss://relay.damus.io"],
  forgePubkey: forgePk,
  paymentProviders: [
    new TATPaymentProvider({
      forgePubkey: forgePk,
      amount: 10,        // Cost per unit in tokens
      autoRefund: true,  // Refund on failure
    }),
  ],
});
```

## Manage inventory

```ts
// Add items to the catalog
await booth.addInventoryItem({
  itemId: "concert-ticket",
  name: "Summer Concert VIP",
  description: "VIP access to the Summer Concert 2026",
  price: { amount: 50, currency: "TAT" },
  available: 500,
  active: true,
  metadata: {
    event: "Summer Concert",
    venue: "Convention Center",
    date: "2026-08-01",
  },
});

// Update availability
await booth.updateInventory("concert-ticket", -1); // Sold one

// List active items
const items = await booth.listInventory(true);
```

## Create an order

```ts
const order = await booth.createOrder({
  buyer: buyerPubkey,
  buyerAddress: buyerReceiveAddress,
  quantity: 2,
  tokenType: "TAT",
  forgePubkey: forgePk,
  paymentMethod: "TAT",
  price: { amount: 100, currency: "TAT" },
});

console.log("Order ID:", order.orderId);
console.log("Status:", order.status); // "pending"
```

## Process payment

```ts
// Initialize payment
const { payment, expiresAt } = await booth.initializePayment(order.orderId);

// Buyer submits TAT tokens as payment
// (this happens via NWPC in a real flow)

// Verify payment
const result = await booth.verifyPayment(payment.paymentId);
if (result.verified) {
  console.log("Payment confirmed");
}
```

## Receipts

After fulfillment, retrieve the receipt:

```ts
const receipt = await booth.getReceiptByOrderId(order.orderId);
if (receipt) {
  console.log("Receipt:", receipt.id);
  console.log("Item:", receipt.item.name);
  console.log("Amount:", receipt.payment.grossAmount);
}
```

## Refunds

```ts
// Request a refund
const refund = await booth.requestRefund(
  order.orderId,
  { amount: 100, currency: "TAT" },
  "Customer requested cancellation"
);

// Process the refund (approve or reject)
await booth.processRefund(refund.refundId, true);
```

## Sales analytics

```ts
const now = Date.now();
const lastWeek = now - 7 * 24 * 60 * 60 * 1000;

const analytics = await booth.getSalesAnalytics(lastWeek, now);
console.log("Total orders:", analytics.totalOrders);
console.log("Revenue:", analytics.totalRevenue);
console.log("By status:", analytics.ordersByStatus);
```

## Next steps

- [Booth API Reference](/sdk/booth) — full API documentation
- [Booth Protocol Spec](/spec/extensions) — NWPC methods
- [Access Control](/guides/access-control) — verify purchased tokens
