import { PocketState } from './Pocket.js';

export interface FungibleOut {
    issuer: string,
    to: string,
    amount: number

}
export interface NonFungibleOut {
    issuer: string,
    to: string,
    tokenID: string

}

/**
 * Read a JWT's payload without verifying it — for display and selection only.
 *
 * Uses `atob` where it exists and Node's Buffer otherwise. This runs inside a
 * browser Pocket, where `Buffer` is not defined unless something polyfills it,
 * and reaching for it there throws at the exact moment a payment is being
 * assembled.
 */
export function decodeTokenPayload(jwt: string): Record<string, unknown> | null {
    try {
        const part = jwt.split('.')[1];
        if (!part) return null;
        const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
        const json =
            typeof atob === 'function'
                ? atob(padded)
                : Buffer.from(padded, 'base64').toString('utf8');
        return JSON.parse(json) as Record<string, unknown>;
    } catch {
        return null;
    }
}

/** The BotBuck class a token carries, or null when it is untagged. */
export function tokenClassOf(jwt: string): string | null {
    const payload = decodeTokenPayload(jwt);
    const uri = payload?.['data_uri'];
    if (typeof uri !== 'string') return null;
    try {
        const meta = JSON.parse(uri) as { class?: unknown };
        return typeof meta.class === 'string' ? meta.class : null;
    } catch {
        return null;
    }
}

/**
 * The class selection should treat a token as carrying.
 *
 * Untagged tokens are purchased. That is not a guess: the bank's merge sees no
 * metadata at all and falls back to purchased, and an untagged token mixed with
 * purchased ones still merges to purchased. Grouping them together is simply
 * what the bank will do with them.
 */
export function effectiveTokenClass(jwt: string): string {
    return tokenClassOf(jwt) ?? 'purchased';
}

/**
 * Which class to spend first when the caller has not named one.
 *
 * Ordered most-usable first. What leaves this pocket should be the money the
 * recipient can actually do something with:
 *
 *   purchased  accepted everywhere and redeemable; the default money
 *   voucher    spendable, not redeemable
 *   loan       spendable, not redeemable
 *   bonus      last, always
 *
 * Bonus goes last because of how it travels, not how it redeems. The bank merges
 * a payment's inputs down to the most restrictive class present, and bonus is
 * the most restrictive there is — so a single bonus token entering a pot turns
 * the whole pot bonus, and every payout from it, for every participant. Funding
 * an escrow with bonus means winning it back as bonus, which no purchased-only
 * table will take. Spending bonus by preference quietly converted tables into
 * bonus tables and left their winners unable to play again.
 *
 * An earlier version of this list ran the other way, on the reasoning that bonus
 * needs to cycle before it redeems and spending it advances the count. That
 * reasoning was thin: `cycles + 1` lands on the *output*, so the benefit accrues
 * to whoever holds it next. A payment with no change hands the progress away
 * along with the money.
 *
 * A class the bank has added since this client shipped sorts after all of these.
 * It stays spendable, so a stale client never strands funds, but an unfamiliar
 * class is not something to reach for while one we can reason about would do.
 */
export const SPEND_ORDER: readonly string[] = ['purchased', 'voucher', 'loan', 'bonus'];

function spendRank(tokenClass: string): number {
    const i = SPEND_ORDER.indexOf(tokenClass);
    return i === -1 ? SPEND_ORDER.length : i;
}

/** Spend order, with names as the tie-break so two stale classes stay stable. */
export function bySpendOrder(a: string, b: string): number {
    return spendRank(a) - spendRank(b) || (a < b ? -1 : a > b ? 1 : 0);
}

export class Transaction {
    private tatIndex: Map<string, Map<string, string>>;
    private tokenIndex: Map<string, Map<number, string[]>>;
    private tokens: Map<string, Map<string, string>>;

    /**
     * Only spend tokens of this class, when set.
     *
     * BotBuck classes never convert, and a recipient may accept only one of
     * them — an escrow takes the class its first contribution set, and bonus
     * BotBucks are not redeemable at all. Selection that ignores class will
     * happily reach for bonus tokens to pay a purchased-only recipient while
     * the purchased ones sit right there, and the payer is told their money is
     * the wrong kind with no idea why.
     *
     * Leaving this unset does not mean "spend anything". It means the caller has
     * no constraint to impose and selection should choose a class on the
     * holder's behalf — see SPEND_ORDER. A payment is never assembled from more
     * than one class either way.
     */
    private requiredClass: string | null = null;

    /**
     * The class `build()` actually spent, available afterwards.
     *
     * When no class was requested this is the one chosen from SPEND_ORDER, which
     * the caller has no other way to learn — and it is worth surfacing, because
     * "paid with your bonus BotBucks" is the difference between a balance that
     * moved for a reason and one that moved mysteriously.
     */
    public selectedClass: string | null = null;

    constructor(
        public readonly method: string,
        public readonly PocketState: PocketState,
        public readonly outs: FungibleOut[] = [],
        public readonly changeKey: string = ''
    ) {
        this.method = method;
        this.tatIndex = this.PocketState.tatIndex;
        this.tokenIndex = this.PocketState.tokenIndex;
        this.tokens = this.PocketState.tokens;
    }


    /** Restrict selection to one BotBuck class. */
    ofClass(tokenClass: string | null | undefined) {
        this.requiredClass = tokenClass ?? null;
        return this;
    }

    /**
     * Why a payment could not be assembled, in terms the payer can act on.
     *
     * A flat "not enough BotBucks" is wrong twice over once classes exist: the
     * pocket may hold plenty in total and still be unable to pay, and the actual
     * reason — that no single class covers it and classes cannot be pooled — is
     * not something anyone would infer from the balance in front of them.
     */
    private shortfall(
        amountNeeded: number,
        byClass: Map<string, Map<number, string[]>>,
        heldIn: (cls: string) => number,
    ): string {
        if (this.requiredClass) {
            return (
                `Not enough "${this.requiredClass}" BotBucks: need ${amountNeeded}, ` +
                `hold ${heldIn(this.requiredClass)}. Classes cannot be converted.`
            );
        }
        const classes = [...byClass.keys()].sort(bySpendOrder);
        if (classes.length === 0) {
            return `Not enough BotBucks: need ${amountNeeded}, hold 0.`;
        }
        const total = classes.reduce((sum, cls) => sum + heldIn(cls), 0);
        return (
            `Not enough BotBucks in any one class: need ${amountNeeded}, hold ` +
            classes.map((cls) => `${cls} ${heldIn(cls)}`).join(', ') +
            // Only worth explaining the rule when breaking it would have helped.
            // Told to someone who is simply short overall, it reads as an excuse.
            (total >= amountNeeded
                ? '. A payment cannot be split across classes: the bank merges its inputs down to ' +
                  'the most restrictive one, so the payment and its change would all become that class.'
                : '.')
        );
    }

    to(issuer: string, to: string, amount: number) {
        this.outs.push({ to: to, amount: amount, issuer: issuer });
        return this;
    }
    toMany(outs: FungibleOut[]) {
        this.outs.push(...outs);
        return this;
    }
    transferTAT(issuer: string, to: string, tokenID: string): [method: string, { ins: string[], outs: NonFungibleOut[] }] {
        const tokenHash = this.tatIndex.get(issuer)?.get(tokenID);
        if (!tokenHash) {
            throw new Error(`TAT not found: ${issuer}:${tokenID}`);
        }
        const jwt = this.tokens.get(issuer)?.get(tokenHash);
        if (!jwt) {
            throw new Error(`JWT not found: ${issuer}:${tokenID}:${to}`);
        }

        //return the method,  issuer, TAT tx
        return ['transfer', { ins: [jwt], outs: [{ issuer: issuer, to: to, tokenID: tokenID }] }];
    }

    private greedy(denominations: Array<{ d: number, c: number }>, target: number): [number, Array<{ d: number, used: number }>] {
        // For small numbers of denominations, try all combinations
        const n = denominations.length;
        let bestSum = Infinity;
        let bestCombo: Array<{ d: number, used: number }> = [];

        // Helper to recursively try all combinations
        function search(idx: number, currentSum: number, used: number[]) {
            if (currentSum >= target) {
                if (currentSum < bestSum) {
                    bestSum = currentSum;
                    bestCombo = used.map((u, i) => ({ d: denominations[i].d, used: u })).filter(x => x.used > 0);
                }
                return;
            }
            if (idx >= n) return;
            // Try all counts for this denomination (from 0 up to c)
            for (let count = 0; count <= denominations[idx].c; count++) {
                used[idx] = count;
                search(idx + 1, currentSum + count * denominations[idx].d, used);
            }
            used[idx] = 0; // reset for other branches
        }

        search(0, 0, Array(n).fill(0));

        // If no combo found, return empty
        if (bestSum === Infinity) {
            return [target, []];
        }
        // change = bestSum - target
        return [bestSum - target, bestCombo];
    }


    /**
     * Builds the transaction input/output structure for a single-issuer fungible token transfer.
     * Enforces that all outputs have the same issuer. Does not mutate this.outs.
     * @returns [method, issuer, { ins: string[], outs: FungibleOut[] }]
     * @throws Error if outs is empty, issuers differ, or tokens are missing.
     */
    public build(): [method: string, { ins: string[], outs: FungibleOut[] }] {
        if (this.outs.length === 0) {
            throw new Error('No outputs specified for transaction.');
        }
        // Enforce single-issuer
        const issuer = this.outs[0].issuer;
        for (const out of this.outs) {
            if (out.issuer !== issuer) {
                throw new Error(`All outputs must have the same issuer. Found: ${issuer} and ${out.issuer}`);
            }
        }
        const tokenMap = this.tokenIndex?.get(issuer);
        if (!tokenMap) {
            throw new Error(`No tokens found for issuer: ${issuer}`);
        }

        // Group spendable JWTs by class first, then by denomination.
        //
        // Grouping first is what makes "never mix" structural rather than a rule
        // to be remembered at each call site: a payment is assembled out of
        // exactly one bucket, so there is no path by which two classes reach the
        // same `ins`. That matters because the bank merges input metadata down
        // to the most restrictive class present — one bonus token dragged into
        // an otherwise purchased payment turns that payment, and the change that
        // comes back, into bonus. A holding quietly stops being redeemable, and
        // stops being accepted at the next purchased-only recipient, without
        // anyone having chosen that.
        const byClass = new Map<string, Map<number, string[]>>();
        for (const [denomination, hashes] of tokenMap) {
            const d = Number(denomination);
            for (const hash of hashes ?? []) {
                const jwt = this.tokens?.get(issuer)?.get(hash);
                // A hash indexed with no JWT behind it is a stale index entry,
                // not a reason to abort a payment the rest of the pocket covers.
                if (!jwt) continue;
                const cls = effectiveTokenClass(jwt);
                const perDenomination = byClass.get(cls) ?? new Map<number, string[]>();
                perDenomination.set(d, [...(perDenomination.get(d) ?? []), jwt]);
                byClass.set(cls, perDenomination);
            }
        }

        const amountNeeded = this.outs.reduce((acc, out) => acc + (out.amount || 0), 0);
        const heldIn = (cls: string) =>
            [...(byClass.get(cls)?.entries() ?? [])].reduce(
                (sum, [d, jwtsOfD]) => sum + d * jwtsOfD.length,
                0,
            );

        // Fit every candidate class, then choose between the fits. Preference
        // breaks a tie; it does not get to manufacture change.
        //
        // Ordering by preference alone is not safe. A pocket holding one 100
        // bonus token and two purchased 5s, asked for 10, would take the bonus
        // token — spending 100 to send 10 and leaving 90 riding on a change
        // delivery, while an exact fit sat beside it. Change comes back in the
        // same class, so an overshoot is not a loss on paper; it is a loss every
        // time that delivery does not arrive, which is a failure this wallet
        // already carries recovery buttons for. The fit has to come first.
        const candidates = this.requiredClass
            ? [this.requiredClass]
            : [...byClass.keys()].sort(bySpendOrder);
        let best: { cls: string; change: number; use: Array<{ d: number, used: number }> } | undefined;
        for (const cls of candidates) {
            const perDenomination = byClass.get(cls);
            if (!perDenomination || heldIn(cls) < amountNeeded) continue;
            const [change, use] = this.greedy(
                [...perDenomination].map(([d, jwtsOfD]) => ({ d, c: jwtsOfD.length })),
                amountNeeded,
            );
            // `candidates` is already in preference order, so only a strictly
            // better fit displaces an earlier class — equal fits keep the most
            // usable one.
            if (best === undefined || change < best.change) best = { cls, change, use };
            // Nothing beats spending the exact amount.
            if (best.change === 0) break;
        }
        if (best === undefined) {
            throw new Error(this.shortfall(amountNeeded, byClass, heldIn));
        }
        this.selectedClass = best.cls;

        const chosenTokens = byClass.get(best.cls) ?? new Map<number, string[]>();
        const change = best.change;
        const jwts: string[] = [];
        for (const { d, used } of best.use) {
            jwts.push(...(chosenTokens.get(d) ?? []).slice(0, used));
        }
        // Prepare outputs (add change if needed)
        let outs: FungibleOut[] = [...this.outs];
        if (change > 0) {
            outs = [
                ...outs,
                { issuer, to: this.changeKey, amount: change }
            ];
        }
        // Return the transaction structure
        return [this.method, { ins: jwts, outs }];
    }
}