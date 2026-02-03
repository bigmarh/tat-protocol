import { StorageInterface } from "@tat-protocol/storage";
import { KeyPair } from "@tat-protocol/hdkeys";
import { DebugLogger } from "@tat-protocol/utils";

const Debug = DebugLogger.getInstance();

export interface BoothConfig {
  storage?: StorageInterface;
  keys?: KeyPair;
}

export class Booth {
  private config: BoothConfig;
  private isInitialized: boolean;

  constructor(config?: BoothConfig) {
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
      Debug.log("Storage initialized", "Booth");

      this.isInitialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize Booth: ${error}`);
    }
  }
}
