import type {
  CommitMintResult,
  CommitTransferResult,
  ForgeLedger,
  PendingDelivery,
  StoredTx,
  TxRecord,
} from './ForgeLedger.js';
import { MemorySpentSetStore } from './MemorySpentSetStore.js';
import { MemorySupplyStore } from './MemorySupplyStore.js';
import { normalizeTokenHash } from './SpentSetStore.js';

interface Delivery {
  delivered: boolean;
  attempts: number;
  nextAttemptAt: number;
}

interface MemTx {
  record: TxRecord;
  deliveries: Delivery[];
}

/**
 * In-memory {@link ForgeLedger}. Atomic, NOT durable — a test and
 * single-session backend, refused by the forge's production guard.
 *
 * Each commit runs its checks and writes with no `await` between them, so on a
 * single-threaded event loop nothing can interleave: a commit is all-or-nothing
 * for the same reason `MemorySpentSetStore.tryMarkSpent` is atomic.
 */
export class MemoryForgeLedger implements ForgeLedger {
  readonly durable = false;
  readonly spentSet: MemorySpentSetStore;
  readonly supply: MemorySupplyStore;
  private txs = new Map<string, Map<string, MemTx>>();

  constructor(opts: { spentSet?: MemorySpentSetStore; supply?: MemorySupplyStore } = {}) {
    this.spentSet = opts.spentSet ?? new MemorySpentSetStore();
    this.supply = opts.supply ?? new MemorySupplyStore();
  }

  private txsFor(keysetId: string): Map<string, MemTx> {
    let m = this.txs.get(keysetId);
    if (!m) {
      m = new Map();
      this.txs.set(keysetId, m);
    }
    return m;
  }

  private insert(keysetId: string, record: TxRecord): void {
    this.txsFor(keysetId).set(record.txId, {
      record: structuredClone(record),
      deliveries: record.outputs.map(() => ({
        delivered: false,
        attempts: 0,
        nextAttemptAt: record.createdAt,
      })),
    });
  }

  private view(tx: MemTx): StoredTx {
    const record = structuredClone(tx.record);
    return {
      ...record,
      outputs: record.outputs.map((o, i) => ({ ...o, delivered: tx.deliveries[i].delivered })),
    };
  }

  async commitTransfer(keysetId: string, record: TxRecord): Promise<CommitTransferResult> {
    // Validate every hash before touching anything, so a malformed one cannot
    // leave the others marked.
    record.inputHashes.forEach(normalizeTokenHash);
    const existing = this.txsFor(keysetId).get(record.txId);
    if (existing) return { ok: false, reason: 'duplicate', existing: this.view(existing) };
    const spent = this.spentSet.markAllIfUnspentSync(keysetId, record.inputHashes);
    if (spent.length > 0) return { ok: false, reason: 'spent', spent };
    this.insert(keysetId, record);
    return { ok: true };
  }

  async commitMint(keysetId: string, record: TxRecord, amount: number): Promise<CommitMintResult> {
    const existing = this.txsFor(keysetId).get(record.txId);
    if (existing) return { ok: false, reason: 'duplicate', existing: this.view(existing) };
    const issued = this.supply.tryIssueSync(keysetId, amount);
    if (issued === null) return { ok: false, reason: 'over-cap' };
    this.insert(keysetId, record);
    return { ok: true, issued };
  }

  async getTx(keysetId: string, txId: string): Promise<StoredTx | null> {
    const tx = this.txsFor(keysetId).get(txId);
    return tx ? this.view(tx) : null;
  }

  async pendingDeliveries(
    keysetId: string,
    opts: { now: number; createdAfter: number; limit?: number }
  ): Promise<PendingDelivery[]> {
    const out: PendingDelivery[] = [];
    for (const { record, deliveries } of this.txsFor(keysetId).values()) {
      if (record.createdAt <= opts.createdAfter) continue;
      deliveries.forEach((d, index) => {
        if (d.delivered || d.nextAttemptAt > opts.now) return;
        out.push({
          txId: record.txId,
          index,
          to: record.outputs[index].to,
          jwt: record.outputs[index].jwt,
          requestId: record.requestId,
          attempts: d.attempts,
          nextAttemptAt: d.nextAttemptAt,
          createdAt: record.createdAt,
        });
      });
    }
    out.sort((a, b) => a.createdAt - b.createdAt || a.index - b.index);
    return out.slice(0, opts.limit ?? 100);
  }

  async markDelivered(keysetId: string, txId: string, index: number): Promise<void> {
    const d = this.txsFor(keysetId).get(txId)?.deliveries[index];
    if (d) d.delivered = true;
  }

  async recordFailedAttempt(
    keysetId: string,
    txId: string,
    index: number,
    nextAttemptAt: number
  ): Promise<void> {
    const d = this.txsFor(keysetId).get(txId)?.deliveries[index];
    if (d && !d.delivered) {
      d.attempts += 1;
      d.nextAttemptAt = nextAttemptAt;
    }
  }

  async pruneTx(keysetId: string, createdBefore: number): Promise<number> {
    const txs = this.txsFor(keysetId);
    let removed = 0;
    for (const [id, tx] of txs) {
      if (tx.record.createdAt < createdBefore) {
        txs.delete(id);
        removed++;
      }
    }
    return removed;
  }
}
