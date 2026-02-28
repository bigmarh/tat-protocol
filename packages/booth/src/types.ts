import { Payload } from "@tat-protocol/token";

// Re-export spec types for convenience
export type {
  CatalogItem,
  Invoice,
  InvoiceStatus,
  PaymentOptions,
  PaymentSubmission,
  BoothInfo,
  ForgeAuthorization,
  ForgeMintRequest,
} from "./spec-types.js";

/**
 * Order status - lowercase to align with TAT Protocol spec
 */
export type OrderStatus =
  | "pending"
  | "paid"
  | "confirmed"
  | "fulfilled"
  | "cancelled"
  | "refunded"
  | "failed";

/**
 * @deprecated Use OrderStatus type with lowercase string values
 */
export const OrderStatusEnum = {
  PENDING: "pending" as OrderStatus,
  PAID: "paid" as OrderStatus,
  CONFIRMED: "confirmed" as OrderStatus,
  FULFILLED: "fulfilled" as OrderStatus,
  CANCELLED: "cancelled" as OrderStatus,
  REFUNDED: "refunded" as OrderStatus,
  FAILED: "failed" as OrderStatus,
} as const;

/**
 * Payment method types - aligned with TAT Protocol spec
 */
export enum PaymentMethod {
  TAT = "tat",
  LIGHTNING = "lightning",
  ONCHAIN = "onchain",
  CARD = "card",
  BANK_TRANSFER = "bank_transfer",
  CRYPTO = "crypto",
  CUSTOM = "custom",
}

/**
 * @deprecated Use PaymentMethod.ONCHAIN
 */
export const BITCOIN = PaymentMethod.ONCHAIN;

/**
 * @deprecated Use PaymentMethod.CARD
 */
export const CREDIT_CARD = PaymentMethod.CARD;

/**
 * Payment status - lowercase to align with TAT Protocol spec
 */
export type PaymentStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "expired"
  | "refunded";

/**
 * @deprecated Use PaymentStatus type with lowercase string values
 */
export const PaymentStatusEnum = {
  PENDING: "pending" as PaymentStatus,
  PROCESSING: "processing" as PaymentStatus,
  COMPLETED: "completed" as PaymentStatus,
  FAILED: "failed" as PaymentStatus,
  EXPIRED: "expired" as PaymentStatus,
  REFUNDED: "refunded" as PaymentStatus,
} as const;

/**
 * Token order request (internal model, maps to Invoice for NWPC)
 */
export interface TokenOrder {
  orderId: string;
  buyer: string; // Public key or identifier
  buyerAddress: string; // TAT receiving address
  forgePubkey: string; // Issuer forge public key
  tokenType: "FUNGIBLE" | "TAT";
  quantity?: number; // For fungible tokens
  tokenIDs?: string[]; // For TATs (specific token IDs requested)
  tokenPayload?: Partial<Payload>; // Custom token payload data
  price: Price;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
  paidAt?: number;
  fulfilledAt?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Price information
 */
export interface Price {
  amount: number;
  currency: string; // BTC, USD, EUR, sats, etc.
  breakdown?: {
    basePrice: number;
    fees: number;
    tax: number;
    discount: number;
  };
}

/**
 * Payment information
 */
export interface Payment {
  paymentId: string;
  orderId: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: Price;
  provider: string; // Payment provider identifier
  providerData?: Record<string, unknown>; // Provider-specific data
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  failureReason?: string;
}

/**
 * Receipt payment breakdown (aligned with TAT Protocol spec)
 */
export interface ReceiptPayment {
  method: PaymentMethod | string;
  grossAmount: number;
  currency: string;
  fees: {
    boxOffice: number;
    platform: number;
    payment: number; // Payment processor fee
  };
  netToCreator: number;
}

/**
 * Receipt for completed order (aligned with TAT Protocol spec)
 */
export interface Receipt {
  // Spec-aligned fields
  id: string;
  invoiceId: string;
  timestamp: number;

  item: {
    id: string;
    name: string;
    issuer: string;
  };

  payment: ReceiptPayment;

  tat: {
    tokenID: string;
    tokenHash: string;
  };

  buyer: string;
  boxOffice: string;

  // Legacy fields for backward compatibility
  tokens?: string[]; // JWTs of issued tokens
  metadata?: Record<string, unknown>;

  /**
   * @deprecated Use `id` instead
   */
  receiptId?: string;

  /**
   * @deprecated Use `invoiceId` instead
   */
  orderId?: string;

  /**
   * @deprecated Use `timestamp` instead
   */
  issuedAt?: number;
}

/**
 * Legacy Receipt type for backward compatibility
 * @deprecated Use Receipt instead
 */
export interface LegacyReceipt {
  receiptId: string;
  orderId: string;
  buyer: string;
  payment: Payment;
  tokens: string[];
  issuedAt: number;
  metadata?: Record<string, unknown>;
}

/**
 * Inventory item
 */
export interface InventoryItem {
  itemId: string;
  forgePubkey: string;
  tokenType: "FUNGIBLE" | "TAT";
  name: string;
  description?: string;
  price: Price;
  available: number; // Quantity available
  total?: number; // Total supply
  active: boolean; // Available for purchase
  metadata?: Record<string, unknown>;
}

/**
 * Sales analytics data
 */
export interface SalesAnalytics {
  totalOrders: number;
  totalRevenue: Price;
  ordersByStatus: Record<OrderStatus, number>;
  topItems: Array<{
    itemId: string;
    quantity: number;
    revenue: Price;
  }>;
  period: {
    start: number;
    end: number;
  };
}

/**
 * Pricing strategy configuration
 */
export interface PricingConfig {
  basePrice: Price;
  discounts?: Array<{
    condition: "BULK" | "TIME" | "MEMBER" | "CUSTOM";
    threshold?: number; // For bulk discounts
    percentage?: number; // Discount percentage
    fixedAmount?: number; // Fixed discount amount
    validFrom?: number;
    validUntil?: number;
  }>;
  fees?: {
    processing: number; // Percentage
    platform: number; // Fixed amount
  };
  tax?: {
    rate: number; // Percentage
    included: boolean; // Tax included in base price
  };
}

/**
 * Refund request
 */
export interface RefundRequest {
  refundId: string;
  orderId: string;
  amount: Price;
  reason: string;
  status: "pending" | "approved" | "rejected" | "completed";
  requestedAt: number;
  processedAt?: number;
  metadata?: Record<string, unknown>;
}
