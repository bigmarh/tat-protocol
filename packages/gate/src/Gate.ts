import { StorageInterface } from "@tat-protocol/storage";
import { KeyPair } from "@tat-protocol/hdkeys";
import { DebugLogger } from "@tat-protocol/utils";
import type { Signer } from "@tat-protocol/types";

const Debug = DebugLogger.getInstance();

/**
 * Configuration for Gate (gate) instances.
 *
 * Supports two key management approaches:
 * 1. `signer` - A Signer interface for abstracted key management (recommended)
 * 2. `keys` - Direct KeyPair for backwards compatibility
 *
 * If both are provided, `signer` takes precedence.
 */
export interface GateConfig {
  storage?: StorageInterface;
  /** Signer interface for abstracted key management (recommended) */
  signer?: Signer;
  /** Direct key pair for backwards compatibility */
  keys?: KeyPair;
}

export class Gate {
  private config: GateConfig;
  private isInitialized: boolean;

  constructor(config?: GateConfig) {
    this.config = config || {};
    this.isInitialized = false;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Initialize storage if provided
      if (!this.config.storage) {
        throw new Error(
          "A StorageInterface implementation must be provided in config.storage",
        );
      }
      Debug.log("Storage initialized", "Gate");

      this.isInitialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize Gate: ${error}`);
    }
  }
}
