import type { Invoice, Receipt } from "./spec-types.js";

export interface BoothFulfillmentContext {
  invoice: Invoice;
  buyerPubkey: string;
  boothPubkey: string;
  payment: {
    method: string;
    provider?: string;
    providerPaymentId?: string;
    amount: number;
    currency: string;
    details?: Record<string, unknown>;
  };
}

export interface BoothFulfillmentResult {
  /** Primary token JWT for simple purchases. */
  tat?: string;
  /** Multiple token JWTs, if fulfillment mints several outputs. */
  tokens?: string[];
  /** Optional token metadata for receipts. */
  tokenID?: string;
  tokenHash?: string;
  /** If omitted, Booth creates a standard receipt from the invoice/payment. */
  receipt?: Receipt;
  metadata?: Record<string, unknown>;
}

/**
 * Called after Booth has confirmed payment. Implementations usually mint via a
 * Forge and deliver/push the token to the buyer.
 */
export type BoothFulfillmentHandler = (
  context: BoothFulfillmentContext,
) => Promise<BoothFulfillmentResult>;
