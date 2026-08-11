import { SpentSetStore, normalizeTokenHash } from './SpentSetStore.js';

/**
 * In-memory {@link SpentSetStore}.
 *
 * Conformant on atomicity and linearizability, and NOT conformant on
 * durability — it is explicitly a test and single-session backend, not
 * something to put money behind.
 *
 * The atomicity is real rather than incidental: `has` and `add` below run with
 * no `await` between them, so on JavaScript's single-threaded event loop no
 * other task can observe or interleave with the gap. That is the same reason
 * the naive `get()`-then-`put()` shape is unsound on a *networked* backend but
 * sound here — the difference is whether the gap can contain a suspension
 * point, not whether the code looks like a check followed by a write.
 */
export class MemorySpentSetStore implements SpentSetStore {
  private sets = new Map<string, Set<string>>();

  private setFor(keysetId: string): Set<string> {
    let set = this.sets.get(keysetId);
    if (!set) {
      set = new Set<string>();
      this.sets.set(keysetId, set);
    }
    return set;
  }

  async tryMarkSpent(keysetId: string, tokenHash: string): Promise<boolean> {
    const key = normalizeTokenHash(tokenHash);
    const set = this.setFor(keysetId);
    // No await between the test and the insert — see the class comment.
    if (set.has(key)) return false;
    set.add(key);
    return true;
  }

  async getStates(keysetId: string, tokenHashes: string[]): Promise<Record<string, boolean>> {
    const set = this.setFor(keysetId);
    const out: Record<string, boolean> = {};
    // Keyed by the hash as GIVEN, so callers can look results up with the same
    // string they passed in, while membership is tested on the canonical form.
    for (const hash of tokenHashes) {
      out[hash] = set.has(normalizeTokenHash(hash));
    }
    return out;
  }

  async isSpent(keysetId: string, tokenHash: string): Promise<boolean> {
    return this.setFor(keysetId).has(normalizeTokenHash(tokenHash));
  }

  async size(keysetId: string): Promise<number> {
    return this.setFor(keysetId).size;
  }
}
