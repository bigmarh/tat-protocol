import { ProcessedRequestStore } from './ProcessedRequestStore.js';
import type { SqliteDatabaseHandle, SqliteSpentSetStoreOptions } from './SqliteSpentSetStore.js';

/**
 * SQLite-backed {@link ProcessedRequestStore}.
 *
 * The claim is one statement:
 *
 * ```sql
 * INSERT INTO processed_request (event_id, claimed_at) VALUES (?, ?)
 * ON CONFLICT DO NOTHING RETURNING 1;
 * ```
 *
 * so "have I already handled this request" is a uniqueness constraint the
 * engine evaluates rather than a check the application performs, and it holds
 * across processes instead of within one. That is the property the Bloom filter
 * never had: it lived in process memory, so N forge replicas would each dedup
 * against their own filter and none against the others.
 *
 * Takes the same injected driver handle as SqliteSpentSetStore, so the two can
 * share one connection — which is what makes it possible to claim a request and
 * mark its inputs spent in a single transaction later.
 */
export class SqliteProcessedRequestStore implements ProcessedRequestStore {
  private db: SqliteDatabaseHandle;
  private insert: ReturnType<SqliteDatabaseHandle['prepare']>;
  private select: ReturnType<SqliteDatabaseHandle['prepare']>;
  private setResponse: ReturnType<SqliteDatabaseHandle['prepare']>;
  private deleteOld: ReturnType<SqliteDatabaseHandle['prepare']>;
  private count: ReturnType<SqliteDatabaseHandle['prepare']>;

  constructor(db: SqliteDatabaseHandle, options: SqliteSpentSetStoreOptions = {}) {
    this.db = db;

    if (!options.skipPragmas) {
      // synchronous = FULL for the same reason as the spent set: NORMAL can
      // lose committed transactions to power loss, and a lost claim is a
      // replayable mint on restart.
      this.db.exec('PRAGMA journal_mode = WAL');
      this.db.exec('PRAGMA synchronous = FULL');
      this.db.exec('PRAGMA busy_timeout = 5000');
    }

    // `response` is written but not yet read back — see recordResponse.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS processed_request (
        event_id   TEXT    NOT NULL PRIMARY KEY,
        claimed_at INTEGER NOT NULL,
        response   TEXT
      ) WITHOUT ROWID
    `);
    // Pruning is by age, so it needs an index on the age column or it degrades
    // into a full scan of exactly the table we are keeping large on purpose.
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS processed_request_by_age
         ON processed_request (claimed_at)`
    );

    this.insert = this.db.prepare(
      `INSERT INTO processed_request (event_id, claimed_at)
       VALUES (?, ?)
       ON CONFLICT DO NOTHING
       RETURNING 1 AS claimed`
    );
    this.select = this.db.prepare(`SELECT 1 AS found FROM processed_request WHERE event_id = ?`);
    this.setResponse = this.db.prepare(
      `UPDATE processed_request SET response = ? WHERE event_id = ?`
    );
    this.deleteOld = this.db.prepare(`DELETE FROM processed_request WHERE claimed_at < ?`);
    this.count = this.db.prepare(`SELECT COUNT(*) AS n FROM processed_request`);
  }

  private assertEventId(eventId: string): string {
    // Nostr event ids are 32-byte hex. Rejecting anything else keeps a
    // malformed id from claiming a row that a real id can never match, which
    // would let the real event through unclaimed.
    if (typeof eventId !== 'string' || !/^[0-9a-fA-F]{64}$/.test(eventId)) {
      throw new Error(`ProcessedRequestStore: not a Nostr event id: ${String(eventId)}`);
    }
    return eventId.toLowerCase();
  }

  async tryClaim(eventId: string, now = Date.now()): Promise<boolean> {
    const row = this.insert.get(this.assertEventId(eventId), Math.floor(now / 1000));
    // A row back means this call claimed it; no row means it was already taken.
    return row !== undefined && row !== null;
  }

  async recordResponse(eventId: string, response: string): Promise<void> {
    this.setResponse.run(response, this.assertEventId(eventId));
  }

  async isClaimed(eventId: string): Promise<boolean> {
    const row = this.select.get(this.assertEventId(eventId));
    return row !== undefined && row !== null;
  }

  async prune(olderThanSeconds: number, now = Date.now()): Promise<number> {
    const before = await this.size();
    this.deleteOld.run(Math.floor(now / 1000) - olderThanSeconds);
    return before - (await this.size());
  }

  async size(): Promise<number> {
    const row = this.count.get() as { n?: number } | undefined;
    return Number(row?.n ?? 0);
  }

  async close(): Promise<void> {
    this.db.close?.();
  }
}
