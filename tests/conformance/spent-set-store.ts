// Executable form of the SpentSetStore conformance contract.
//
// This is deliberately NOT a SQLite test. Any backend an operator brings — a
// different embedded engine, Postgres, an object store with conditional writes
// — must pass this suite unmodified, because it is the only thing separating a
// conformant store from one that races under load it has not yet seen. A
// backend built on a KV store with no compare-and-set primitive passes every
// other test you might write and fails this one.
//
// Usage from a test file:
//
//   describeSpentSetStoreConformance("MemorySpentSetStore", async () => ({
//     store: new MemorySpentSetStore(),
//   }));
import { DEFAULT_KEYSET_ID } from "@tat-protocol/storage";
import type { SpentSetStore } from "@tat-protocol/storage";

export interface ConformanceHarness {
  store: SpentSetStore;
  /** Optional teardown, e.g. closing a file handle. */
  cleanup?: () => Promise<void> | void;
}

const hash = (n: number) => n.toString(16).padStart(64, "0");
const KS = DEFAULT_KEYSET_ID;

export function describeSpentSetStoreConformance(
  name: string,
  makeHarness: () => Promise<ConformanceHarness>,
) {
  describe(`SpentSetStore conformance: ${name}`, () => {
    let harness: ConformanceHarness;
    let store: SpentSetStore;

    beforeEach(async () => {
      harness = await makeHarness();
      store = harness.store;
    });

    afterEach(async () => {
      await harness.cleanup?.();
    });

    describe("atomicity", () => {
      it("marks an unseen hash and reports it as newly spent", async () => {
        expect(await store.tryMarkSpent(KS, hash(1))).toBe(true);
      });

      it("refuses the second attempt on the same hash", async () => {
        await store.tryMarkSpent(KS, hash(1));
        expect(await store.tryMarkSpent(KS, hash(1))).toBe(false);
      });

      it("returns already-spent as a value, never as a throw", async () => {
        await store.tryMarkSpent(KS, hash(1));
        // A double-spend attempt is an ordinary outcome the forge must be able
        // to turn into a TOKEN_SPENT response, not an exceptional condition.
        await expect(store.tryMarkSpent(KS, hash(1))).resolves.toBe(false);
      });

      it("admits EXACTLY ONE winner among concurrent spends of one hash", async () => {
        // The property the whole interface exists for. Fired without awaiting
        // in between, so the calls genuinely overlap rather than queueing.
        const attempts = Array.from({ length: 1000 }, () =>
          store.tryMarkSpent(KS, hash(7)),
        );
        const results = await Promise.all(attempts);
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(results.filter((r) => !r)).toHaveLength(999);
      });

      it("admits exactly one winner per hash across many interleaved hashes", async () => {
        // Same property, but with the calls for different hashes interleaved,
        // so a backend that accidentally serialises on a single global key is
        // not mistaken for a correct one.
        const hashes = Array.from({ length: 50 }, (_, i) => hash(100 + i));
        const attempts = hashes.flatMap((h) =>
          Array.from({ length: 20 }, () => store.tryMarkSpent(KS, h)),
        );
        const results = await Promise.all(attempts);
        expect(results.filter(Boolean)).toHaveLength(hashes.length);
      });
    });

    describe("linearizability", () => {
      it("never reports a hash as unspent after tryMarkSpent returned true", async () => {
        await store.tryMarkSpent(KS, hash(2));
        expect(await store.isSpent(KS, hash(2))).toBe(true);
      });

      it("makes the mark visible to a batch read immediately", async () => {
        await store.tryMarkSpent(KS, hash(3));
        const states = await store.getStates(KS, [hash(3), hash(4)]);
        expect(states[hash(3)]).toBe(true);
        expect(states[hash(4)]).toBe(false);
      });

      it("makes the mark visible to the loser of a concurrent race", async () => {
        const [a, b] = await Promise.all([
          store.tryMarkSpent(KS, hash(5)),
          store.tryMarkSpent(KS, hash(5)),
        ]);
        expect([a, b].filter(Boolean)).toHaveLength(1);
        expect(await store.isSpent(KS, hash(5))).toBe(true);
      });
    });

    describe("reads do not mutate", () => {
      it("isSpent leaves an unspent hash spendable", async () => {
        expect(await store.isSpent(KS, hash(6))).toBe(false);
        expect(await store.isSpent(KS, hash(6))).toBe(false);
        expect(await store.tryMarkSpent(KS, hash(6))).toBe(true);
      });

      it("getStates leaves unspent hashes spendable", async () => {
        await store.getStates(KS, [hash(8), hash(9)]);
        expect(await store.tryMarkSpent(KS, hash(8))).toBe(true);
        expect(await store.tryMarkSpent(KS, hash(9))).toBe(true);
      });

      it("getStates keys the result by the hashes given, not by position", async () => {
        await store.tryMarkSpent(KS, hash(10));
        const states = await store.getStates(KS, [hash(11), hash(10)]);
        expect(states).toEqual({ [hash(11)]: false, [hash(10)]: true });
      });

      it("returns an empty result for an empty query", async () => {
        expect(await store.getStates(KS, [])).toEqual({});
      });
    });

    describe("keyset isolation", () => {
      it("keeps the same hash independent across keysets", async () => {
        // Not a double-spend: a hash commits to its payload, so the same hash
        // under two keysets cannot arise from two real tokens. This asserts the
        // dimension is wired through rather than ignored, so that landing epoch
        // keysets later is additive.
        expect(await store.tryMarkSpent("keyset-a", hash(12))).toBe(true);
        expect(await store.tryMarkSpent("keyset-b", hash(12))).toBe(true);
        expect(await store.isSpent("keyset-a", hash(12))).toBe(true);
        expect(await store.isSpent("keyset-b", hash(12))).toBe(true);
      });

      it("does not leak membership across keysets", async () => {
        await store.tryMarkSpent("keyset-a", hash(13));
        expect(await store.isSpent("keyset-b", hash(13))).toBe(false);
      });

      it("counts per keyset", async () => {
        await store.tryMarkSpent("keyset-a", hash(14));
        await store.tryMarkSpent("keyset-a", hash(15));
        await store.tryMarkSpent("keyset-b", hash(16));
        expect(await store.size("keyset-a")).toBe(2);
        expect(await store.size("keyset-b")).toBe(1);
      });

      it("reports zero for a keyset never written to", async () => {
        expect(await store.size("never-used")).toBe(0);
      });
    });

    describe("hash handling", () => {
      it("treats hex case as the same hash", async () => {
        // Or a caller normalising differently could spend the same token twice.
        const lower = "ab".repeat(32);
        expect(await store.tryMarkSpent(KS, lower)).toBe(true);
        expect(await store.tryMarkSpent(KS, lower.toUpperCase())).toBe(false);
      });

      it("keeps hashes that share a prefix distinct", async () => {
        const a = "c".repeat(63) + "1";
        const b = "c".repeat(63) + "2";
        expect(await store.tryMarkSpent(KS, a)).toBe(true);
        expect(await store.tryMarkSpent(KS, b)).toBe(true);
        expect(await store.size(KS)).toBe(2);
      });

      it("rejects a malformed hash rather than storing a different key", async () => {
        // Coercing a bad hash would key the row differently from the real
        // token, which lets an already-spent token through on the next attempt.
        await expect(store.tryMarkSpent(KS, "nothex!!")).rejects.toThrow(
          /not hex/i,
        );
        await expect(store.tryMarkSpent(KS, "abc")).rejects.toThrow(/not hex/i);
        await expect(store.tryMarkSpent(KS, "")).rejects.toThrow(/not hex/i);
      });
    });

    describe("accumulation", () => {
      it("holds many hashes without losing any", async () => {
        const n = 2000;
        for (let i = 0; i < n; i++) {
          expect(await store.tryMarkSpent(KS, hash(1000 + i))).toBe(true);
        }
        expect(await store.size(KS)).toBe(n);
        // Spot-check the ends and the middle rather than all 2000.
        for (const i of [0, n / 2, n - 1]) {
          expect(await store.isSpent(KS, hash(1000 + i))).toBe(true);
        }
        expect(await store.isSpent(KS, hash(999))).toBe(false);
      });
    });
  });
}
