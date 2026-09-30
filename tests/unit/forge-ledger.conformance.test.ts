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
