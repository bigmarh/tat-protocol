// Backend-agnostic conformance suite for ProcessedRequestStore.
//
// The contract is: atomic, durable before resolve, and EXACT in both
// directions. Exactness is the reason this exists — the structure it replaces
// was probabilistic in the false-positive direction, which silently discarded
// requests that had never been handled.
import type { ProcessedRequestStore } from '@tat-protocol/storage';

export interface ClaimHarness {
  store: ProcessedRequestStore;
  cleanup?: () => Promise<void> | void;
}

const eventId = (n: number) => n.toString(16).padStart(64, '0');

export function describeProcessedRequestStoreConformance(
  name: string,
  makeHarness: () => Promise<ClaimHarness>
) {
  describe(`ProcessedRequestStore conformance: ${name}`, () => {
    let harness: ClaimHarness;
    let store: ProcessedRequestStore;

    beforeEach(async () => {
      harness = await makeHarness();
      store = harness.store;
    });

    afterEach(async () => {
      await harness.cleanup?.();
    });

    describe('atomicity', () => {
      it('claims an unseen event', async () => {
        expect(await store.tryClaim(eventId(1))).toBe(true);
      });

      it('refuses a second claim on the same event', async () => {
        await store.tryClaim(eventId(1));
        expect(await store.tryClaim(eventId(1))).toBe(false);
      });

      it('admits EXACTLY ONE claimant among concurrent deliveries', async () => {
        // Relays redeliver, and with N replicas every process sees every event.
        // Exactly one must handle it, or a mint runs twice.
        const attempts = Array.from({ length: 500 }, () => store.tryClaim(eventId(7)));
        const results = await Promise.all(attempts);
        expect(results.filter(Boolean)).toHaveLength(1);
      });

      it('admits exactly one claimant per event across interleaved events', async () => {
        const ids = Array.from({ length: 40 }, (_, i) => eventId(100 + i));
        const attempts = ids.flatMap((id) =>
          Array.from({ length: 10 }, () => store.tryClaim(id))
        );
        const results = await Promise.all(attempts);
        expect(results.filter(Boolean)).toHaveLength(ids.length);
      });
    });

    describe('exactness', () => {
      it('has NO false positives — an unclaimed event is never reported claimed', async () => {
        // The property the Bloom filter could not provide, and the one whose
        // absence silently dropped legitimate requests. 20k is past the 15k
        // design point of the filter this replaces, where it was already
        // returning several percent false positives; the full 100k comparison
        // lives in nwpc-idempotency.verify.ts, which does not pay a per-claim
        // fsync to make the point.
        for (let i = 0; i < 20_000; i++) {
          await store.tryClaim(eventId(1_000_000 + i));
        }
        for (let i = 0; i < 500; i++) {
          expect(await store.isClaimed(eventId(9_000_000 + i))).toBe(false);
          expect(await store.tryClaim(eventId(9_000_000 + i))).toBe(true);
        }
      }, 120_000);

      it('has no false negatives — a claimed event is never reported unclaimed', async () => {
        for (let i = 0; i < 3000; i++) {
          await store.tryClaim(eventId(2_000_000 + i));
        }
        for (const i of [0, 1500, 2999]) {
          expect(await store.isClaimed(eventId(2_000_000 + i))).toBe(true);
          expect(await store.tryClaim(eventId(2_000_000 + i))).toBe(false);
        }
      }, 60_000);
    });

    describe('reads do not mutate', () => {
      it('isClaimed leaves an unclaimed event claimable', async () => {
        expect(await store.isClaimed(eventId(3))).toBe(false);
        expect(await store.isClaimed(eventId(3))).toBe(false);
        expect(await store.tryClaim(eventId(3))).toBe(true);
      });
    });

    describe('pruning is by age', () => {
      it('drops claims older than the window', async () => {
        const now = Date.now();
        await store.tryClaim(eventId(4), now - 3600_000);
        await store.tryClaim(eventId(5), now);

        const removed = await store.prune(600, now);

        expect(removed).toBe(1);
        expect(await store.isClaimed(eventId(4))).toBe(false);
        // ...and the recent one, which a relay CAN still redeliver, survives.
        expect(await store.isClaimed(eventId(5))).toBe(true);
      });

      it('lets a pruned event be claimed again', async () => {
        const now = Date.now();
        await store.tryClaim(eventId(6), now - 3600_000);
        await store.prune(600, now);
        // Safe: an event outside every subscription window cannot be
        // redelivered, so re-claimability costs nothing.
        expect(await store.tryClaim(eventId(6), now)).toBe(true);
      });

      it('removes nothing when everything is inside the window', async () => {
        const now = Date.now();
        await store.tryClaim(eventId(8), now);
        expect(await store.prune(600, now)).toBe(0);
        expect(await store.size()).toBe(1);
      });
    });

    describe('response memoization', () => {
      it('records a response against a claimed event', async () => {
        await store.tryClaim(eventId(9));
        // Optional on the interface; skip cleanly where unimplemented.
        if (!store.recordResponse) return;
        await expect(
          store.recordResponse(eventId(9), '{"result":"ok"}')
        ).resolves.toBeUndefined();
      });
    });
  });
}
