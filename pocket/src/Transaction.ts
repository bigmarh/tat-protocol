import { PocketState } from './Pocket';

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

export class Transaction {
    private tatIndex: Map<string, Map<string, string>>;
    private tokenIndex: Map<string, Map<number, string[]>>;
    private tokens: Map<string, Map<string, string>>;

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
        return ['transferTAT', { ins: [jwt], outs: [{ issuer: issuer, to: to, tokenID: tokenID }] }];
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
        for (const [denomination, tokens] of tokenMap) {
            denominations.push({ d: Number(denomination), c: tokens ? tokens.length : 0 });
        }
        // Calculate total amount needed
        const amountNeeded = this.outs.reduce((acc, out) => acc + (out.amount || 0), 0);
        const [change, use] = this.greedy(denominations, amountNeeded);
        // Collect JWTs
        let jwts: string[] = [];
        for (const { d, used } of use) {
            const tokenHashes = tokenMap.get(d);
            if (!tokenHashes || tokenHashes.length < used) {
                throw new Error(`Not enough tokens for issuer: ${issuer}, denomination: ${d}`);
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