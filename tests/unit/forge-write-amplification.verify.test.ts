// The test the whole SpentSetStore change exists to pass.
//
// Marking a token spent used to add it to an in-memory Set and then re-serialise
// the ENTIRE forge state through JSON.stringify and write it back whole. The
// blob is not just the spent set — it carries the Bloom filter, tokenUsage,
// pendingTxs and authorizedForgers too — so every spend rewrote everything, and
// the cumulative cost of reaching N spends was O(N^2). Worse, JSON.stringify is
// synchronous, so the stall blocked the event loop and therefore the relay
// subscription: the failure presents as dropped events, not slow responses.
//
// The first test below documents that behaviour still holding for a forge with
// no store configured (which is what keeps existing deployments unchanged). The
// second asserts it is gone once a store is supplied.
import "@tat-protocol/nwpc";
import { FungibleForge } from "@tat-protocol/forge";
import { MemorySpentSetStore } from "@tat-protocol/storage";
import type { StorageInterface, SpentSetStore } from "@tat-protocol/storage";
import { serializeData } from "@tat-protocol/utils";
import { schnorr } from "@noble/curves/secp256k1";
import { bytesToHex } from "@noble/hashes/utils";

const OWNER_SK = "44".repeat(32);
const OWNER = bytesToHex(schnorr.getPublicKey(OWNER_SK));

const hash = (n: number) => n.toString(16).padStart(64, "0");

/** StorageInterface that records how many bytes each write pushed. */
class CountingStore implements StorageInterface {
  private m = new Map<string, string>();
  bytesWritten = 0;
  async getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  async setItem(k: string, v: string) {
    this.bytesWritten += v.length;
    this.m.set(k, v);
  }
  async removeItem(k: string) {
    this.m.delete(k);
  }
  async clear() {
    this.m.clear();
  }
}

async function makeForge(spentSetStore?: SpentSetStore) {
  const storage = new CountingStore();
  const forge = new FungibleForge({
    owner: OWNER,
    keys: { secretKey: OWNER_SK, publicKey: OWNER },
    storage,
    totalSupply: 0,
    relays: [],
    spentSetStore,
  } as any) as any;
  forge.keys = { secretKey: OWNER_SK, publicKey: OWNER };
  forge.getPublicKey = () => OWNER;
  // Capture-and-fail the publish leg so no relay is involved. Publication is
  // fire-and-forget with a catch, so this is invisible to the spend path.
  forge.signer = {
    signEvent: async () => {
      throw new Error("capture-only");
    },
  };
  // The NWPC test mock stubs saveState to a no-op, so with it in place there is
  // nothing to measure. Reinstate what the real NWPCBase.saveState does — run
  // the whole state through serializeData and write the result — because that
  // is the operation whose cost this test is about. (The real one also folds in
  // the Bloom filter, which only makes the blob bigger; leaving it out keeps
  // this a lower bound on the real write.)
  forge.saveState = async (key: string, state: unknown) => {
    await storage.setItem(key || "forge-state", serializeData(state));
  };
  return { forge, storage };
}

/**
 * Spend `count` distinct hashes, returning bytes written during the first and
 * last `window` spends.
 */
async function measure(forge: any, storage: CountingStore, count: number) {
  const window = Math.floor(count / 10);
  let first = 0;
  let last = 0;
  for (let i = 0; i < count; i++) {
    const before = storage.bytesWritten;
    await forge.publishSpentToken(hash(i));
    const cost = storage.bytesWritten - before;
    if (i < window) first += cost;
    if (i >= count - window) last += cost;
  }
  return { first: first / window, last: last / window };
}

describe("write amplification per spend", () => {
  const N = 1500;

  it("grows with the size of the set when no store is configured", async () => {
    // Not a regression to fix — this is the legacy path, kept so that upgrading
    // the SDK changes nothing until a forge opts in. Asserted so that the
    // comparison below is against a real measurement rather than an assumption,
    // and so this test starts failing if the default ever silently changes.
    const { forge, storage } = await makeForge();
    const { first, last } = await measure(forge, storage, N);

    expect(first).toBeGreaterThan(0);
    // Each spend rewrites the whole blob, so the late spends cost far more than
    // the early ones. By 1500 entries the blob is ~10x its starting size.
    expect(last).toBeGreaterThan(first * 5);
  });

  it("is CONSTANT once a SpentSetStore is configured", async () => {
    const { forge, storage } = await makeForge(new MemorySpentSetStore());
    const { first, last } = await measure(forge, storage, N);

    // The spend path no longer writes the blob at all.
    expect(first).toBe(0);
    expect(last).toBe(0);
  });

  it("does not let the blob grow with spends once a store is configured", async () => {
    const store = new MemorySpentSetStore();
    const { forge, storage } = await makeForge(store);

    for (let i = 0; i < 500; i++) {
      await forge.publishSpentToken(hash(i));
    }

    // The hashes are in the store...
    expect(await store.size("default")).toBe(500);
    // ...and none of them are in the state that gets serialised.
    expect(forge.state.spentTokens.size).toBe(0);
    expect(storage.bytesWritten).toBe(0);
  });

  it("still rejects a double spend through the store", async () => {
    // Constant write cost is worthless if the invariant it replaced is gone.
    const { forge } = await makeForge(new MemorySpentSetStore());
    await forge.publishSpentToken(hash(1));
    expect(await forge.isTokenSpent(hash(1))).toBe(true);
    expect(await forge.markTokenSpent(hash(1))).toBe(false);
  });
});

describe("upgrading a forge that already has a spent set", () => {
  it("imports blob spent hashes into the store rather than stranding them", async () => {
    // A running forge accumulated its spent set in blob state. Pointing it at a
    // store without carrying those across would present every previously spent
    // token as unspent — every one replayable. That is a mint, not a migration
    // inconvenience.
    const store = new MemorySpentSetStore();
    const { forge } = await makeForge(store);
    forge.state.spentTokens = new Set([hash(1), hash(2), hash(3)]);

    await forge.importBlobSpentSet();

    for (const h of [hash(1), hash(2), hash(3)]) {
      expect(await forge.isTokenSpent(h)).toBe(true);
    }
    expect(await store.size("default")).toBe(3);
    // ...and the blob copy is dropped, so it stops being rewritten per spend.
    expect(forge.state.spentTokens.size).toBe(0);
  });

  it("is idempotent across restarts", async () => {
    const store = new MemorySpentSetStore();
    await store.tryMarkSpent("default", hash(1));

    const { forge } = await makeForge(store);
    forge.state.spentTokens = new Set([hash(1)]);

    await forge.importBlobSpentSet();
    await forge.importBlobSpentSet();

    expect(await store.size("default")).toBe(1);
    expect(await forge.isTokenSpent(hash(1))).toBe(true);
  });

  it("keeps the rest when one recorded hash is unusable", async () => {
    // One malformed entry must not strand every other spent hash outside the
    // store — that would make the bad entry cost real money.
    const store = new MemorySpentSetStore();
    const { forge } = await makeForge(store);
    forge.state.spentTokens = new Set([hash(1), "not-a-hash", hash(2)]);

    await forge.importBlobSpentSet();

    expect(await forge.isTokenSpent(hash(1))).toBe(true);
    expect(await forge.isTokenSpent(hash(2))).toBe(true);
    expect(await store.size("default")).toBe(2);
  });

  it("does nothing when no store is configured", async () => {
    // The legacy path must be untouched, or upgrading the SDK would silently
    // wipe the spent set of every forge that has not opted in.
    const { forge } = await makeForge();
    forge.state.spentTokens = new Set([hash(1), hash(2)]);

    await forge.importBlobSpentSet();

    expect(forge.state.spentTokens.size).toBe(2);
    expect(await forge.isTokenSpent(hash(1))).toBe(true);
  });

  it("is invoked by _loadState when state was restored", async () => {
    // The import is only worth anything if it actually runs on startup.
    const store = new MemorySpentSetStore();
    const { forge } = await makeForge(store);
    forge.loadState = async () => ({
      owner: OWNER,
      version: 1,
      spentTokens: [hash(1), hash(2)],
    });

    await forge._loadState();

    expect(await forge.isTokenSpent(hash(1))).toBe(true);
    expect(await forge.isTokenSpent(hash(2))).toBe(true);
    expect(forge.state.spentTokens.size).toBe(0);
  });
});
