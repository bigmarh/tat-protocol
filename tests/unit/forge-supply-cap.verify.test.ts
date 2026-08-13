// The supply cap under concurrency.
//
// The cap used to be enforced by application code: read circulatingSupply,
// compare it against totalSupply, write it back. That is a read-compare-write.
// With one process it is correct. With N, every process reads the same value,
// every one concludes it is under the cap, and the mint collectively over-issues
// by up to N times the headroom — while each process believes it obeyed the
// limit. No lock repairs it, because the processes do not share one.
//
// The first block below demonstrates the defect against the legacy path, so the
// assertions that follow are measured against a real failure rather than an
// assumed one.
import 'jest';
import { MemorySupplyStore, SqliteSupplyStore } from '@tat-protocol/storage';
import type { SqliteDatabaseHandle, SupplyStore } from '@tat-protocol/storage';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KS = 'default';

/** The legacy in-process counter, reproduced exactly. */
class InProcessCounter {
  circulating = 0;
  constructor(private cap: number) {}
  async tryIssue(amount: number): Promise<boolean> {
    if (this.circulating + amount > this.cap) return false;
    // The await is the hole: in the real code the gap between the check and the
    // write spans token construction and signing.
    await Promise.resolve();
    this.circulating += amount;
    return true;
  }
}

describe('the legacy in-process counter over-issues', () => {
  it('lets concurrent mints blow through the cap', async () => {
    const cap = 100;
    const counter = new InProcessCounter(cap);

    // 100 concurrent mints of 10 against a cap of 100: at most 10 should pass.
    const results = await Promise.all(
      Array.from({ length: 100 }, () => counter.tryIssue(10))
    );

    const granted = results.filter(Boolean).length;
    expect(granted).toBeGreaterThan(10);
    expect(counter.circulating).toBeGreaterThan(cap);
  });
});

function describeSupplyStore(name: string, make: () => Promise<{
  store: SupplyStore;
  cleanup?: () => Promise<void> | void;
}>) {
  describe(`SupplyStore conformance: ${name}`, () => {
    let store: SupplyStore;
    let cleanup: (() => Promise<void> | void) | undefined;

    beforeEach(async () => {
      const h = await make();
      store = h.store;
      cleanup = h.cleanup;
    });
    afterEach(async () => {
      await cleanup?.();
    });

    it('issues up to the cap and no further', async () => {
      await store.setMaxSupply(KS, 100);
      expect(await store.tryIssue(KS, 60)).toBe(60);
      expect(await store.tryIssue(KS, 40)).toBe(100);
      expect(await store.tryIssue(KS, 1)).toBeNull();
      expect(await store.getIssued(KS)).toBe(100);
    });

    it('does not partially apply a rejected issuance', async () => {
      // A reservation that breaches the cap must leave the total untouched, or
      // the headroom silently erodes on every rejected mint.
      await store.setMaxSupply(KS, 100);
      await store.tryIssue(KS, 90);
      expect(await store.tryIssue(KS, 50)).toBeNull();
      expect(await store.getIssued(KS)).toBe(90);
      // ...and the remaining headroom is still usable.
      expect(await store.tryIssue(KS, 10)).toBe(100);
    });

    it('HOLDS THE CAP EXACTLY under concurrent issuance', async () => {
      // The audit's test 5, and the one that proves enforcement moved into the
      // store. Drive concurrent issuance well past the cap from many callers.
      await store.setMaxSupply(KS, 100);

      const attempts = Array.from({ length: 500 }, () => store.tryIssue(KS, 10));
      const results = await Promise.all(attempts);

      const granted = results.filter((r) => r !== null).length;
      expect(granted).toBe(10);
      expect(await store.getIssued(KS)).toBe(100);
    });

    it('is uncapped when no cap is set', async () => {
      await store.setMaxSupply(KS, null);
      expect(await store.tryIssue(KS, 1_000_000)).toBe(1_000_000);
      expect(await store.getMaxSupply(KS)).toBeNull();
    });

    it('refuses a cap below what is already issued', async () => {
      // Otherwise the row violates its own invariant and every later issue
      // aborts, stranding the mint with no way back.
      await store.tryIssue(KS, 50);
      await expect(store.setMaxSupply(KS, 10)).rejects.toThrow(/below/i);
    });

    it('rejects any amount that is not a positive whole number', async () => {
      await expect(store.tryIssue(KS, 0)).rejects.toThrow(/greater than zero/i);
      await expect(store.tryIssue(KS, -5)).rejects.toThrow(/greater than zero/i);
      await expect(store.tryIssue(KS, NaN)).rejects.toThrow(/finite/i);
      await expect(store.tryIssue(KS, Infinity)).rejects.toThrow(/finite/i);
      // Fractions are what make an accumulated total drift.
      await expect(store.tryIssue(KS, 0.5)).rejects.toThrow(/whole number/i);
      await expect(store.tryIssue(KS, 1.0000001)).rejects.toThrow(/whole number/i);
      // Beyond 2^53 integers stop being exactly representable.
      await expect(
        store.tryIssue(KS, Number.MAX_SAFE_INTEGER + 2)
      ).rejects.toThrow(/too large/i);
    });

    it('returns headroom on redemption', async () => {
      await store.setMaxSupply(KS, 100);
      await store.tryIssue(KS, 100);
      expect(await store.tryIssue(KS, 1)).toBeNull();
      await store.recordRedemption?.(KS, 30);
      expect(await store.getIssued(KS)).toBe(70);
      expect(await store.tryIssue(KS, 30)).toBe(100);
    });

    it('never lets issued go negative on over-redemption', async () => {
      // Negative issued would hand the mint headroom above its own cap.
      await store.tryIssue(KS, 10);
      await store.recordRedemption?.(KS, 50);
      expect(await store.getIssued(KS)).toBe(0);
    });

    it('allocates each asset id exactly once under concurrency', async () => {
      const ids = await Promise.all(
        Array.from({ length: 200 }, () => store.nextAssetId(KS))
      );
      expect(new Set(ids).size).toBe(200);
    });

    it('keeps keysets independent', async () => {
      await store.setMaxSupply('ks-a', 10);
      await store.setMaxSupply('ks-b', 10);
      expect(await store.tryIssue('ks-a', 10)).toBe(10);
      expect(await store.tryIssue('ks-a', 1)).toBeNull();
      // b has its own headroom.
      expect(await store.tryIssue('ks-b', 10)).toBe(10);
    });
  });
}

describeSupplyStore('MemorySupplyStore', async () => ({
  store: new MemorySupplyStore(),
}));

describeSupplyStore('SqliteSupplyStore (file, WAL)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tat-supply-'));
  const db = new DatabaseSync(join(dir, 'forge.db')) as unknown as SqliteDatabaseHandle;
  const store = new SqliteSupplyStore(db);
  return {
    store,
    cleanup: async () => {
      await store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
});

describe('SqliteSupplyStore durability', () => {
  it('remembers issued supply across a restart', async () => {
    // The in-memory counter forgets on restart, which resets the cap to full
    // headroom — an over-issue by exactly the amount already in circulation.
    const dir = mkdtempSync(join(tmpdir(), 'tat-supply-restart-'));
    const path = join(dir, 'forge.db');
    try {
      const first = new SqliteSupplyStore(
        new DatabaseSync(path) as unknown as SqliteDatabaseHandle
      );
      await first.setMaxSupply(KS, 100);
      expect(await first.tryIssue(KS, 100)).toBe(100);
      await first.close();

      const second = new SqliteSupplyStore(
        new DatabaseSync(path) as unknown as SqliteDatabaseHandle
      );
      expect(await second.getIssued(KS)).toBe(100);
      expect(await second.tryIssue(KS, 1)).toBeNull();
      await second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('shares one cap across two independent store instances', async () => {
    // Two instances against one file stand in for two forge processes: the
    // whole point is that they cannot each grant the same headroom.
    const dir = mkdtempSync(join(tmpdir(), 'tat-supply-multi-'));
    const path = join(dir, 'forge.db');
    try {
      const a = new SqliteSupplyStore(
        new DatabaseSync(path) as unknown as SqliteDatabaseHandle
      );
      await a.setMaxSupply(KS, 100);
      const b = new SqliteSupplyStore(
        new DatabaseSync(path) as unknown as SqliteDatabaseHandle
      );

      const results = await Promise.all([
        ...Array.from({ length: 20 }, () => a.tryIssue(KS, 10)),
        ...Array.from({ length: 20 }, () => b.tryIssue(KS, 10)),
      ]);

      expect(results.filter((r) => r !== null)).toHaveLength(10);
      expect(await a.getIssued(KS)).toBe(100);
      await a.close();
      await b.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Forge-level: the store is actually on the mint path, and upgrading a forge
// that has already issued does not hand it fresh headroom.
// ---------------------------------------------------------------------------
import '@tat-protocol/nwpc';
import { FungibleForge } from '@tat-protocol/forge';
import type { StorageInterface } from '@tat-protocol/storage';
import { schnorr } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';

const OWNER_SK = '44'.repeat(32);
const OWNER = bytesToHex(schnorr.getPublicKey(OWNER_SK));

class MemStore implements StorageInterface {
  private m = new Map<string, string>();
  async getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  async setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  async removeItem(k: string) {
    this.m.delete(k);
  }
  async clear() {
    this.m.clear();
  }
}

function makeForge(opts: { totalSupply?: number; supplyStore?: SupplyStore } = {}) {
  const forge = new FungibleForge({
    owner: OWNER,
    keys: { secretKey: OWNER_SK, publicKey: OWNER },
    storage: new MemStore(),
    totalSupply: opts.totalSupply ?? 0,
    relays: [],
    supplyStore: opts.supplyStore,
  } as any) as any;
  forge.keys = { secretKey: OWNER_SK, publicKey: OWNER };
  return forge;
}

describe('forge mint path honours the supply store', () => {
  it('reserves through the store rather than the in-process counter', async () => {
    const store = new MemorySupplyStore();
    await store.setMaxSupply(KS, 100);
    const forge = makeForge({ totalSupply: 100, supplyStore: store });

    expect(await forge.reserveSupply(60)).toBe(true);
    expect(await forge.reserveSupply(40)).toBe(true);
    expect(await forge.reserveSupply(1)).toBe(false);
    expect(await store.getIssued(KS)).toBe(100);
  });

  it('reports remaining headroom from the store', async () => {
    const store = new MemorySupplyStore();
    await store.setMaxSupply(KS, 100);
    const forge = makeForge({ totalSupply: 100, supplyStore: store });
    await forge.reserveSupply(30);
    expect(await forge.remainingSupply()).toBe(70);
  });

  it('allocates asset ids through the store', async () => {
    const store = new MemorySupplyStore();
    const forge = makeForge({ supplyStore: store });
    const ids = await Promise.all([
      forge.allocateAssetId(),
      forge.allocateAssetId(),
      forge.allocateAssetId(),
    ]);
    expect(new Set(ids).size).toBe(3);
  });

  it('keeps the legacy in-process path when no store is configured', async () => {
    // Upgrading the SDK must not change behaviour for a forge that has not
    // opted in.
    const forge = makeForge({ totalSupply: 50 });
    expect(await forge.reserveSupply(50)).toBe(true);
    expect(await forge.reserveSupply(1)).toBe(false);
    expect(forge.state.circulatingSupply).toBe(50);
  });
});

describe('upgrading a forge that has already issued', () => {
  it('carries existing circulating supply into the store', async () => {
    // Starting the store at zero would hand the forge a full cap of fresh
    // headroom — an over-issue by exactly what is already in circulation.
    const store = new MemorySupplyStore();
    const forge = makeForge({ totalSupply: 100, supplyStore: store });
    forge.state.circulatingSupply = 80;

    await forge.adoptSupplyIntoStore();

    expect(await store.getIssued(KS)).toBe(80);
    expect(await store.getMaxSupply(KS)).toBe(100);
    expect(await forge.reserveSupply(20)).toBe(true);
    expect(await forge.reserveSupply(1)).toBe(false);
  });

  it('does not double-count across restarts', async () => {
    const store = new MemorySupplyStore();
    const forge = makeForge({ totalSupply: 100, supplyStore: store });
    forge.state.circulatingSupply = 80;

    await forge.adoptSupplyIntoStore();
    await forge.adoptSupplyIntoStore();
    await forge.adoptSupplyIntoStore();

    expect(await store.getIssued(KS)).toBe(80);
  });

  it('adopts an uncapped forge as uncapped', async () => {
    const store = new MemorySupplyStore();
    const forge = makeForge({ totalSupply: 0, supplyStore: store });
    await forge.adoptSupplyIntoStore();
    expect(await store.getMaxSupply(KS)).toBeNull();
    expect(await forge.reserveSupply(1_000_000)).toBe(true);
  });

  it('seeds before setting the cap, so a forge at its cap still adopts', async () => {
    const store = new MemorySupplyStore();
    const forge = makeForge({ totalSupply: 100, supplyStore: store });
    forge.state.circulatingSupply = 100;

    await expect(forge.adoptSupplyIntoStore()).resolves.toBeUndefined();
    expect(await store.getIssued(KS)).toBe(100);
    expect(await forge.reserveSupply(1)).toBe(false);
  });
});
