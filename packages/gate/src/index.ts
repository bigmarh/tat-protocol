// Main classes
export { Gate } from "./Gate.js";
export { GateBase } from "./GateBase.js";
export { GateServerSpec } from "./GateServerSpec.js";

// Configurations
export type { GateConfig, GateState } from "./GateBase.js";
export type { GateServerSpecConfig } from "./GateServerSpec.js";

// Types (legacy)
export * from "./types.js";

// Spec types (TAT Protocol Extensions specification)
export * from "./spec-types.js";

// Interfaces
export type {
  ValidationStrategyInterface,
  ValidationContext,
} from "./ValidationStrategyInterface.js";

export type {
  AccessPolicyInterface,
  PolicyEvaluationResult,
} from "./AccessPolicyInterface.js";
