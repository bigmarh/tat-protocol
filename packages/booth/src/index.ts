// Main classes
export { BoothAgent } from "./BoothAgent.js";
export type { BoothAgentConfig } from "./BoothAgent.js";

export { Booth } from "./Booth.js";
export { BoothBase } from "./BoothBase.js";
export { BoothServer } from "./BoothServer.js";
export { BoothServerSpec } from "./BoothServerSpec.js";
export type { BoothConfig, BoothState } from "./BoothBase.js";
export type { BoothServerConfig } from "./BoothServer.js";
export type { BoothServerSpecConfig } from "./BoothServerSpec.js";

// TAT payment provider
export { TATPaymentProvider } from "./TATPaymentProvider.js";
export type { TATPaymentConfig } from "./TATPaymentProvider.js";

// Spec types (TAT Protocol Extensions specification - Section 4: Booth Protocol)
export * from "./spec-types.js";

// Types - aligned with TAT Protocol spec
export {
  PaymentMethod,
  OrderStatusEnum,
  PaymentStatusEnum,
  BITCOIN,
  CREDIT_CARD,
} from "./types.js";

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
} from "./types.js";

// Interfaces
export type {
  PaymentProvider,
  PaymentInitResult,
  PaymentVerificationResult,
  RefundResult,
} from "./PaymentProviderInterface.js";

export type {
  PricingEngine,
  PriceCalculation,
} from "./PricingEngineInterface.js";
