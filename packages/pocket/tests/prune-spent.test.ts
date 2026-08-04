import { Pocket } from '../src/Pocket';

/**
 * `pruneSpentTokens` reads `this.state.tokens` and calls `this.request`,
 * `this.deleteToken` and `this.savePocketState` — nothing else. Invoking it
 * against a hand-built receiver exercises the real implementation without
 * standing up NDK, storage and a relay connection to ask one question.
 */
function receiver(held: Record<string, string[]>) {
    const tokens = new Map<string, Map<string, string>>();
    for (const [issuer, hashes] of Object.entries(held)) {
        tokens.set(issuer, new Map(hashes.map((h) => [h, `jwt-for-${h}`])));
    }
    const calls: Array<{ issuer: string; hashes: string[] }> = [];
    const self = {
        state: { tokens },
        calls,
        saves: 0,
        respond: (_issuer: string, hashes: string[]) =>
            ({ result: { spent: Object.fromEntries(hashes.map((h) => [h, false])) } }) as unknown,
        async request(_method: string, params: { token_hashes: string[] }, issuer: string) {
            calls.push({ issuer, hashes: params.token_hashes });
            return self.respond(issuer, params.token_hashes);
        },
        async deleteToken(jwt: string) {
            for (const byHash of tokens.values()) {
                for (const [hash, held] of byHash) if (held === jwt) byHash.delete(hash);
            }
        },
        async savePocketState() {
            self.saves += 1;
        },
    };
    return self;
}

const prune = (self: unknown, issuers?: string[]) =>
    (Pocket.prototype as unknown as {
        pruneSpentTokens(i?: string[]): Promise<{ pruned: number; reconciled: boolean }>;
    }).pruneSpentTokens.call(self, issuers);

const remaining = (self: { state: { tokens: Map<string, Map<string, string>> } }, issuer: string) =>
    [...(self.state.tokens.get(issuer)?.keys() ?? [])].sort();

describe('pruning spent tokens against the issuer', () => {
    it('deletes what the issuer calls spent and keeps the rest', async () => {
        const self = receiver({ bank: ['a', 'b', 'c'] });
        self.respond = () => ({ result: { spent: { a: true, b: false, c: true } } });

        const result = await prune(self);

        expect(result).toEqual({ pruned: 2, reconciled: true });
        expect(remaining(self, 'bank')).toEqual(['b']);
    });

    it('is a no-op when nothing is spent, and does not write state', async () => {
        const self = receiver({ bank: ['a', 'b'] });

        const result = await prune(self);

        expect(result).toEqual({ pruned: 0, reconciled: true });
        expect(remaining(self, 'bank')).toEqual(['a', 'b']);
        expect(self.saves).toBe(0);
    });

    it('splits a long history into batches rather than one oversized request', async () => {
        const hashes = Array.from({ length: 450 }, (_, i) => `h${i}`);
        const self = receiver({ bank: hashes });

        await prune(self);

        expect(self.calls.map((c) => c.hashes.length)).toEqual([200, 200, 50]);
    });

    it('reports it could not reconcile when the issuer answers with an error', async () => {
        const self = receiver({ bank: ['a', 'b'] });
        self.respond = () => ({ error: { code: 1, message: 'nope' } });

        const result = await prune(self);

        // Nothing is assumed spent on a failed answer — the tokens stay.
        expect(result).toEqual({ pruned: 0, reconciled: false });
        expect(remaining(self, 'bank')).toEqual(['a', 'b']);
    });

    it('reports it could not reconcile when the issuer is unreachable', async () => {
        const self = receiver({ bank: ['a'] });
        self.respond = () => {
            throw new Error('relay down');
        };

        await expect(prune(self)).resolves.toEqual({ pruned: 0, reconciled: false });
        expect(remaining(self, 'bank')).toEqual(['a']);
    });

    it('keeps going for other issuers when one is unreachable', async () => {
        const self = receiver({ good: ['a'], bad: ['b'] });
        self.respond = (issuer, hashes) => {
            if (issuer === 'bad') throw new Error('relay down');
            return { result: { spent: Object.fromEntries(hashes.map((h) => [h, true])) } };
        };

        const result = await prune(self);

        expect(result).toEqual({ pruned: 1, reconciled: false });
        expect(remaining(self, 'good')).toEqual([]);
        expect(remaining(self, 'bad')).toEqual(['b']);
    });

    it('asks only the issuers it was given', async () => {
        const self = receiver({ one: ['a'], two: ['b'] });

        await prune(self, ['one']);

        expect(self.calls.map((c) => c.issuer)).toEqual(['one']);
    });
});
