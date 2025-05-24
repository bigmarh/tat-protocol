import { NWPCState } from "@tat-protocol/nwpc";

/**
 * Represents the current state of a Forge
 */
export interface ForgeState extends NWPCState {
  /**
   * The owner of the forge's public key
   */
  owner: string;

  /**
   * Version of the state format
   * Used for migrations if state format changes
   */
  version: number;

  /**
   * Set of spent token hashes
   * Used to prevent double-spending
   */
  spentTokens: Set<string>;

  /**
   * Map of pending transaction hashes to their data
   * Used to track transactions that are being processed
   */
  pendingTxs: Map<string, any>;

  /**
   * ID of the last processed event
   * Used to prevent replay attacks
   */
  lastProcessedEvent?: string;

  /**
   * Timestamp of the last successful state save
   * Used for recovery and synchronization
   */
  lastSavedAt?: number;

  /**
   * Total number of tokens minted
   * Used to track supply and enforce maxSupply
   */
  totalSupply: number;

  /**
   * Last used sequential asset ID
   * Only used when assetIdStrategy is 'sequential'
   */
  lastAssetId: number;

  /**
   * Set of authorized forger public keys
   * Used to control who can mint tokens
   */
  authorizedForgers: Set<string>;

  /**
   * Track token usage for LLM access
   */
  tokenUsage: Map<string, number>;

  /**
   * Number of tokens forged so far (for supply enforcement)
   */
  circulatingSupply?: number;


}
