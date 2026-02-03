// Main classes
export { Gate } from "./Gate";
export { GateBase } from "./GateBase";
export { GateServerSpec } from "./GateServerSpec";

// Configurations
export type { GateConfig, GateState } from "./GateBase";
export type { GateServerSpecConfig } from "./GateServerSpec";

// Types (legacy)
export * from "./types";

// Spec types (TAT Protocol Extensions specification)
export * from "./spec-types";

// Interfaces
export type {
  ValidationStrategyInterface,
  ValidationContext,
} from "./ValidationStrategyInterface";

export type {
  AccessPolicyInterface,
  PolicyEvaluationResult,
} from "./AccessPolicyInterface";
