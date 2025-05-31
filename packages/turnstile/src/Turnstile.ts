import { StorageInterface } from "@tat-protocol/storage";
import { KeyPair } from "@tat-protocol/hdkeys";
import { DebugLogger } from "@tat-protocol/utils";

const Debug = DebugLogger.getInstance();

export interface TurnstileConfig {
  storage?: StorageInterface;
  keys?: KeyPair;
}

export class Turnstile {
  private config: TurnstileConfig;
  private isInitialized: boolean;

  constructor(config?: TurnstileConfig) {
    this.config = config || {};
    this.isInitialized = false;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Initialize storage if provided
      if (this.config.storage) {
        Debug.log("Storage initialized", "Turnstile");
      }

      this.isInitialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize Turnstile: ${error}`);
    }
  }
}
