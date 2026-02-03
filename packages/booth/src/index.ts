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

// Spec types (TAT Protocol Extensions specification - Section 4: Booth Protocol)
export * from "./spec-types";

// Types (legacy) - rename Receipt to avoid conflict
export type {
  TokenOrder,
  OrderStatus,
  Payment,
  PaymentStatus,
  Receipt as LegacyReceipt,
  InventoryItem,
  Price,
  PaymentMethod,
  SalesAnalytics,
  RefundRequest,
} from "./types";

// Interfaces
export type {
  PaymentProvider,
  PaymentInitResult,
  PaymentVerificationResult,
  RefundResult,
} from "./PaymentProviderInterface";

export type {
  PricingEngine,
  PriceCalculation,
} from "./PricingEngineInterface";
