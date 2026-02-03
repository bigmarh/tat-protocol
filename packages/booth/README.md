# @tat-protocol/boxoffice

Purchase and sales protocol for TAT Protocol tokens.

## Overview

The Boxoffice module provides **two implementations**:

### 1. **BoxofficeServerSpec** - TAT Protocol Extensions Spec Compliant
Implements the [TAT Protocol Extensions specification](https://github.com/tat-protocol/extensions) section 4 (Booth Protocol) with official NWPC methods:
- `booth.catalog` - Browse available TATs
- `booth.invoice` - Request purchase invoice
- `booth.pay` - Submit payment
- `booth.status` - Check invoice status

**Use this for spec-compliant implementations.**

### 2. **BoxofficeBase/BoxofficeServer** - Flexible SDK Foundation
Protocol-level SDK with pluggable payment providers, pricing engines, and custom business logic.

**Use this for custom implementations with advanced features.**

---

## Installation

```bash
npm install @tat-protocol/boxoffice
```

## Quick Start

### Using BoxofficeServerSpec (Spec-Compliant)

```typescript
import { BoxofficeServerSpec, CatalogItem } from '@tat-protocol/boxoffice';
import { NodeStorage } from '@tat-protocol/storage';

// Create spec-compliant booth
const boxoffice = await BoxofficeServerSpec.create({
  storage: new NodeStorage({ path: './boxoffice' }),
  keys: myKeys,
  boxOfficeName: 'TATpay',
  fee: 0.025, // 2.5% fee
  relays: ['wss://relay.damus.io'],
  supportedPaymentMethods: ['tatusd', 'lightning', 'card']
});

// Add catalog items (per spec section 4.4)
const catalogItem: CatalogItem = {
  id: 'premium-monthly',
  issuer: forgePublicKey,
  name: 'Premium Membership',
  description: 'Monthly premium access',
  price: {
    amount: 500, // 500 TATUSD = $5.00
    currency: 'TATUSD'
  },
  tokenType: 'TAT',
  duration: 2592000, // 30 days in seconds
  supply: {
    total: 0, // Unlimited
    remaining: 0,
  },
  metadata: {
    category: 'membership',
    benefits: ['Exclusive content', 'Early access']
  }
};

await boxoffice.addCatalogItem(catalogItem);

// Now clients can call:
// - booth.catalog
// - booth.invoice
// - booth.pay
// - booth.status
```

### Implementing Custom Boxoffice

```typescript
import { BoxofficeBase, TokenOrder, Receipt } from '@tat-protocol/boxoffice';

class MyBoxoffice extends BoxofficeBase {
  // Implement how to fulfill orders after payment
  protected async fulfillOrder(order: TokenOrder): Promise<Receipt> {
    // Mint tokens via your forge
    const tokens = await this.forge.mint({
      recipient: order.buyerAddress,
      quantity: order.quantity,
      tokenType: order.tokenType
    });

    // Create receipt
    return {
      receiptId: `receipt-${order.orderId}`,
      orderId: order.orderId,
      buyer: order.buyer,
      payment: this.getPaymentForOrder(order.orderId),
      tokens: tokens.map(t => t.toJWT()),
      issuedAt: Date.now()
    };
  }

  // Validate orders before creation
  protected async validateOrder(order: Partial<TokenOrder>): Promise<boolean> {
    // Custom validation logic
    // Check inventory, buyer eligibility, pricing, etc.
    return true;
  }
}
```

## Implementing Payment Providers

```typescript
import { PaymentProvider, PaymentMethod } from '@tat-protocol/boxoffice';

class BitcoinPaymentProvider implements PaymentProvider {
  readonly name = 'bitcoin';
  readonly supportedMethods = [PaymentMethod.BITCOIN];

  async initializePayment(payment: Payment) {
    // Generate Bitcoin address
    const address = await this.generateAddress();

    return {
      paymentId: payment.paymentId,
      paymentAddress: address,
      expiresAt: Date.now() + 3600000 // 1 hour
    };
  }

  async verifyPayment(paymentId: string) {
    // Check blockchain for payment
    const tx = await this.checkBlockchain(paymentId);

    return {
      verified: tx.confirmed,
      status: tx.confirmed ? 'COMPLETED' : 'PENDING',
      transactionId: tx.hash,
      completedAt: tx.confirmedAt
    };
  }

  // Implement other PaymentProvider methods...
}
```

## Core Interfaces

### PaymentProvider
Defines how payments are processed for different payment methods.

### PricingEngine
Defines pricing strategies (fixed, dynamic, bulk discounts, etc.).

### TokenOrder
Order structure for purchasing tokens.

### Receipt
Cryptographically signed receipt with issued tokens.

## API

See inline documentation in the source code for detailed API information.

## Examples

See the [examples directory](./src/examples) for complete usage examples.

## License

MIT License. See [LICENSE](../../LICENSE) for details.
