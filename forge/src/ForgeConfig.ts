import { TokenType } from "@tat-protocol/token";
import { StorageInterface } from "@tat-protocol/storage";
import { KeyPair } from "@tat-protocol/hdkeys";

/**
 * Configuration options for a Forge
 */
export interface ForgeConfig {
  /**
   * The owner of the forge's public key
   */
  owner?: string;

  /**
   * The relays to connect to
   */
  relays?: string[];

  /**
   * The total supply of the forge
   */
  totalSupply?: number;

  /**
   * The ID of the forge
   */
  forgeId?: number;

  /**
   * The type of token this forge will handle
   */
  tokenType: TokenType;

  /**
   * Optional storage implementation
   * If not provided, will use default storage based on environment
   */
  storage?: StorageInterface;

  /**
   * Type of storage to use if no storage implementation is provided
   * Defaults to 'browser' in browser environments, 'node' in Node.js
   */
  storageType?: "browser" | "node";

  /**
   * Maximum number of tokens that can be minted
   * If undefined, supply is unlimited
   */
  maxSupply?: number;

  /**
   * Strategy for generating asset IDs for non-fungible tokens
   * 'unique' - Generates unique UUIDs
   * 'sequential' - Uses sequential numbers
   */
  assetIdStrategy?: "unique" | "sequential";

  /**
   * Optional key pair for the forge
   * If not provided, will generate new keys during initialization
   */
  keys?: KeyPair;

  /**
   * List of public keys authorized to forge tokens
   * If not provided, only the forge owner can mint tokens
   */
  authorizedForgers?: string[];
}
