// Main classes
export { BoothAgent } from "./BoothAgent";
export type { BoothAgentConfig } from "./BoothAgent";

export { Booth } from "./Booth";
export { BoothBase } from "./BoothBase";
export { BoothServer } from "./BoothServer";
export { BoothServerSpec } from "./BoothServerSpec";
export type { BoothConfig, BoothState } from "./BoothBase";
export type { BoothServerConfig } from "./BoothServer";
export type { BoothServerSpecConfig } from "./BoothServerSpec";

// TAT payment provider
export { TATPaymentProvider } from "./TATPaymentProvider";
export type { TATPaymentConfig } from "./TATPaymentProvider";

// Spec types (TAT Protocol Extensions specification - Section 4: Booth Protocol)
export * from "./spec-types";

// Types - aligned with TAT Protocol spec
export {
  PaymentMethod,
  OrderStatusEnum,
  PaymentStatusEnum,
  BITCOIN,
  CREDIT_CARD,
} from "./types";

export type {
  TokenOrder,
  OrderStatus,
  Payment,
  PaymentStatus,
  Receipt,
  ReceiptPayment,
  LegacyReceipt,
  InventoryItem,
  Price,
  SalesAnalytics,
  RefundRequest,
  PricingConfig,
} from "./types";

// Interfaces
export type {
  PaymentProvider,
  PaymentInitResult,
  PaymentVerificationResult,
  RefundResult,
} from "./PaymentProviderInterface";

export type { PricingEngine, PriceCalculation } from "./PricingEngineInterface";
