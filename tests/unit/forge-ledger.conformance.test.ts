// Runs the ForgeLedger conformance suite against every ledger the SDK ships.
import { describeForgeLedgerConformance } from "../conformance/forge-ledger.js";
import { MemoryForgeLedger, SqliteForgeLedger } from "@tat-protocol/storage";
import type { SqliteDatabaseHandle } from "@tat-protocol/storage";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describeForgeLedgerConformance("MemoryForgeLedger", async () => ({
  ledger: new MemoryForgeLedger(),
}));

describeForgeLedgerConformance("SqliteForgeLedger (file, WAL)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tat-ledger-conf-"));
  const db = new DatabaseSync(join(dir, "forge.db")) as unknown as SqliteDatabaseHandle;
  const ledger = new SqliteForgeLedger(db);
  return {
    ledger,
    cleanup: async () => {
      await ledger.close?.();
      rmSync(dir, { recursive: true, force: true });
    },
  };
});

describe("SqliteForgeLedger durability", () => {
  it("keeps a committed transfer across reopening the file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tat-ledger-reopen-"));
    const path = join(dir, "forge.db");
    const h = "ab".repeat(32);
    const id = "cd".repeat(32);
    try {
      const first = new SqliteForgeLedger(new DatabaseSync(path) as unknown as SqliteDatabaseHandle);
      await first.commitTransfer("default", {
        txId: id,
        kind: "transfer",
        requestId: "r",
        submitter: "a".repeat(64),
        inputHashes: [h],
        outputs: [{ to: "b".repeat(64), jwt: "j" }],
        createdAt: 1,
      });
      await first.close?.();

      const second = new SqliteForgeLedger(new DatabaseSync(path) as unknown as SqliteDatabaseHandle);
      expect(await second.spentSet.isSpent("default", h)).toBe(true);
      expect((await second.getTx("default", id))?.outputs[0].jwt).toBe("j");
      await second.close?.();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("SqliteForgeLedger schema upgrade", () => {
  it("adds outs_hash to a tx_record table created before it existed", async () => {
    const db = new DatabaseSync(":memory:") as unknown as SqliteDatabaseHandle;
    db.exec(`
      CREATE TABLE tx_record (
        keyset_id TEXT NOT NULL, tx_id TEXT NOT NULL, kind TEXT NOT NULL,
        request_id TEXT NOT NULL, submitter TEXT NOT NULL, input_hashes TEXT NOT NULL,
        created_at INTEGER NOT NULL, PRIMARY KEY (keyset_id, tx_id)
      ) WITHOUT ROWID
    `);
    const ledger = new SqliteForgeLedger(db, { skipPragmas: true });
    await ledger.commitTransfer("default", {
      txId: "ef".repeat(32),
      kind: "transfer",
      requestId: "r",
      submitter: "a".repeat(64),
      inputHashes: ["12".repeat(32)],
      outsHash: "34".repeat(32),
      outputs: [{ to: "b".repeat(64), jwt: "j" }],
      createdAt: 1,
    });
    expect((await ledger.getTx("default", "ef".repeat(32)))?.outsHash).toBe("34".repeat(32));
  });
});

describe("SqliteForgeLedger driver requirements", () => {
  it("refuses a driver without statement.all() up front, instead of silently losing outputs", () => {
    // The ledger reads outputs and the outbox with .all(). A driver without
    // it used to make those reads return nothing — and made the schema check
    // think outs_hash was missing, re-adding it and crashing on a fresh DB.
    const real = new DatabaseSync(":memory:");
    const getOnly = {
      exec: (sql: string) => real.exec(sql),
      prepare: (sql: string) => {
        const st = real.prepare(sql);
        return { get: (...a: unknown[]) => st.get(...(a as [])), run: (...a: unknown[]) => st.run(...(a as [])) };
      },
    } as unknown as SqliteDatabaseHandle;
    expect(() => new SqliteForgeLedger(getOnly, { skipPragmas: true })).toThrow(/all\(\)/);
  });

  it("opens a fresh database twice without re-adding outs_hash", () => {
    const db = new DatabaseSync(":memory:") as unknown as SqliteDatabaseHandle;
    new SqliteForgeLedger(db, { skipPragmas: true });
    expect(() => new SqliteForgeLedger(db, { skipPragmas: true })).not.toThrow();
  });
});
