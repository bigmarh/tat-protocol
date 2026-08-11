import { SpentSetStore, normalizeTokenHash } from './SpentSetStore.js';

/**
 * Minimal shape of a synchronous SQLite driver.
 *
 * The driver is INJECTED rather than imported, so this package gains no native
 * dependency and downstream consumers are not forced to compile one to install
 * the SDK. Both `node:sqlite` (built in from Node 22) and `better-sqlite3`
 * satisfy this shape:
 *
 * ```ts
 * import { DatabaseSync } from "node:sqlite";
 * const store = new SqliteSpentSetStore(new DatabaseSync("forge.db"));
 * ```
 * ```ts
 * import Database from "better-sqlite3";
 * const store = new SqliteSpentSetStore(new Database("forge.db"));
 * ```
 */
export interface SqliteDatabaseHandle {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatementHandle;
  close?(): void;
}

export interface SqliteStatementHandle {
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
  all?(...params: unknown[]): unknown[];
}

export interface SqliteSpentSetStoreOptions {
  /**
   * Skip the PRAGMA setup. Only for a caller that has already configured the
   * connection and accepts responsibility for meeting the durability contract.
   */
  skipPragmas?: boolean;
}

/**
 * SQLite-backed {@link SpentSetStore}.
 *
 * The whole spend operation is one statement:
 *
 * ```sql
 * INSERT INTO spent (keyset_id, token_hash, spent_at) VALUES (?, ?, ?)
 * ON CONFLICT DO NOTHING RETURNING 1;
 * ```
 *
 * A returned row means this call marked it; no row means it was already spent.
 * The double-spend rejection is therefore a uniqueness constraint the engine
 * evaluates, not a check-then-act sequence in application code — it cannot be
 * lost to a refactor, a new code path, or a concurrency mistake, and it holds
 * across processes rather than within one.
 */
export class SqliteSpentSetStore implements SpentSetStore {
  private db: SqliteDatabaseHandle;
  private insert: SqliteStatementHandle;
  private select: SqliteStatementHandle;
  private count: SqliteStatementHandle;

  constructor(db: SqliteDatabaseHandle, options: SqliteSpentSetStoreOptions = {}) {
    this.db = db;

    if (!options.skipPragmas) {
      // WAL: concurrent readers alongside the single writer.
      //
      // synchronous = FULL, deliberately, and it must stay that way. NORMAL
      // survives an application crash but NOT OS or power loss — committed
      // transactions can be lost from the WAL, which violates the
      // durable-before-resolve property and reopens exactly the replay hole the
      // spent set exists to close. It will look like an easy performance win to
      // someone later; it is not one to take on the table holding money.
      this.db.exec('PRAGMA journal_mode = WAL');
      this.db.exec('PRAGMA synchronous = FULL');
      this.db.exec('PRAGMA busy_timeout = 5000');
    }

    // WITHOUT ROWID: the primary key IS the storage, so SQLite skips the
    // separate rowid table and its index — roughly half the size and one less
    // indirection. This is the case the SQLite docs specifically recommend it
    // for: a short composite key that is the whole row.
    //
    // token_hash is stored as a 32-byte BLOB rather than 64 hex characters.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS spent (
        keyset_id  TEXT NOT NULL,
        token_hash BLOB NOT NULL,
        spent_at   INTEGER NOT NULL,
        PRIMARY KEY (keyset_id, token_hash)
      ) WITHOUT ROWID
    `);

    this.insert = this.db.prepare(
      `INSERT INTO spent (keyset_id, token_hash, spent_at)
       VALUES (?, ?, ?)
       ON CONFLICT DO NOTHING
       RETURNING 1 AS marked`
    );
    this.select = this.db.prepare(
      `SELECT 1 AS found FROM spent WHERE keyset_id = ? AND token_hash = ?`
    );
    this.count = this.db.prepare(`SELECT COUNT(*) AS n FROM spent WHERE keyset_id = ?`);
  }

  /**
   * Hex hash to the raw bytes actually stored. Canonicalisation is shared with
   * every other backend via normalizeTokenHash, so they cannot drift on what
   * counts as the same hash.
   */
  private toBytes(tokenHash: string): Uint8Array {
    const normalized = normalizeTokenHash(tokenHash);
    const bytes = new Uint8Array(normalized.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(normalized.substr(i * 2, 2), 16);
    }
    return bytes;
  }

  async tryMarkSpent(keysetId: string, tokenHash: string): Promise<boolean> {
    const row = this.insert.get(keysetId, this.toBytes(tokenHash), Math.floor(Date.now() / 1000));
    // A row back means this call won the insert. No row means the hash was
    // already present, i.e. a double-spend attempt.
    return row !== undefined && row !== null;
  }

  async isSpent(keysetId: string, tokenHash: string): Promise<boolean> {
    const row = this.select.get(keysetId, this.toBytes(tokenHash));
    return row !== undefined && row !== null;
  }

  async getStates(keysetId: string, tokenHashes: string[]): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    for (const hash of tokenHashes) {
      out[hash] = await this.isSpent(keysetId, hash);
    }
    return out;
  }

  async size(keysetId: string): Promise<number> {
    const row = this.count.get(keysetId) as { n?: number } | undefined;
    return Number(row?.n ?? 0);
  }

  async close(): Promise<void> {
    this.db.close?.();
  }
}
