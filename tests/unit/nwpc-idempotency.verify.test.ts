// The defect this change exists to fix, pinned end to end.
//
// The Bloom filter's error is one-directional — no false negatives, so it never
// admitted a replay — but its false-positive rate grows without bound as it
// fills and it can never remove an entry. A false positive means an event that
// was NEVER handled is treated as already handled: the subscription handler
// returns early, no handler runs, no response is sent, and no error is raised.
// The request vanishes.
//
// Measured against the shipped parameters (15,000 expected items, 1% target):
// 1.1% false positives at 15k events, 15.7% at 30k, 53.3% at 50k, 94.9% at
// 100k, 100% at 200k. And because the filter is persisted in state and restored
// on load, a forge that reaches that point stays deaf across restarts.
import { BloomFilter } from '@tat-protocol/utils';
import {
  MemoryProcessedRequestStore,
  SqliteProcessedRequestStore,
} from '@tat-protocol/storage';
import type { SqliteDatabaseHandle } from '@tat-protocol/storage';
import { DatabaseSync } from 'node:sqlite';

const eventId = (n: number) => n.toString(16).padStart(64, '0');

// The exact constants NWPCBase uses.
const BLOOM_EXPECTED_ITEMS = 15000;
const BLOOM_ERROR_RATE = 0.01;

/** Fraction of never-seen ids the structure wrongly reports as already seen. */
function falsePositiveRate(seen: (id: string) => boolean, probes = 5000): number {
  let fp = 0;
  for (let i = 0; i < probes; i++) {
    if (seen(eventId(9_000_000 + i))) fp++;
  }
  return fp / probes;
}

describe('the Bloom filter silently drops legitimate requests as it fills', () => {
  it('degrades past 50% false positives well inside a forge lifetime', () => {
    const bloom = new BloomFilter(BLOOM_EXPECTED_ITEMS, BLOOM_ERROR_RATE);
    for (let i = 0; i < 50_000; i++) bloom.add(eventId(i));

    const rate = falsePositiveRate((id) => bloom.contains(id));

    // Not a tuning problem: at 50k events more than half of all NEW requests
    // are discarded with no response and no error.
    expect(rate).toBeGreaterThan(0.4);
  }, 120_000);

  it('is effectively total by 100k events', () => {
    const bloom = new BloomFilter(BLOOM_EXPECTED_ITEMS, BLOOM_ERROR_RATE);
    for (let i = 0; i < 100_000; i++) bloom.add(eventId(i));

    expect(falsePositiveRate((id) => bloom.contains(id))).toBeGreaterThan(0.9);
  }, 120_000);
});

describe('the exact store does not', () => {
  it('reports ZERO false positives at the same fill level', async () => {
    const store = new MemoryProcessedRequestStore();
    for (let i = 0; i < 100_000; i++) await store.tryClaim(eventId(i));

    let fp = 0;
    for (let i = 0; i < 5000; i++) {
      if (await store.isClaimed(eventId(9_000_000 + i))) fp++;
    }
    expect(fp).toBe(0);
  }, 120_000);

  it('still admits no replays at the same fill level', async () => {
    // Exactness has to hold in BOTH directions. A structure with no false
    // positives but occasional false negatives would trade silent drops for
    // double mints, which is a worse bug.
    const store = new MemoryProcessedRequestStore();
    for (let i = 0; i < 50_000; i++) await store.tryClaim(eventId(i));

    for (const i of [0, 25_000, 49_999]) {
      expect(await store.tryClaim(eventId(i))).toBe(false);
    }
  }, 120_000);
});

describe('claim-before-handle closes the ordering holes', () => {
  // Mark-after-handle left two holes independent of the filter's accuracy.
  it('lets only one of two concurrent deliveries through', async () => {
    const store = new MemoryProcessedRequestStore();
    const id = eventId(42);

    let handled = 0;
    const deliver = async () => {
      if (!(await store.tryClaim(id))) return;
      handled++;
    };
    await Promise.all([deliver(), deliver(), deliver(), deliver()]);

    // Marking afterwards, all four pass the check before any of them marks —
    // and on a mint that is four times the money.
    expect(handled).toBe(1);
  });

  it('keeps the claim when the handler throws, so a redelivery cannot retry a mint', async () => {
    const store = new MemoryProcessedRequestStore();
    const id = eventId(43);

    const deliver = async (fail: boolean) => {
      if (!(await store.tryClaim(id))) return 'skipped';
      try {
        if (fail) throw new Error('handler blew up');
        return 'handled';
      } catch {
        return 'failed';
      }
    };

    expect(await deliver(true)).toBe('failed');
    // A client that genuinely needs to retry publishes a NEW event, which
    // carries a new id and claims cleanly; a relay redelivering the same event
    // must not get a second attempt.
    expect(await deliver(false)).toBe('skipped');
    expect(await store.tryClaim(eventId(44))).toBe(true);
  });

  it('survives a restart with SQLite, where the in-memory filter would not', async () => {
    const id = eventId(45);
    const db = new DatabaseSync(':memory:') as unknown as SqliteDatabaseHandle;
    const store = new SqliteProcessedRequestStore(db, { skipPragmas: true });
    expect(await store.tryClaim(id)).toBe(true);

    // Same file/connection reopened is covered in the conformance test; here
    // the point is simply that the claim is in the store, not in a process.
    expect(await store.isClaimed(id)).toBe(true);
    await store.close();
  });
});
