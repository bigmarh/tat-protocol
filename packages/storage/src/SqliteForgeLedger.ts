import type {
  CommitMintResult,
  CommitTransferResult,
  ForgeLedger,
  PendingDelivery,
  StoredTx,
  TxRecord,
} from './ForgeLedger.js';
import {
  SqliteSpentSetStore,
  tokenHashToBytes,
  type SqliteDatabaseHandle,
  type SqliteSpentSetStoreOptions,
  type SqliteStatementHandle,
} from './SqliteSpentSetStore.js';
import { SqliteSupplyStore } from './SqliteSupplyStore.js';
import { invalidTokenAmountReason } from '@tat-protocol/utils';

/**
 * SQLite-backed {@link ForgeLedger}.
 *
 * Built on ONE connection shared with the spent set and the supply row (it
 * constructs both on the handle it is given), so a transfer's spent marks, its
 * tx record and its outbox rows are written in a single
 * `BEGIN IMMEDIATE … COMMIT`. IMMEDIATE takes the write lock up front, so the
 * spent checks inside the transaction cannot be invalidated by another process
 * before the inserts land.
 *
 * Every commit body is synchronous — no `await` between BEGIN and COMMIT — so
 * two commits in one process cannot interleave on the shared connection either.
 *
 * ```ts
 * import { DatabaseSync } from "node:sqlite";
 * new FungibleForge({ ...config, ledger: new SqliteForgeLedger(new DatabaseSync("forge.db")) });
 * ```
 */
export class SqliteForgeLedger implements ForgeLedger {
  readonly durable = true;
  readonly spentSet: SqliteSpentSetStore;
  readonly supply: SqliteSupplyStore;
  private db: SqliteDatabaseHandle;
  private q: Record<string, SqliteStatementHandle>;

  constructor(db: SqliteDatabaseHandle, options: SqliteSpentSetStoreOptions = {}) {
    this.db = db;
    // The spent set sets the PRAGMAs (WAL, synchronous=FULL) for the shared
    // connection and creates `spent`; the supply store creates `supply`.
    this.spentSet = new SqliteSpentSetStore(db, options);
    this.supply = new SqliteSupplyStore(db, { skipPragmas: true });

    db.exec(`
      CREATE TABLE IF NOT EXISTS tx_record (
        keyset_id    TEXT    NOT NULL,
        tx_id        TEXT    NOT NULL,
        kind         TEXT    NOT NULL,
        request_id   TEXT    NOT NULL,
        submitter    TEXT    NOT NULL,
        input_hashes TEXT    NOT NULL,
        created_at   INTEGER NOT NULL,
        PRIMARY KEY (keyset_id, tx_id)
      ) WITHOUT ROWID
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS tx_record_created ON tx_record (keyset_id, created_at)`);
    // One row per output. The outbox is the undelivered rows: there is no
    // separate queue to fall out of step with the record.
    db.exec(`
      CREATE TABLE IF NOT EXISTS tx_output (
        keyset_id       TEXT    NOT NULL,
        tx_id           TEXT    NOT NULL,
        idx             INTEGER NOT NULL,
        recipient       TEXT    NOT NULL,
        jwt             TEXT    NOT NULL,
        delivered_at    INTEGER,
        attempts        INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL,
        created_at      INTEGER NOT NULL,
        PRIMARY KEY (keyset_id, tx_id, idx)
      ) WITHOUT ROWID
    `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS tx_output_due ON tx_output (keyset_id, delivered_at, next_attempt_at)`
    );

    this.q = {
      isSpent: db.prepare(`SELECT 1 AS found FROM spent WHERE keyset_id = ? AND token_hash = ?`),
      markSpent: db.prepare(`INSERT INTO spent (keyset_id, token_hash, spent_at) VALUES (?, ?, ?)`),
      ensureSupply: db.prepare(`INSERT INTO supply (keyset_id) VALUES (?) ON CONFLICT DO NOTHING`),
      issue: db.prepare(
        `UPDATE supply SET issued = issued + ? WHERE keyset_id = ? RETURNING issued`
      ),
      insertTx: db.prepare(
        `INSERT INTO tx_record (keyset_id, tx_id, kind, request_id, submitter, input_hashes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ),
      insertOut: db.prepare(
        `INSERT INTO tx_output (keyset_id, tx_id, idx, recipient, jwt, next_attempt_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ),
      getTx: db.prepare(`SELECT * FROM tx_record WHERE keyset_id = ? AND tx_id = ?`),
      getOuts: db.prepare(
        `SELECT idx, recipient, jwt, delivered_at FROM tx_output WHERE keyset_id = ? AND tx_id = ? ORDER BY idx`
      ),
      due: db.prepare(
        `SELECT o.tx_id, o.idx, o.recipient, o.jwt, o.attempts, o.next_attempt_at, o.created_at, r.request_id
           FROM tx_output o JOIN tx_record r ON r.keyset_id = o.keyset_id AND r.tx_id = o.tx_id
          WHERE o.keyset_id = ? AND o.delivered_at IS NULL AND o.next_attempt_at <= ? AND o.created_at > ?
          ORDER BY o.created_at, o.idx LIMIT ?`
      ),
      delivered: db.prepare(
        `UPDATE tx_output SET delivered_at = ? WHERE keyset_id = ? AND tx_id = ? AND idx = ? AND delivered_at IS NULL`
      ),
      failed: db.prepare(
        `UPDATE tx_output SET attempts = attempts + 1, next_attempt_at = ?
          WHERE keyset_id = ? AND tx_id = ? AND idx = ? AND delivered_at IS NULL`
      ),
      pruneOuts: db.prepare(
        `DELETE FROM tx_output WHERE keyset_id = ? AND tx_id IN
           (SELECT tx_id FROM tx_record WHERE keyset_id = ? AND created_at < ?)`
      ),
      pruneTxs: db.prepare(
        `DELETE FROM tx_record WHERE keyset_id = ? AND created_at < ? RETURNING 1`
      ),
    };
  }

  /** Run `body` in one write transaction, rolling back on any throw. */
  private inTransaction<T>(body: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = body();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  private readTx(keysetId: string, txId: string): StoredTx | null {
    const row = this.q.getTx.get(keysetId, txId) as
      | {
          tx_id: string;
          kind: string;
          request_id: string;
          submitter: string;
          input_hashes: string;
          created_at: number;
        }
      | undefined;
    if (!row) return null;
    const outs = (this.q.getOuts.all?.(keysetId, txId) ?? []) as Array<{
      recipient: string;
      jwt: string;
      delivered_at: number | null;
    }>;
    return {
      txId: row.tx_id,
      kind: row.kind as TxRecord['kind'],
      requestId: row.request_id,
      submitter: row.submitter,
      inputHashes: JSON.parse(row.input_hashes),
      createdAt: Number(row.created_at),
      outputs: outs.map(o => ({ to: o.recipient, jwt: o.jwt, delivered: o.delivered_at !== null })),
    };
  }

  private insertRecord(keysetId: string, record: TxRecord): void {
    this.q.insertTx.run(
      keysetId,
      record.txId,
      record.kind,
      record.requestId,
      record.submitter,
      JSON.stringify(record.inputHashes),
      record.createdAt
    );
    record.outputs.forEach((o, idx) => {
      this.q.insertOut.run(
        keysetId,
        record.txId,
        idx,
        o.to,
        o.jwt,
        record.createdAt,
        record.createdAt
      );
    });
  }

  async commitTransfer(keysetId: string, record: TxRecord): Promise<CommitTransferResult> {
    // Converting validates every hash before the transaction opens.
    const inputs = record.inputHashes.map(h => ({
      hex: h.toLowerCase(),
      bytes: tokenHashToBytes(h),
    }));
    return this.inTransaction<CommitTransferResult>(() => {
      const existing = this.readTx(keysetId, record.txId);
      if (existing) return { ok: false, reason: 'duplicate', existing };
      const spent = inputs
        .filter(i => this.q.isSpent.get(keysetId, i.bytes) != null)
        .map(i => i.hex);
      if (spent.length > 0) return { ok: false, reason: 'spent', spent };
      const now = Math.floor(Date.now() / 1000);
      for (const i of inputs) this.q.markSpent.run(keysetId, i.bytes, now);
      this.insertRecord(keysetId, record);
      return { ok: true };
    });
  }

  async commitMint(keysetId: string, record: TxRecord, amount: number): Promise<CommitMintResult> {
    const reason = invalidTokenAmountReason(amount);
    if (reason) throw new Error(`ForgeLedger: ${reason} (got ${amount})`);
    try {
      return this.inTransaction<CommitMintResult>(() => {
        const existing = this.readTx(keysetId, record.txId);
        if (existing) return { ok: false, reason: 'duplicate', existing };
        this.q.ensureSupply.run(keysetId);
        const row = this.q.issue.get(amount, keysetId) as { issued?: number } | undefined;
        this.insertRecord(keysetId, record);
        return { ok: true, issued: Number(row?.issued ?? 0) };
      });
    } catch (err) {
      // The cap is a CHECK on the supply row; the transaction was rolled back,
      // so nothing — reservation or record — was written.
      if (/CHECK constraint/i.test(String(err))) return { ok: false, reason: 'over-cap' };
      throw err;
    }
  }

  async getTx(keysetId: string, txId: string): Promise<StoredTx | null> {
    return this.readTx(keysetId, txId);
  }

  async pendingDeliveries(
    keysetId: string,
    opts: { now: number; createdAfter: number; limit?: number }
  ): Promise<PendingDelivery[]> {
    const rows = (this.q.due.all?.(keysetId, opts.now, opts.createdAfter, opts.limit ?? 100) ??
      []) as Array<{
      tx_id: string;
      idx: number;
      recipient: string;
      jwt: string;
      attempts: number;
      next_attempt_at: number;
      created_at: number;
      request_id: string;
    }>;
    return rows.map(r => ({
      txId: r.tx_id,
      index: Number(r.idx),
      to: r.recipient,
      jwt: r.jwt,
      requestId: r.request_id,
      attempts: Number(r.attempts),
      nextAttemptAt: Number(r.next_attempt_at),
      createdAt: Number(r.created_at),
    }));
  }

  async markDelivered(keysetId: string, txId: string, index: number, now: number): Promise<void> {
    this.q.delivered.run(now, keysetId, txId, index);
  }

  async recordFailedAttempt(
    keysetId: string,
    txId: string,
    index: number,
    nextAttemptAt: number
  ): Promise<void> {
    this.q.failed.run(nextAttemptAt, keysetId, txId, index);
  }

  async pruneTx(keysetId: string, createdBefore: number): Promise<number> {
    return this.inTransaction(() => {
      this.q.pruneOuts.run(keysetId, keysetId, createdBefore);
      const removed = this.q.pruneTxs.all?.(keysetId, createdBefore) ?? [];
      return removed.length;
    });
  }

  async close(): Promise<void> {
    this.db.close?.();
  }
}
