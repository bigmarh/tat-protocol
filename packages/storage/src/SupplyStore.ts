/**
 * Supply enforcement, and sequential asset-id allocation.
 *
 * ## Why this cannot stay a counter in the process
 *
 * The cap was enforced by reading a counter, comparing it, and writing it back:
 *
 * ```ts
 * if ((state.circulatingSupply ?? 0) + amount > state.totalSupply) reject();
 * ...
 * state.circulatingSupply = (state.circulatingSupply ?? 0) + amount;
 * ```
 *
 * That is a read-compare-write in application code. With one process it is
 * correct. With N, every process reads the same value, every one concludes it
 * is under the cap, and the mint collectively over-issues by up to N times the
 * headroom — while each process believes it obeyed the limit. There is no lock
 * that repairs it, because the processes do not share one.
 *
 * The fix is the same shape as the spent set: the cap must be a constraint the
 * STORE evaluates during the issuing transaction, so there is no code path in
 * which the application decides whether the cap was met.
 *
 * It also fixes a durability hole that bites at N = 1. `FungibleForge.forgeToken`
 * incremented the counter in memory and returned the signed token without
 * awaiting a write, so a crash between the response and the next state save
 * released a token the supply never counted — and the cap under-counts forever
 * after. `tryIssue` does not resolve until the increment is durable.
 *
 * ## Why not derive supply from an unspent set
 *
 * Outstanding supply could be a `SELECT SUM(amount)` over unspent tokens rather
 * than a counter, which never drifts because there is nothing to keep in sync.
 * That is a real option and it is the right one for auditing — but not for
 * enforcement: an aggregate over a large table cannot be evaluated atomically
 * against a cap without serialising the whole table, whereas a single row with
 * a CHECK constraint serialises exactly one row. Use the row to enforce, and a
 * ledger to audit. They answer different questions.
 */
export interface SupplyStore {
  /**
   * Atomically reserve `amount` against the cap.
   *
   * Reserve BEFORE minting. If the mint then fails, the reservation is stranded
   * and the forge has under-issued — which is the safe direction. Reserving
   * after would mean a token exists that the cap never counted.
   *
   * @returns the new issued total if the reservation fit under the cap, or
   * `null` if it would exceed it. Never throws to signal "cap reached" — that
   * is an ordinary outcome the forge turns into a SUPPLY_LIMIT response.
   */
  tryIssue(keysetId: string, amount: number): Promise<number | null>;

  /**
   * Return `amount` to the available headroom, for a burn or redemption.
   *
   * Optional: a forge whose tokens are never redeemed back into headroom does
   * not need it, and a mint that treats its cap as a lifetime issuance limit
   * rather than a circulating limit must NOT call it.
   */
  recordRedemption?(keysetId: string, amount: number): Promise<number>;

  /**
   * Allocate the next sequential asset id.
   *
   * Same defect as the supply counter, one degree less dangerous: N processes
   * each holding their own `lastAssetId` mint duplicate ids rather than
   * duplicate money. Allocation is a single atomic increment here.
   */
  nextAssetId(keysetId: string): Promise<number>;

  /** Amount issued so far under this keyset. */
  getIssued(keysetId: string): Promise<number>;

  /** The cap, or `null` for uncapped. */
  getMaxSupply(keysetId: string): Promise<number | null>;

  /**
   * Set the cap.
   *
   * Refuses to set a cap below what has already been issued: the alternative is
   * a store whose own invariant is already violated, which makes every later
   * `tryIssue` reject and strands the mint with no way back.
   */
  setMaxSupply(keysetId: string, maxSupply: number | null): Promise<void>;

  close?(): Promise<void>;
}

/**
 * A note on amounts.
 *
 * Amounts are JavaScript numbers — IEEE-754 doubles — because that is what
 * `Payload.amount` is throughout the protocol, and changing it is a breaking
 * token-format decision rather than a storage one. Accumulating them is
 * therefore subject to float error: an issued total built from many fractional
 * amounts can drift from the exact sum, and the cap is checked against the
 * drifted value.
 *
 * The drift is bounded and tiny relative to any realistic cap, and it is
 * identical to the behaviour being replaced, so this changes nothing. It is
 * flagged because the real fix is integers of a minor unit in the token format,
 * and that decision belongs with the token format, not here.
 */
export type SupplyAmount = number;
