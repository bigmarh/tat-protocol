/**
 * The money-critical storage primitive: the set of token hashes already spent.
 *
 * This is deliberately NOT part of {@link StorageInterface}. That interface is
 * getItem/setItem/removeItem/clear over strings, which cannot express a
 * set-membership test or an atomic insert — so the spent set has to be read,
 * mutated and rewritten whole on every spend. The cost of that is quadratic in
 * lifetime spends, and because the defect is in the *interface* rather than any
 * implementation, swapping the backend behind StorageInterface does not fix it.
 *
 * Splitting by what the data *is* fixes it: config, keys and caches stay on
 * StorageInterface, where losing a value costs a resync. The spent set moves
 * here, where losing a value costs someone their money.
 *
 * ## The conformance contract
 *
 * Any implementation must satisfy three properties. None is negotiable, and a
 * backend that misses one is not merely slower — it is unsound under
 * concurrency it may not have encountered yet.
 *
 * 1. **Atomic.** `tryMarkSpent` is one indivisible test-and-insert. An
 *    implementation that does `get()` then `put()` is NOT conformant, and no
 *    application-level lock repairs it once more than one process is running.
 *    This is the property that turns double-spend rejection from a race the
 *    application has to keep winning into an invariant the store enforces.
 *
 * 2. **Durable before resolve.** The returned promise must not settle until the
 *    write survives power loss. A forge releases newly signed tokens in the
 *    response to a transfer; if the spent-set write has not landed by then, a
 *    crash leaves the input replayable and the money duplicated.
 *
 * 3. **Linearizable.** Once `tryMarkSpent` returns `true`, no reader anywhere
 *    may still observe that hash as unspent.
 *
 * Anything satisfying those three is a valid backend. Nothing else about it —
 * engine, file layout, hosting — is the protocol's business. The conformance
 * suite in `tests/conformance/spent-set-store.ts` is the executable form of
 * this contract; run any new backend against it unmodified.
 *
 * ## On hashes
 *
 * Hashes cross this interface as lowercase hex strings, because that is what
 * `TokenHeader.token_hash` is throughout the protocol. Implementations are
 * expected to *store* them as 32 raw bytes — half the size, and a fixed-width
 * index — but converting at each call site instead would put a hexToBytes in
 * front of every spend check for no gain.
 */
export interface SpentSetStore {
  /**
   * Atomically test-and-mark a token hash as spent.
   *
   * @returns `true` if this call is the one that marked it (the spend may
   * proceed), `false` if it was already present (reject as a double-spend).
   * Never throws to signal "already spent" — that is an ordinary outcome, not
   * an error condition.
   */
  tryMarkSpent(keysetId: string, tokenHash: string): Promise<boolean>;

  /**
   * Batch membership test. Does not mutate.
   *
   * Used by the `verify` RPC, which asks about many hashes at once. Returns a
   * map keyed by the hashes given, so callers never have to rely on ordering.
   */
  getStates(keysetId: string, tokenHashes: string[]): Promise<Record<string, boolean>>;

  /**
   * Whether a single hash is already spent. Does not mutate.
   *
   * Convenience over {@link getStates} for the read-only validation paths.
   */
  isSpent(keysetId: string, tokenHash: string): Promise<boolean>;

  /**
   * Number of hashes recorded under a keyset. Intended for diagnostics and
   * tests; not on any hot path.
   */
  size(keysetId: string): Promise<number>;

  /** Release any underlying handle. Optional — in-memory backends need none. */
  close?(): Promise<void>;
}

/**
 * The keyset a spend is recorded under.
 *
 * Epoch keysets are not implemented yet: they are a protocol change that adds
 * a required `ks` field to the token payload, and doing that would stop
 * existing tokens parsing. The dimension is threaded through the store now so
 * that landing keysets later is an additive change — a new value in this column
 * — rather than a schema migration of the one table that must never be lost.
 *
 * Until then every spend is recorded under this sentinel.
 */
export const DEFAULT_KEYSET_ID = 'default';

/**
 * Normalize a token hash to the single canonical form every backend stores.
 *
 * Backends must run every hash through this rather than normalizing their own
 * way. Two backends that disagree about whether `AB…` and `ab…` are the same
 * hash disagree about whether a token has been spent, which means the same
 * token is spendable twice on one deployment and not the other — a correctness
 * difference dressed up as a formatting detail.
 *
 * Non-hex input throws instead of being coerced: a malformed hash that maps to
 * a *different* key would let a spent token through, so this is a money check
 * and not input hygiene.
 */
export function normalizeTokenHash(tokenHash: string): string {
  if (
    typeof tokenHash !== 'string' ||
    tokenHash.length === 0 ||
    tokenHash.length % 2 !== 0 ||
    !/^[0-9a-fA-F]+$/.test(tokenHash)
  ) {
    throw new Error(`SpentSetStore: token hash is not hex: ${String(tokenHash)}`);
  }
  return tokenHash.toLowerCase();
}
