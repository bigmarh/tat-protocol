import type { CatalogItem, PaymentOptions } from "./spec-types.js";

/**
 * Request passed to a payment adapter when Booth creates an invoice.
 * Adapters should create an external payment request (Lightning invoice,
 * hosted card checkout, etc.) and return the protocol payment option fields
 * to expose to the buyer.
 */
export interface BoothPaymentRequest {
  invoiceId: string;
  catalogItem: CatalogItem;
  buyerPubkey: string;
  quantity: number;
  totalAmount: number;
  currency: string;
  boothPubkey: string;
  expiresAt: number;
  metadata?: Record<string, unknown>;
}

/** Provider-specific reference persisted with the invoice. */
export interface BoothPaymentReference {
  method: string;
  provider?: string;
  providerPaymentId?: string;
  status?: "pending" | "completed" | "failed" | "expired";
  data?: Record<string, unknown>;
}

/** Result of creating an external payment request. */
export interface BoothPaymentCreation {
  /** Partial PaymentOptions to merge into the invoice response. */
  paymentOptions: Partial<PaymentOptions>;
  /** Provider reference to persist with the invoice for webhook/status reconciliation. */
  reference?: BoothPaymentReference;
}

/** Parsed webhook/payment notification. */
export interface BoothPaymentWebhookEvent {
  invoiceId?: string;
  providerPaymentId?: string;
  method: string;
  status: "completed" | "failed" | "expired" | "pending";
  amount?: number;
  currency?: string;
  raw?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * Pluggable payment adapter for Booth.
 *
 * The core Booth module stays transport-agnostic: apps can use their own HTTP
 * server, or the optional BoothWebhookServer helper, to receive provider
 * webhooks and call booth.confirmInvoice().
 */
export interface BoothPaymentAdapter {
  readonly method: string;
  readonly provider?: string;

  createPayment(request: BoothPaymentRequest): Promise<BoothPaymentCreation>;

  parseWebhook?(request: {
    headers: Record<string, string | string[] | undefined>;
    bodyText: string;
    bodyJson?: unknown;
    query: URLSearchParams;
  }): Promise<BoothPaymentWebhookEvent>;

  getPaymentStatus?(
    reference: BoothPaymentReference,
  ): Promise<BoothPaymentWebhookEvent>;
}
