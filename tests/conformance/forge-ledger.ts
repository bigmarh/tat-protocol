// Executable form of the ForgeLedger contract.
//
// A ledger commits a transfer's spent inputs, its outputs and its outbox rows
// as ONE unit, and a mint's supply reservation and outputs likewise. A backend
// that applies any of those piecemeal passes every single-call test and still
// loses (or duplicates) money on the first crash between two writes — so the
// all-or-nothing cases below are the point of the suite, not an edge of it.
//
// Usage from a test file:
//
//   describeForgeLedgerConformance("MemoryForgeLedger", async () => ({
//     ledger: new MemoryForgeLedger(),
//   }));
import { DEFAULT_KEYSET_ID } from "@tat-protocol/storage";
import type { ForgeLedger, TxRecord } from "@tat-protocol/storage";

export interface ForgeLedgerHarness {
  ledger: ForgeLedger;
  cleanup?: () => Promise<void> | void;
}

const KS = DEFAULT_KEYSET_ID;
const hash = (n: number) => n.toString(16).padStart(64, "0");
const txId = (n: number) => (0xf000 + n).toString(16).padStart(64, "0");

function record(n: number, inputs: number[], createdAt = 1_000_000): TxRecord {
  return {
    txId: txId(n),
    kind: "transfer",
    requestId: `req-${n}`,
    submitter: "a".repeat(64),
    inputHashes: inputs.map(hash),
    outputs: [
      { to: "b".repeat(64), jwt: `jwt-${n}-0` },
      { to: "c".repeat(64), jwt: `jwt-${n}-1` },
    ],
    createdAt,
  };
}

export function describeForgeLedgerConformance(
  name: string,
  makeHarness: () => Promise<ForgeLedgerHarness>,
) {
  describe(`ForgeLedger conformance: ${name}`, () => {
    let harness: ForgeLedgerHarness;
    let ledger: ForgeLedger;

    beforeEach(async () => {
      harness = await makeHarness();
      ledger = harness.ledger;
    });
    afterEach(async () => {
      await harness.cleanup?.();
    });

    describe("commitTransfer", () => {
      it("marks every input spent and records the tx and its outbox", async () => {
        expect(await ledger.commitTransfer(KS, record(1, [1, 2]))).toEqual({ ok: true });
        expect(await ledger.spentSet.isSpent(KS, hash(1))).toBe(true);
        expect(await ledger.spentSet.isSpent(KS, hash(2))).toBe(true);
        const stored = await ledger.getTx(KS, txId(1));
        expect(stored?.outputs.map((o) => [o.to, o.jwt, o.delivered])).toEqual([
          ["b".repeat(64), "jwt-1-0", false],
          ["c".repeat(64), "jwt-1-1", false],
        ]);
        expect(await ledger.pendingDeliveries(KS, { now: 2_000_000, createdAfter: 0 })).toHaveLength(2);
      });

      it("applies NOTHING when any input is already spent", async () => {
        await ledger.spentSet.tryMarkSpent(KS, hash(2));
        const result = await ledger.commitTransfer(KS, record(1, [1, 2, 3]));
        expect(result).toEqual({ ok: false, reason: "spent", spent: [hash(2)] });
        // The unspent inputs are still spendable, and no outputs exist.
        expect(await ledger.spentSet.isSpent(KS, hash(1))).toBe(false);
        expect(await ledger.spentSet.isSpent(KS, hash(3))).toBe(false);
        expect(await ledger.getTx(KS, txId(1))).toBeNull();
        expect(await ledger.pendingDeliveries(KS, { now: 2_000_000, createdAfter: 0 })).toHaveLength(0);
      });

      it("returns the existing record for a tx id it has already committed", async () => {
        await ledger.commitTransfer(KS, record(1, [1]));
        const again = await ledger.commitTransfer(KS, record(1, [1]));
        expect(again.ok).toBe(false);
        expect(again.ok === false && again.reason).toBe("duplicate");
        expect(again.ok === false && again.reason === "duplicate" && again.existing.txId).toBe(txId(1));
      });

      it("lets exactly one of two racing commits over the same input win", async () => {
        const results = await Promise.all([
          ledger.commitTransfer(KS, record(1, [7])),
          ledger.commitTransfer(KS, record(2, [7])),
        ]);
        expect(results.filter((r) => r.ok)).toHaveLength(1);
      });

      it("refuses a malformed input hash without applying the others", async () => {
        const bad = { ...record(1, [1]), inputHashes: [hash(1), "not-hex"] };
        await expect(ledger.commitTransfer(KS, bad)).rejects.toThrow();
        expect(await ledger.spentSet.isSpent(KS, hash(1))).toBe(false);
        expect(await ledger.getTx(KS, txId(1))).toBeNull();
      });
    });

    describe("commitMint", () => {
      const mint = (n: number): TxRecord => ({ ...record(n, []), kind: "mint", outputs: [{ to: "b".repeat(64), jwt: `m-${n}` }] });

      it("reserves supply and records the output together", async () => {
        await ledger.supply.setMaxSupply(KS, 100);
        expect(await ledger.commitMint(KS, mint(1), 60)).toEqual({ ok: true, issued: 60 });
        expect(await ledger.supply.getIssued(KS)).toBe(60);
        expect((await ledger.getTx(KS, txId(1)))?.outputs[0].jwt).toBe("m-1");
      });

      it("records nothing when the cap would be exceeded", async () => {
        await ledger.supply.setMaxSupply(KS, 100);
        expect(await ledger.commitMint(KS, mint(1), 101)).toEqual({ ok: false, reason: "over-cap" });
        expect(await ledger.supply.getIssued(KS)).toBe(0);
        expect(await ledger.getTx(KS, txId(1))).toBeNull();
      });

      it("does not reserve twice for a duplicate mint id", async () => {
        await ledger.commitMint(KS, mint(1), 10);
        const again = await ledger.commitMint(KS, mint(1), 10);
        expect(again.ok === false && again.reason).toBe("duplicate");
        expect(await ledger.supply.getIssued(KS)).toBe(10);
      });
    });

    describe("outbox", () => {
      it("hides delivered outputs and ones not yet due", async () => {
        await ledger.commitTransfer(KS, record(1, [1]));
        await ledger.markDelivered(KS, txId(1), 0, 1_000_001);
        await ledger.recordFailedAttempt(KS, txId(1), 1, 5_000_000);

        expect(await ledger.pendingDeliveries(KS, { now: 4_999_999, createdAfter: 0 })).toEqual([]);
        const due = await ledger.pendingDeliveries(KS, { now: 5_000_000, createdAfter: 0 });
        expect(due).toHaveLength(1);
        expect(due[0]).toMatchObject({ txId: txId(1), index: 1, jwt: "jwt-1-1", requestId: "req-1", attempts: 1 });
        expect((await ledger.getTx(KS, txId(1)))?.outputs[0].delivered).toBe(true);
      });

      it("stops offering outputs older than createdAfter", async () => {
        await ledger.commitTransfer(KS, record(1, [1], 1_000));
        expect(await ledger.pendingDeliveries(KS, { now: 10_000, createdAfter: 1_000 })).toEqual([]);
        expect(await ledger.pendingDeliveries(KS, { now: 10_000, createdAfter: 999 })).toHaveLength(2);
      });
    });

    describe("pruneTx", () => {
      it("drops old records but never un-spends their inputs", async () => {
        await ledger.commitTransfer(KS, record(1, [1], 1_000));
        await ledger.commitTransfer(KS, record(2, [2], 5_000));
        expect(await ledger.pruneTx(KS, 2_000)).toBe(1);
        expect(await ledger.getTx(KS, txId(1))).toBeNull();
        expect(await ledger.getTx(KS, txId(2))).not.toBeNull();
        expect(await ledger.spentSet.isSpent(KS, hash(1))).toBe(true);
        expect(await ledger.pendingDeliveries(KS, { now: 10_000, createdAfter: 0 })).toHaveLength(2);
      });
    });
  });
}
