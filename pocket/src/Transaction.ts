import { PocketState } from './Pocket';

export interface FungibleOut {
    issuer: string,
    to: string,
    amount: number
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
    transferTAT(issuer: string, to: string, tokenID: string) {
        const tokenHash = this.tatIndex.get(issuer)?.get(tokenID);
        if (!tokenHash) {
            throw new Error(`TAT not found: ${issuer}:${tokenID}`);
        }
        const jwt = this.tokens.get(issuer)?.get(tokenHash);
        if (!jwt) {
            throw new Error(`JWT not found: ${issuer}:${tokenID}:${to}`);
        }
     
        //return the method,  issuer, TAT tx
        return ['transferTAT', {token: jwt, to: to}];
    }

    private greedy(denominations: Array<{ d: number, c: number }>, target: number): [number, Array<{ d: number, used: number }>] {
        // Sort by denomination descending (largest first)
        const sorted = [...denominations].sort((a, b) => b.d - a.d);

        const result: Array<{ d: number, used: number }> = [];
        let remaining = target;

        for (const { d, c } of sorted) {
            if (remaining === 0) break;

            // Use as many of this denomination as possible
            const canUse = Math.min(Math.floor(remaining / d), c);

            if (canUse > 0) {
                result.push({ d, used: canUse });
                remaining -= canUse * d;
            }
        }

        // Check if we made exact change
        return [remaining, result];
    }


    /**
     * Builds the transaction input/output structure for a single-issuer fungible token transfer.
     * Enforces that all outputs have the same issuer. Does not mutate this.outs.
     * @returns [method, issuer, { ins: string[], outs: FungibleOut[] }]
     * @throws Error if outs is empty, issuers differ, or tokens are missing.
     */
    public  build() {
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
            const tokens = tokenMap.get(d);
            if (!tokens || tokens.length < used) {
                throw new Error(`Not enough tokens for issuer: ${issuer}, denomination: ${d}`);
            }
            jwts.push(...tokens.slice(0, used));
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
