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
     */
    private requiredClass: string | null = null;

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
     * The class of a held token, read from its `data_uri`.
     *
     * Unreadable or absent metadata is treated as no class rather than guessed
     * at: an issuer that tags nothing would otherwise have every token excluded
     * the moment a class was requested.
     */
    private classOf(jwt: string): string | null {
        return tokenClassOf(jwt);
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
        // Gather denominations for the issuer
        const denominations: Array<{ d: number, c: number }> = [];
        const tokenMap = this.tokenIndex?.get(issuer);
        if (!tokenMap) {
            throw new Error(`No tokens found for issuer: ${issuer}`);
        }
        // Hashes eligible under the class restriction, per denomination. Built
        // once so selection and collection cannot disagree about which tokens
        // are spendable.
        const eligible = new Map<number, string[]>();
        for (const [denomination, tokens] of tokenMap) {
            const d = Number(denomination);
            const usable = (tokens ?? []).filter((hash) => {
                if (!this.requiredClass) return true;
                const jwt = this.tokens?.get(issuer)?.get(hash);
                if (!jwt) return false;
                const cls = this.classOf(jwt);
                // Untagged tokens count as purchased, which is how the bank
                // treats them when it merges input metadata.
                return cls === null
                    ? this.requiredClass === 'purchased'
                    : cls === this.requiredClass;
            });
            eligible.set(d, usable);
            denominations.push({ d, c: usable.length });
        }
        // Calculate total amount needed
        const amountNeeded = this.outs.reduce((acc, out) => acc + (out.amount || 0), 0);
        const available = denominations.reduce((sum, x) => sum + x.d * x.c, 0);
        if (available < amountNeeded) {
            throw new Error(
                this.requiredClass
                    ? `Not enough "${this.requiredClass}" BotBucks: need ${amountNeeded}, hold ${available}. ` +
                      'Classes cannot be converted.'
                    : `Not enough BotBucks: need ${amountNeeded}, hold ${available}.`,
            );
        }
        const [change, use] = this.greedy(denominations, amountNeeded);
        // Collect JWTs
        let jwts: string[] = [];
        for (const { d, used } of use) {
            const tokenHashes = eligible.get(d);
            if (!tokenHashes || tokenHashes.length < used) {
                throw new Error(
                    `Not enough tokens for issuer: ${issuer}, denomination: ${d}` +
                    (this.requiredClass ? ` of class "${this.requiredClass}"` : ''),
                );
            }
            // Look up JWTs for each token hash
            for (const tokenHash of tokenHashes.slice(0, used)) {
                const jwt = this.tokens?.get(issuer)?.get(tokenHash);
                if (!jwt) {
                    throw new Error(`JWT not found for token hash: ${tokenHash}`);
                }
                jwts.push(jwt);
            }
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