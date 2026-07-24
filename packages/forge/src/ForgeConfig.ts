import { TokenType } from "@tat-protocol/token";
import { StorageInterface } from "@tat-protocol/storage";
import { KeyPair } from "@tat-protocol/hdkeys";
import type { Signer } from "@tat-protocol/types";

/**
 * Configuration options for a Forge.
 *
 * Supports two key management approaches:
 * 1. `signer` - A Signer interface for abstracted key management (recommended)
 * 2. `keys` - Direct KeyPair for backwards compatibility
 *
 * If both are provided, `signer` takes precedence.
 * If neither is provided, new keys will be generated automatically.
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
  tokenType?: TokenType;

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
   * Signer interface for abstracted key management (recommended)
   * Takes precedence over keys if both are provided
   */
  signer?: Signer;

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

  /**
   * Transition control for the P2PK witness-binding fix (audit C6).
   *
   * When `true` (the default), the forge accepts BOTH the new transfer-bound
   * witness AND the legacy witness signed over only the token hash, so wallets
   * on an older SDK keep working during a migration. While legacy witnesses are
   * accepted the witness-replay theft vector remains open for those witnesses —
   * set this to `false` once all wallets produce the bound witness to fully
   * close C6. New wallets always produce the bound witness.
   */
  allowLegacyWitness?: boolean;

  /**
   * Allow arbitrary properties for NWPC compatibility
   */
  [key: string]: unknown;
}
