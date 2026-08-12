import { ProcessedRequestStore } from './ProcessedRequestStore.js';

interface ClaimRecord {
  at: number;
  response?: string;
}

export interface MemoryProcessedRequestStoreOptions {
  /**
   * Hard cap on live claims, as a memory backstop.
   *
   * Time-based pruning is the real bound; this only matters if `prune` is never
   * called. When the cap is hit the OLDEST claims are dropped first, because
   * insertion order is arrival order and the oldest are the ones a relay is
   * least able to redeliver.
   */
  maxEntries?: number;
}

/**
 * In-memory {@link ProcessedRequestStore}.
 *
 * Exact and atomic, and NOT durable — a restart forgets every claim, which
 * reopens the replay window. That makes this a test and single-session backend;
 * anything issuing tokens wants the SQLite one.
 *
 * Atomicity is real rather than incidental: the test and the insert below run
 * with no `await` between them, so on a single-threaded event loop nothing can
 * interleave. That is why the naive check-then-write shape is unsound on a
 * networked backend but sound here.
 */
export class MemoryProcessedRequestStore implements ProcessedRequestStore {
  private claims = new Map<string, ClaimRecord>();
  private maxEntries: number;

  constructor(options: MemoryProcessedRequestStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? 200_000;
  }

  async tryClaim(eventId: string, now = Date.now()): Promise<boolean> {
    // No await between the test and the insert — see the class comment.
    if (this.claims.has(eventId)) return false;
    this.claims.set(eventId, { at: Math.floor(now / 1000) });
    if (this.claims.size > this.maxEntries) {
      // Map iteration order is insertion order, so the head is the oldest.
      const excess = this.claims.size - this.maxEntries;
      let dropped = 0;
      for (const key of this.claims.keys()) {
        this.claims.delete(key);
        if (++dropped >= excess) break;
      }
    }
    return true;
  }

  async recordResponse(eventId: string, response: string): Promise<void> {
    const record = this.claims.get(eventId);
    if (record) record.response = response;
  }

  async isClaimed(eventId: string): Promise<boolean> {
    return this.claims.has(eventId);
  }

  async prune(olderThanSeconds: number, now = Date.now()): Promise<number> {
    const cutoff = Math.floor(now / 1000) - olderThanSeconds;
    let removed = 0;
    for (const [key, record] of this.claims) {
      if (record.at < cutoff) {
        this.claims.delete(key);
        removed++;
      }
    }
    return removed;
  }

  async size(): Promise<number> {
    return this.claims.size;
  }
}
