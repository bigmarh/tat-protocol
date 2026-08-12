import { SupplyStore } from './SupplyStore.js';
import type { SqliteDatabaseHandle, SqliteSpentSetStoreOptions } from './SqliteSpentSetStore.js';

/**
 * SQLite-backed {@link SupplyStore}.
 *
 * The cap is a CHECK constraint, and the issue is a single statement:
 *
 * ```sql
 * UPDATE supply SET issued = issued + ? WHERE keyset_id = ? RETURNING issued;
 * ```
 *
 * If the new total would breach `max_supply` the engine aborts the statement at
 * the CHECK. That is the point: there is no code path in which the application
 * compares a number it is holding against a cap, so N processes cannot each
 * conclude independently that they are under it. The constraint serialises the
 * one row every issuance touches — real contention, and worth far more than the
 * concurrency it costs, since a mint that outgrows one row of contention is a
 * mint that should be splitting rather than optimising.
 */
export class SqliteSupplyStore implements SupplyStore {
  private db: SqliteDatabaseHandle;
  private ensureRow: ReturnType<SqliteDatabaseHandle['prepare']>;
  private issue: ReturnType<SqliteDatabaseHandle['prepare']>;
  private redeem: ReturnType<SqliteDatabaseHandle['prepare']>;
  private bumpAssetId: ReturnType<SqliteDatabaseHandle['prepare']>;
  private read: ReturnType<SqliteDatabaseHandle['prepare']>;
  private writeCap: ReturnType<SqliteDatabaseHandle['prepare']>;

  constructor(db: SqliteDatabaseHandle, options: SqliteSpentSetStoreOptions = {}) {
    this.db = db;

    if (!options.skipPragmas) {
      // FULL for the same reason as everywhere else money is written: NORMAL
      // can lose a committed transaction to power loss, and a lost issuance is
      // headroom handed back to the mint above its own cap.
      this.db.exec('PRAGMA journal_mode = WAL');
      this.db.exec('PRAGMA synchronous = FULL');
      this.db.exec('PRAGMA busy_timeout = 5000');
    }

    // `issued` is REAL because Payload.amount is a JavaScript number. See the
    // note on amounts in SupplyStore.ts — the real fix is integers of a minor
    // unit in the token format, which is not a storage decision.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS supply (
        keyset_id     TEXT PRIMARY KEY,
        issued        REAL    NOT NULL DEFAULT 0,
        next_asset_id INTEGER NOT NULL DEFAULT 0,
        max_supply    REAL,
        CHECK (max_supply IS NULL OR issued <= max_supply)
      ) WITHOUT ROWID
    `);

    this.ensureRow = this.db.prepare(
      `INSERT INTO supply (keyset_id) VALUES (?) ON CONFLICT DO NOTHING`
    );
    this.issue = this.db.prepare(
      `UPDATE supply SET issued = issued + ? WHERE keyset_id = ? RETURNING issued`
    );
    this.redeem = this.db.prepare(
      `UPDATE supply SET issued = MAX(0, issued - ?) WHERE keyset_id = ? RETURNING issued`
    );
    this.bumpAssetId = this.db.prepare(
      `UPDATE supply SET next_asset_id = next_asset_id + 1
        WHERE keyset_id = ? RETURNING next_asset_id - 1 AS allocated`
    );
    this.read = this.db.prepare(`SELECT issued, max_supply FROM supply WHERE keyset_id = ?`);
    this.writeCap = this.db.prepare(`UPDATE supply SET max_supply = ? WHERE keyset_id = ?`);
  }

  private assertAmount(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(`SupplyStore: amount must be positive and finite: ${amount}`);
    }
  }

  async tryIssue(keysetId: string, amount: number): Promise<number | null> {
    this.assertAmount(amount);
    this.ensureRow.run(keysetId);
    try {
      const row = this.issue.get(amount, keysetId) as { issued?: number } | undefined;
      return row?.issued ?? null;
    } catch (err) {
      // The CHECK aborted the statement, so nothing was written and the cap
      // held. Distinguish it from a genuine storage fault rather than treating
      // every failure as "cap reached", which would hide a broken database
      // behind a business-looking response.
      if (/CHECK constraint/i.test(String(err))) return null;
      throw err;
    }
  }

  async recordRedemption(keysetId: string, amount: number): Promise<number> {
    this.assertAmount(amount);
    this.ensureRow.run(keysetId);
    const row = this.redeem.get(amount, keysetId) as { issued?: number } | undefined;
    return Number(row?.issued ?? 0);
  }

  async nextAssetId(keysetId: string): Promise<number> {
    this.ensureRow.run(keysetId);
    const row = this.bumpAssetId.get(keysetId) as { allocated?: number } | undefined;
    return Number(row?.allocated ?? 0);
  }

  async getIssued(keysetId: string): Promise<number> {
    const row = this.read.get(keysetId) as { issued?: number } | undefined;
    return Number(row?.issued ?? 0);
  }

  async getMaxSupply(keysetId: string): Promise<number | null> {
    const row = this.read.get(keysetId) as { max_supply?: number | null } | undefined;
    const cap = row?.max_supply;
    return cap === undefined || cap === null ? null : Number(cap);
  }

  async setMaxSupply(keysetId: string, maxSupply: number | null): Promise<void> {
    this.ensureRow.run(keysetId);
    const issued = await this.getIssued(keysetId);
    if (maxSupply !== null && maxSupply < issued) {
      // Letting this through would leave the row violating its own CHECK, so
      // every later issue would abort with no way to recover the mint.
      throw new Error(`SupplyStore: cap ${maxSupply} is below the ${issued} already issued`);
    }
    this.writeCap.run(maxSupply, keysetId);
  }

  async close(): Promise<void> {
    this.db.close?.();
  }
}
