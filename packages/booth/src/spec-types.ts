/**
 * Types matching TAT Protocol Extensions specification
 * Section 4: Booth Protocol
 */

/**
 * Invoice status (per spec section 4.4.4)
 */
export type InvoiceStatus = "pending" | "paid" | "expired" | "cancelled";

/**
 * Catalog Item (per spec section 3.4)
 */
export interface CatalogItem {
  id: string; // Unique identifier
  issuer: string; // Forge pubkey
  name: string;
  description: string;

  price: {
    amount: number; // Base amount
    currency: string; // "USD" | "sats" | etc.
  };

  tokenType: "TAT" | "FUNGIBLE";

  // For TATs
  duration?: number; // Seconds until expiry (subscriptions)

  // For Fungibles
  setID?: string;

  supply?: {
    total: number; // Max supply (0 = unlimited)
    remaining: number;
    maxPerUser?: number;
  };

  availability?: {
    startsAt?: number; // Sale start time
    endsAt?: number; // Sale end time
  };

  metadata?: {
    // Stored in TAT ext field
    category?: string;
    image?: string;
    benefits?: string[];
    [key: string]: any;
  };
}

/**
 * Receipt (per spec section 3.4)
 */
export interface Receipt {
  id: string;
  invoiceId: string;
  timestamp: number;

  item: {
    id: string;
    name: string;
    issuer: string;
  };

  payment: {
    method: string;
    grossAmount: number;
    currency: string;
    fees: {
      boxOffice: number;
      platform: number;
      payment: number; // Payment processor fee
    };
    netToCreator: number;
  };

  tat: {
    tokenID: string;
    tokenHash: string;
  };

  buyer: string; // Buyer pubkey
  boxOffice: string; // Booth pubkey
}

/**
 * Payment options in invoice response (per spec section 3.3.2)
 */
export interface PaymentOptions {
  tat?: {
    amount?: number;
    payTo: string; // Booth pubkey
    issuer: string; // Token issuer (forge pubkey)
    tokenType: "TAT" | "FUNGIBLE";
  };
  lightning?: {
    bolt11: string;
    amountSats: number;
  };
  onchain?: {
    address: string;
    amountBtc: number;
  };
  card?: {
    checkoutUrl: string;
    amount: number;
    currency: string;
  };
}

/**
 * Booth info in catalog response
 */
export interface BoothInfo {
  pubkey: string;
  name: string;
  fee: number; // Booth fee rate (0.03 = 3%)
}

/**
 * Invoice data structure
 */
export interface Invoice {
  invoiceId: string;
  catalogItem: CatalogItem;
  expiresAt: number; // Unix timestamp
  paymentOptions: PaymentOptions;
  status: InvoiceStatus;
  createdAt: number;
  paidAt?: number;
  buyerPubkey: string;
}

/**
 * Payment submission data (per spec section 3.3.3)
 */
export type PaymentSubmission =
  | {
      method: "tat";
      tokens: string[]; // TAT JWTs
    }
  | {
      method: "lightning";
      preimage: string; // Payment proof
    }
  | {
      method: "card";
      // Card payments are handled off-chain via webhooks
    };

/**
 * Forge authorization data (per spec section 6.2)
 */
export interface ForgeAuthorization {
  eventId: string; // Kind 30130 event ID
  boxOfficePubkey: string;
  catalogItemIds: string[]; // Authorized items
  maxFee: number; // Maximum fee rate
  expiresAt?: number; // Authorization expiry
  restrictions?: {
    regions?: string[]; // ISO country codes
    paymentMethods?: string[]; // Allowed methods
    maxPerDay?: number; // Rate limit
    maxTotal?: number; // Total cap
  };
  settlement: {
    currency: string;
    frequency: "instant" | "daily" | "weekly";
    minimumAmount?: number;
  };
}

/**
 * Mint request to Forge (per spec section 6.3)
 */
export interface ForgeMintRequest {
  authorizationEventId?: string; // Reference to kind 30130 event (if using Booth)
  catalogItemId: string;
  buyerPubkey: string;

  payment: {
    type: string;
    amount: number;
    referenceId: string;
    details?: Record<string, unknown>;
  };

  fees?: {
    boxOffice: number;
    platform: number;
  };

  invoiceId: string;
}
