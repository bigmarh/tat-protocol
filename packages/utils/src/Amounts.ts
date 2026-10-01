/**
 * Token amounts are positive safe integers. One place, so every check agrees.
 *
 * ## Why integers, and why this has to be enforced rather than assumed
 *
 * Amounts are carried as JavaScript numbers — IEEE-754 doubles. Doubles
 * represent integers EXACTLY up to 2^53, so as long as every amount is a safe
 * integer, `+=` and the conservation comparison are exact and there is no
 * float-drift problem to solve.
 *
 * That was the design intent, but nothing checked it. Every amount validation
 * in the protocol was `Number.isFinite(x) && x > 0`, which accepts `0.5` — so
 * the exactness the arithmetic depends on was an assumption the code never
 * verified.
 *
 * A fractional amount breaks conservation quietly. `0.1 + 0.2` accumulates to
 * `0.30000000000000004`, so a transfer can output marginally more than its
 * inputs and still pass `outputTotal > inputTotal`. The excess is tiny per
 * transaction, but it is value created from nothing, and the change output is
 * computed as `inputTotal - outputTotal`, which carries the drift into a fresh
 * token that circulates.
 *
 * ## Why `isSafeInteger` and not `isInteger`
 *
 * Past 2^53, integers stop being exactly representable: `2^53 + 1` rounds to
 * `2^53`. Sums of very large amounts then lose precision and break conservation
 * the same way fractions do, silently and in the mint's favour or against it
 * depending on rounding. `Number.isSafeInteger` bounds magnitude as well as
 * requiring integrality, so it rules out both failures with one predicate.
 *
 * A denomination finer than 1 unit belongs in the issuer's choice of unit — a
 * mint that needs cents should issue cents and display dollars, exactly as
 * Bitcoin issues satoshis. That keeps the protocol exact and puts the display
 * concern where it belongs.
 */

/** Whether `amount` is a valid token amount: a positive safe integer. */
export function isValidTokenAmount(amount: unknown): amount is number {
  return (
    typeof amount === "number" && Number.isSafeInteger(amount) && amount > 0
  );
}

/**
 * Human-readable reason `amount` is not a valid token amount, or `null` if it
 * is. Separated from the predicate so callers can return a specific error
 * rather than a generic one — "must be a whole number" and "is too large to
 * represent exactly" are different problems for whoever sent the request.
 */
export function invalidTokenAmountReason(amount: unknown): string | null {
  if (typeof amount !== "number") {
    return "amount must be a number";
  }
  if (!Number.isFinite(amount)) {
    // NaN and ±Infinity: a single NaN input makes a running total NaN, and
    // every comparison against NaN is false, so a conservation check would
    // pass for arbitrary outputs.
    return "amount must be a finite number";
  }
  if (!Number.isInteger(amount)) {
    return "amount must be a whole number — issue a smaller unit instead of a fraction";
  }
  if (amount <= 0) {
    return "amount must be greater than zero";
  }
  if (!Number.isSafeInteger(amount)) {
    return `amount is too large to represent exactly (maximum ${Number.MAX_SAFE_INTEGER})`;
  }
  return null;
}
