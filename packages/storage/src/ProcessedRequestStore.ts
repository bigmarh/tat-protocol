/**
 * Exact, durable request idempotency, keyed on the Nostr event id.
 *
 * ## Why this is not a Bloom filter
 *
 * Dedup here is not a cache optimisation — it is the only replay protection on
 * the issuance path. Transfer and burn are protected by the spent set (replay a
 * transfer and its input is already spent), but a mint has no spent input, so
 * if the same event is handled twice the forge mints twice. That makes dedup a
 * money invariant, and money invariants cannot be probabilistic.
 *
 * A Bloom filter gets the direction of its error right — no false negatives, so
 * it never lets a replay through — but it pays for that with false positives
 * that grow without bound as it fills, and there is no way to remove an entry.
 * Measured against the shipped 15k/1% filter: 1.1% false positives at 15k
 * events, 53% at 50k, 95% at 100k. A false positive means a request that was
 * never handled is treated as already handled and dropped, so at 100k events a
 * forge silently discards 19 of every 20 legitimate requests and reports
 * nothing. It also degrades fastest exactly when load is highest, and it never
 * recovers, because the filter is persisted and restored across restarts.
 *
 * Exactness is affordable. Even 300k event ids — ten minutes of backlog at a
 * 500/sec burst — is a few tens of MB before pruning, against the 17.5 KB the
 * filter was saving. That was a space trade that bought nothing and cost
 * correctness on the one operation where correctness is the product.
 *
 * ## The contract
 *
 * 1. **Atomic.** `tryClaim` is one indivisible test-and-insert. Two concurrent
 *    deliveries of the same event must not both be told to proceed.
 * 2. **Durable before resolve.** A claim must survive a crash, or a restart
 *    replays the event and mints again.
 * 3. **Exact.** No false positives (a new request is never dropped) and no
 *    false negatives (a replay is never admitted).
 *
 * Note the difference from SpentSetStore: that one is keyed by token hash and
 * kept for the life of a keyset. This one is keyed by event id and pruned by
 * age, because an event that can no longer be redelivered can no longer be
 * replayed.
 */
export interface ProcessedRequestStore {
  /**
   * Atomically claim an event id before handling it.
   *
   * Claim-before-handle, not mark-after-handle. Marking afterwards leaves two
   * holes: two concurrent deliveries both pass the check before either marks,
   * and a crash mid-handler loses the mark so the event replays on restart.
   *
   * @returns `true` if this call claimed it and the caller should handle the
   * event; `false` if it was already claimed and the caller must not.
   */
  tryClaim(eventId: string, now?: number): Promise<boolean>;

  /**
   * Attach the response that was sent for a claimed event.
   *
   * Not yet consulted on the replay path — doing that needs the response object
   * threaded through NWPC's handler chain. Recorded now so that when it is, the
   * history is already there rather than starting empty. Without it a duplicate
   * is silently skipped, which is correct only as long as the original response
   * actually reached the requester.
   */
  recordResponse?(eventId: string, response: string): Promise<void>;

  /** Whether an event id has been claimed. Does not mutate. */
  isClaimed(eventId: string): Promise<boolean>;

  /**
   * Drop claims older than `olderThanSeconds`.
   *
   * Bounded by time rather than by count or probability: a relay cannot
   * redeliver an event outside the subscription's `since` window, so a claim
   * older than that window can never be needed again. Prune well beyond the
   * widest `since` any subscription uses — Pocket passes an explicit one, so it
   * is not always the 10-minute default.
   *
   * @returns how many claims were removed.
   */
  prune(olderThanSeconds: number, now?: number): Promise<number>;

  /** Number of live claims. Diagnostics and tests; not on a hot path. */
  size(): Promise<number>;

  /** Release any underlying handle. */
  close?(): Promise<void>;
}

/**
 * Default retention for claims.
 *
 * 24 hours, which is far beyond any subscription `since` window in use and
 * still small enough to stay cheap. The cost of keeping a claim too long is
 * some disk; the cost of dropping one too early is a replayed mint.
 */
export const DEFAULT_CLAIM_RETENTION_SECONDS = 24 * 60 * 60;
