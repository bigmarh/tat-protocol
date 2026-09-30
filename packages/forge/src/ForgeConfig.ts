import { TokenType } from "@tat-protocol/token";
import {
  StorageInterface,
  SpentSetStore,
  SupplyStore,
  ForgeLedger,
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
   * The forge's system of record: spent set, supply, and every committed
   * transfer and mint with its outputs, committed together.
   *
   * A transfer marks its inputs spent, records its outputs and queues them for
   * delivery in ONE commit, before anything is sent; a failed send then leaves
   * the output in the outbox for retry, and `status {tx_id}` can re-serve it.
   * `spentSetStore`/`supplyStore` on their own cannot do that, so configuring
   * either without a ledger is refused at `initialize()`.
   *
   * Omit it and the forge keeps all of this in its state blob (see
   * `allowBlobState`).
   *
   * ```ts
   * import { DatabaseSync } from "node:sqlite";
   * import { SqliteForgeLedger } from "@tat-protocol/storage";
   *
   * new FungibleForge({ ...config, ledger: new SqliteForgeLedger(new DatabaseSync("forge.db")) });
   * ```
   */
  ledger?: ForgeLedger;

  /**
   * Run in production (`NODE_ENV=production`) without a durable ledger, keeping
   * spent set, supply and tx records in the state blob. Refused by default: the
   * blob is rewritten whole on every commit and is only as crash-safe as the
   * StorageInterface backend's `setItem`.
   */
  allowBlobState?: boolean;

  /**
   * How long committed tx records are kept for `status` and replay. Clamped to
   * at least 30 days: a pocket that was offline must still be able to recover
   * outputs whose delivery gave up. Default 30.
   */
  txRecordRetentionDays?: number;

  /**
   * Let the forge persist a key it generated into storage that does not
   * encrypt at rest (`storage.encryptsAtRest !== true`). Refused by default.
   * Keys supplied in `keys` are never written to storage.
   */
  allowPlaintextSecrets?: boolean;

  /** How often the outbox is drained. Default 5000 ms. */
  outboxIntervalMs?: number;

  /**
   * End of the transition window for pockets that sign the retired v1 spend
   * digest (unix seconds). Until then a v1 witness is accepted for plain
   * transfers — no timeLock on any output — and afterwards it is answered with
   * UPGRADE_REQUIRED. Default 2026-11-01T00:00:00Z; 0 closes it immediately.
   */
  acceptV1SpendDigestUntil?: number;

  /**
   * Allow arbitrary properties for NWPC compatibility
   */
  [key: string]: unknown;
}
