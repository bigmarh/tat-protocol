import type {
  CommitMintResult,
  CommitTransferResult,
  ForgeLedger,
  PendingDelivery,
  StoredTx,
  TxRecord,
} from "@tat-protocol/storage";
import type { ForgeState } from "./ForgeState.js";

/** The commit/outbox half of {@link ForgeLedger}, which the blob fallback implements. */
export type TxLedger = Omit<ForgeLedger, "durable" | "spentSet" | "supply">;

export interface BlobTx {
  record: TxRecord;
  deliveries: { delivered: boolean; attempts: number; nextAttemptAt: number }[];
}

/**
 * Ledger over the forge's own state blob, for a forge configured without a
 * {@link ForgeLedger}.
 *
 * A commit applies the spent marks (or the supply increment) and the tx record
 * to in-memory state with no `await` between them, then writes the blob once.
 * Every snapshot of state therefore holds both or neither — including one a
 * concurrent save happens to take — and the single `setItem` is atomic on disk
 * with NodeStore's write-then-rename. If the write fails the in-memory change
 * is rolled back and the commit rejects, so the caller sends nothing.
 *
 * The rest of the forge's own blob writes are not serialized with this, which
 * is why the invariant above is per-snapshot rather than per-commit. It is
 * O(state) per commit, which is the reason production wants a real ledger.
 */
export class BlobLedger implements TxLedger {
  private lock: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly host: {
      state(): ForgeState;
      save(): Promise<void>;
    },
  ) {}

  private get txs(): Record<string, BlobTx> {
    const state = this.host.state();
    state.txRecords ??= {};
    return state.txRecords;
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.lock.then(fn, fn);
    this.lock = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private view(tx: BlobTx): StoredTx {
    const record = structuredClone(tx.record);
    return {
      ...record,
      outputs: record.outputs.map((o, i) => ({
        ...o,
        delivered: tx.deliveries[i]?.delivered ?? false,
      })),
    };
  }

  private entry(record: TxRecord): BlobTx {
    return {
      record: structuredClone(record),
      deliveries: record.outputs.map(() => ({
        delivered: false,
        attempts: 0,
        nextAttemptAt: record.createdAt,
      })),
    };
  }

  async commitTransfer(
    _keysetId: string,
    record: TxRecord,
  ): Promise<CommitTransferResult> {
    return this.exclusive(async () => {
      const existing = this.txs[record.txId];
      if (existing) {
        return {
          ok: false,
          reason: "duplicate",
          existing: this.view(existing),
        };
      }
      const spentSet = this.host.state().spentTokens;
      const seen = new Set<string>();
      const spent = record.inputHashes.filter((h) => {
        const conflict = spentSet.has(h) || seen.has(h);
        seen.add(h);
        return conflict;
      });
      if (spent.length > 0) return { ok: false, reason: "spent", spent };

      for (const h of record.inputHashes) spentSet.add(h);
      this.txs[record.txId] = this.entry(record);
      try {
        await this.host.save();
      } catch (err) {
        for (const h of record.inputHashes) spentSet.delete(h);
        delete this.txs[record.txId];
        throw err;
      }
      return { ok: true };
    });
  }

  async commitMint(
    _keysetId: string,
    record: TxRecord,
    amount: number,
  ): Promise<CommitMintResult> {
    return this.exclusive(async () => {
      const existing = this.txs[record.txId];
      if (existing) {
        return {
          ok: false,
          reason: "duplicate",
          existing: this.view(existing),
        };
      }
      const state = this.host.state();
      const before = state.circulatingSupply ?? 0;
      if (state.totalSupply > 0 && before + amount > state.totalSupply) {
        return { ok: false, reason: "over-cap" };
      }
      state.circulatingSupply = before + amount;
      this.txs[record.txId] = this.entry(record);
      try {
        await this.host.save();
      } catch (err) {
        state.circulatingSupply = before;
        delete this.txs[record.txId];
        throw err;
      }
      return { ok: true, issued: before + amount };
    });
  }

  async getTx(_keysetId: string, txId: string): Promise<StoredTx | null> {
    const tx = this.txs[txId];
    return tx ? this.view(tx) : null;
  }

  async pendingDeliveries(
    _keysetId: string,
    opts: { now: number; createdAfter: number; limit?: number },
  ): Promise<PendingDelivery[]> {
    const out: PendingDelivery[] = [];
    for (const { record, deliveries } of Object.values(this.txs)) {
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

  async markDelivered(
    _keysetId: string,
    txId: string,
    index: number,
  ): Promise<void> {
    const d = this.txs[txId]?.deliveries[index];
    if (!d || d.delivered) return;
    d.delivered = true;
    await this.host.save();
  }

  async recordFailedAttempt(
    _keysetId: string,
    txId: string,
    index: number,
    nextAttemptAt: number,
  ): Promise<void> {
    const d = this.txs[txId]?.deliveries[index];
    if (!d || d.delivered) return;
    d.attempts += 1;
    d.nextAttemptAt = nextAttemptAt;
    await this.host.save();
  }

  async pruneTx(_keysetId: string, createdBefore: number): Promise<number> {
    let removed = 0;
    for (const [id, tx] of Object.entries(this.txs)) {
      if (tx.record.createdAt < createdBefore) {
        delete this.txs[id];
        removed++;
      }
    }
    if (removed > 0) await this.host.save();
    return removed;
  }
}
