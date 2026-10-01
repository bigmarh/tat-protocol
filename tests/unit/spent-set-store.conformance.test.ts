// Runs the backend-agnostic SpentSetStore conformance suite against every
// backend that ships with the SDK. Adding a backend means adding a block here
// and changing nothing in the suite itself.
import { describeSpentSetStoreConformance } from "../conformance/spent-set-store.js";
import {
  MemorySpentSetStore,
  SqliteSpentSetStore,
} from "@tat-protocol/storage";
import type { SqliteDatabaseHandle } from "@tat-protocol/storage";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describeSpentSetStoreConformance("MemorySpentSetStore", async () => ({
  store: new MemorySpentSetStore(),
}));

// In-memory SQLite: exercises the real SQL, the real uniqueness constraint and
// the real ON CONFLICT ... RETURNING path without touching disk.
describeSpentSetStoreConformance("SqliteSpentSetStore (:memory:)", async () => {
  const db = new DatabaseSync(":memory:") as unknown as SqliteDatabaseHandle;
  // WAL is meaningless for :memory: and SQLite refuses it, so configure the
  // rest by hand. The on-disk block below is what covers the real PRAGMA path.
  db.exec("PRAGMA busy_timeout = 5000");
  const store = new SqliteSpentSetStore(db, { skipPragmas: true });
  return { store, cleanup: () => store.close() };
});

// On-disk SQLite: the configuration a forge actually runs, PRAGMAs included.
describeSpentSetStoreConformance("SqliteSpentSetStore (file, WAL)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tat-spentset-"));
  const db = new DatabaseSync(
    join(dir, "forge.db"),
  ) as unknown as SqliteDatabaseHandle;
  const store = new SqliteSpentSetStore(db);
  return {
    store,
    cleanup: async () => {
      await store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
});

describe("SqliteSpentSetStore configuration", () => {
  const open = () => {
    const dir = mkdtempSync(join(tmpdir(), "tat-spentset-cfg-"));
    const db = new DatabaseSync(join(dir, "forge.db"));
    return { db, dir };
  };

  it("runs in WAL mode with synchronous=FULL", () => {
    const { db, dir } = open();
    try {
      new SqliteSpentSetStore(db as unknown as SqliteDatabaseHandle);
      const journal = db.prepare("PRAGMA journal_mode").get() as {
        journal_mode: string;
      };
      const sync = db.prepare("PRAGMA synchronous").get() as {
        synchronous: number;
      };
      expect(journal.journal_mode).toBe("wal");
      // 2 == FULL. NORMAL (1) survives an application crash but not power loss,
      // which would violate durable-before-resolve.
      expect(sync.synchronous).toBe(2);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stores hashes as 32 raw bytes, not 64 hex characters", async () => {
    const { db, dir } = open();
    try {
      const store = new SqliteSpentSetStore(
        db as unknown as SqliteDatabaseHandle,
      );
      await store.tryMarkSpent("ks", "ab".repeat(32));
      const row = db
        .prepare("SELECT length(token_hash) AS len FROM spent")
        .get() as { len: number };
      expect(row.len).toBe(32);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("survives reopening the same file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tat-spentset-reopen-"));
    const path = join(dir, "forge.db");
    try {
      const first = new SqliteSpentSetStore(
        new DatabaseSync(path) as unknown as SqliteDatabaseHandle,
      );
      expect(await first.tryMarkSpent("ks", "cd".repeat(32))).toBe(true);
      await first.close();

      // A restart must not make an already-spent input replayable.
      const second = new SqliteSpentSetStore(
        new DatabaseSync(path) as unknown as SqliteDatabaseHandle,
      );
      expect(await second.isSpent("ks", "cd".repeat(32))).toBe(true);
      expect(await second.tryMarkSpent("ks", "cd".repeat(32))).toBe(false);
      await second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
