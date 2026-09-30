import type { SpentSetStore } from './SpentSetStore.js';
import type { SupplyStore } from './SupplyStore.js';

/**
 * The forge's system of record for value movement: one commit per transfer or
 * mint, covering everything that has to be true together.
 *
 * ## Why the spent set and the supply alone are not enough
 *
 * A transfer consumes inputs and creates outputs. The spent set records the
 * first half; nothing recorded the second. A forge that marked its inputs spent
 * and then failed to push an output — a relay down, a crash between the two —
 * had destroyed that value: the inputs were gone and no copy of the output
 * existed anywhere to send again. A mint had the mirror image: supply reserved,
 * the send failed, and a retried mint reserved again.
 *
 * So the ledger commits the spend (or the reservation), the tx record holding
 * every output, and an outbox row per output as ONE unit, before anything is
 * sent. Delivery is then just a retryable read of committed state, and
 * `status {tx_id}` can answer from the same record.
 *
 * ## The contract
 *
 * - **All or nothing.** `commitTransfer` marks every input spent, stores the
 *   record and creates its outbox rows, or does none of it. If any input is
 *   already spent it applies nothing and reports which.
 * - **Idempotent per tx id.** Committing a tx id that already exists applies
 *   nothing and returns the stored record, so a retried request is answered
 *   rather than re-executed.
 * - **Durable before resolve** (when `durable` is true), for the same reason as
 *   {@link SpentSetStore}: the forge releases outputs straight after.
 * - **Shared state.** `spentSet` and `supply` are views over the very rows the
 *   commits write; the forge reads and burns through them, so there is one
 *   spent set, not two that can disagree.
 *
 * The executable form is `tests/conformance/forge-ledger.ts`.
 */
export interface ForgeLedger {
  /** Whether a commit survives process death. The production guard requires it. */
  readonly durable: boolean;
  readonly spentSet: SpentSetStore;
  readonly supply: SupplyStore;

  commitTransfer(keysetId: string, record: TxRecord): Promise<CommitTransferResult>;
  commitMint(keysetId: string, record: TxRecord, amount: number): Promise<CommitMintResult>;
  getTx(keysetId: string, txId: string): Promise<StoredTx | null>;

  /**
   * Undelivered outputs whose next attempt is due at `now`, from txs created
   * after `createdAfter` (older ones have left the outbox; `status` still
   * serves them until the record is pruned). Times are epoch milliseconds.
   */
  pendingDeliveries(
    keysetId: string,
    opts: { now: number; createdAfter: number; limit?: number }
  ): Promise<PendingDelivery[]>;
  markDelivered(keysetId: string, txId: string, index: number, now: number): Promise<void>;
  recordFailedAttempt(
    keysetId: string,
    txId: string,
    index: number,
    nextAttemptAt: number
  ): Promise<void>;

  /**
   * Delete tx records (and their outbox rows) created before `createdBefore`.
   * Never touches the spent set: a pruned record's inputs stay spent.
   * @returns the number of records removed.
   */
  pruneTx(keysetId: string, createdBefore: number): Promise<number>;

  close?(): Promise<void>;
}

export interface TxOutput {
  /** Pubkey the output is locked and delivered to. */
  to: string;
  jwt: string;
}

export interface TxRecord {
  txId: string;
  kind: 'transfer' | 'mint';
  /** The NWPC request id that created it; retries reuse it so the pocket can correlate. */
  requestId: string;
  /**
   * The key that sealed the request. `status` gives it every output. Once
   * pockets seal each forge request with a fresh one-time key (as the spec
   * requires), the pocket must keep that key with the pending tx until it
   * settles, because it is what authenticates the pocket's `status` call.
   */
  submitter: string;
  inputHashes: string[];
  outputs: TxOutput[];
  /** Epoch milliseconds. */
  createdAt: number;
}

export interface StoredTx extends TxRecord {
  outputs: Array<TxOutput & { delivered: boolean }>;
}

export interface PendingDelivery {
  txId: string;
  index: number;
  to: string;
  jwt: string;
  requestId: string;
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
}

export type CommitTransferResult =
  | { ok: true }
  | { ok: false; reason: 'spent'; spent: string[] }
  | { ok: false; reason: 'duplicate'; existing: StoredTx };

export type CommitMintResult =
  | { ok: true; issued: number }
  | { ok: false; reason: 'over-cap' }
  | { ok: false; reason: 'duplicate'; existing: StoredTx };
