// import { Token, Payload } from "@tat-protocol/token";
// import { KeyPair } from "@tat-protocol/hdkeys";
// import { StorageInterface } from "@tat-protocol/storage";
import { Payload } from "@tat-protocol/token";

/**
 * Order status enumeration
 */
export enum OrderStatus {
  PENDING = "PENDING",
  PAID = "PAID",
  CONFIRMED = "CONFIRMED",
  FULFILLED = "FULFILLED",
  CANCELLED = "CANCELLED",
  REFUNDED = "REFUNDED",
  FAILED = "FAILED",
}

/**
 * Payment method types
 */
export enum PaymentMethod {
  BITCOIN = "BITCOIN",
  LIGHTNING = "LIGHTNING",
  CREDIT_CARD = "CREDIT_CARD",
  BANK_TRANSFER = "BANK_TRANSFER",
  CRYPTO = "CRYPTO",
  CUSTOM = "CUSTOM",
}

/**
 * Payment status
 */
export enum PaymentStatus {
  PENDING = "PENDING",
  PROCESSING = "PROCESSING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  EXPIRED = "EXPIRED",
  REFUNDED = "REFUNDED",
}

/**
 * Token order request
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
  currency: string; // BTC, USD, EUR, etc.
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
 * Receipt for completed order
 */
export interface Receipt {
  receiptId: string;
  orderId: string;
  buyer: string;
  payment: Payment;
  tokens: string[]; // JWTs of issued tokens
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
  status: "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED";
  requestedAt: number;
  processedAt?: number;
  metadata?: Record<string, unknown>;
}
