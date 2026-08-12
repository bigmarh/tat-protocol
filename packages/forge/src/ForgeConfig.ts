import { TokenType } from "@tat-protocol/token";
import {
  StorageInterface,
  SpentSetStore,
  SupplyStore,
} from "@tat-protocol/storage";
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
   * Transition control for the spent-notice event kind.
   *
   * Spent-token notices moved from kind 1 (the short-text-note kind, which
   * renders them as garbage posts in social clients) to the dedicated
   * `KIND_TOKEN_SPENT`. When `true` (the default), the forge publishes the
   * notice under BOTH kinds so pockets on an older SDK — which only subscribe
   * to kind 1 — keep reconciling tokens spent on another device.
   *
   * Set to `false` once all pockets are updated. That is what stops the forge
   * writing spend notices into public social feeds. The token hash is no longer
   * published in a `t` tag under either kind, so relay hashtag-index abuse is
   * already fixed regardless of this setting.
   */
  publishLegacySpentNotes?: boolean;

  /**
   * Where the spent set lives.
   *
   * Supply one and the forge stops keeping spent token hashes in its blob
   * state. That is the whole point: without it, every spend re-serialises the
   * entire state — the spent set, the Bloom filter, tokenUsage, pendingTxs —
   * and writes it back whole, so the cumulative cost of reaching N spends is
   * O(N^2) and the synchronous JSON.stringify blocks the event loop, which
   * stalls the relay subscription and turns into dropped events rather than
   * merely slow responses. A forge is unusable somewhere around 50k-100k
   * lifetime spends.
   *
   * With a store the check-and-mark is one atomic O(1) operation and the
   * rejection of a double-spend becomes a uniqueness constraint the store
   * enforces rather than a race the application has to keep winning.
   *
   * Omitting it preserves the existing blob behaviour exactly, so upgrading the
   * SDK changes nothing until a forge opts in. On the first init WITH a store,
   * any spent hashes already in blob state are imported (see `_loadState`), so
   * no previously spent token becomes replayable.
   *
   * ```ts
   * import { DatabaseSync } from "node:sqlite";
   * import { SqliteSpentSetStore } from "@tat-protocol/storage";
   *
   * new FungibleForge({
   *   ...config,
   *   spentSetStore: new SqliteSpentSetStore(new DatabaseSync("forge.db")),
   * });
   * ```
   */
  spentSetStore?: SpentSetStore;

  /**
   * Keyset the spent set is recorded under.
   *
   * Defaults to a single sentinel, which is correct while epoch keysets do not
   * exist yet. Token hashes commit to the issuer (`iss` is in the payload), so
   * two forges cannot produce the same hash and sharing one store is safe
   * without setting this. It exists so that landing epoch keysets later is a
   * new value in an existing column rather than a migration of the one table
   * that must never be lost.
   */
  spentKeysetId?: string;

  /**
   * Where supply enforcement and asset-id allocation live.
   *
   * Supply was a counter in process memory compared against `totalSupply` by
   * application code. That is a read-compare-write: with N processes every one
   * reads the same value, every one concludes it is under the cap, and the mint
   * collectively over-issues by up to N times the headroom while each process
   * believes it obeyed the limit. Supplying a store makes the cap a constraint
   * the store evaluates during the issuing transaction, so no code path decides
   * whether the cap was met.
   *
   * It also closes a durability hole at N = 1: `forgeToken` incremented the
   * counter in memory and returned the signed token without awaiting a write,
   * so a crash before the next state save released a token the supply never
   * counted — and the cap under-counts permanently afterwards. `tryIssue` does
   * not resolve until the increment is durable.
   *
   * Omitting it preserves the existing in-process behaviour exactly. On the
   * first init WITH a store, `totalSupply` is adopted as the cap and any
   * `circulatingSupply` already in blob state is carried across, so an
   * upgrading forge does not reset to full headroom.
   */
  supplyStore?: SupplyStore;

  /**
   * Allow arbitrary properties for NWPC compatibility
   */
  [key: string]: unknown;
}
