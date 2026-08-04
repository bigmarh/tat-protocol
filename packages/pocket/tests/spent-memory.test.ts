import { bytesToHex } from '@noble/hashes/utils';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { Token, TokenType } from '@tat-protocol/token';
import { Pocket } from '../src/Pocket';

/**
 * A spent token does not stop looking like money.
 *
 * Its signature still verifies, its amount is unchanged, and the event that
 * delivered it is still sitting on a relay addressed to a key this wallet
 * holds. Every subscription that reaches back in time will therefore find it
 * again: the resume window on open looks an hour behind the last event seen, a
 * rescan looks thirty days, a backup restore reads whatever was in the file.
 *
 * `storeToken`'s duplicate check cannot catch this, because the token really is
 * not held any more — it was correctly deleted when it was spent. What the
 * wallet needs is a memory of what it has spent, and these tests are about that
 * memory: that spending writes to it, that a replay is refused because of it,
 * and that it does not grow forever.
 *
 * Like the pruning tests next door, these call the real implementations against
 * a hand-built receiver. Booting NDK, storage and a relay to answer "does this
 * come back" would test the harness more than the rule.
 */

type SpentMemory = Map<string, number>;

interface Receiver {
    state: {
        tokens: Map<string, Map<string, string>>;
        spentTokens?: SpentMemory;
    };
    saves: number;
    reindexed: string[];
    changes: number;
}

function receiver(held: Record<string, string[]> = {}): Receiver {
    const tokens = new Map<string, Map<string, string>>();
    for (const [issuer, hashes] of Object.entries(held)) {
        tokens.set(issuer, new Map(hashes.map((h) => [h, `jwt-for-${h}`])));
    }
    const self: Receiver = {
        state: { tokens },
        saves: 0,
        reindexed: [],
        changes: 0,
    };
    Object.assign(self, {
        async reindexIssuerState(issuer: string) {
            self.reindexed.push(issuer);
        },
        async savePocketState() {
            self.saves += 1;
        },
        onTokenChange: () => {
            self.changes += 1;
        },
        // The real siblings, because `rememberSpent` calls them on `this`. Stubs
        // here would leave the interaction between recording and pruning — which
        // is most of what these tests are about — untested.
        spentKey: Pocket.prototype['spentKey' as keyof Pocket],
        pruneSpentMemory: Pocket.prototype['pruneSpentMemory' as keyof Pocket],
    });
    return self;
}

/**
 * `deleteToken` restores the JWT to read its issuer and hash, which a fake
 * string cannot satisfy. Calling the private recorder directly is the same code
 * path from the point the two are known onward, and is what every caller of
 * `deleteToken` ends up reaching.
 */
const proto = Pocket.prototype as unknown as {
    rememberSpent(issuer: string, hash: string): void;
    pruneSpentMemory(): void;
    spentKey(issuer: string, hash: string): string;
};

const remember = (self: unknown, issuer: string, hash: string) =>
    proto.rememberSpent.call(self, issuer, hash);
const prune = (self: unknown) => proto.pruneSpentMemory.call(self);
const key = (issuer: string, hash: string) => proto.spentKey.call(null, issuer, hash);

const DAY = 24 * 60 * 60;
const nowSec = () => Math.floor(Date.now() / 1000);

describe('remembering what has been spent', () => {
    it('records a spend, scoped to the issuer that minted it', () => {
        const self = receiver();
        remember(self, 'bank', 'aaa');

        expect([...self.state.spentTokens!.keys()]).toEqual(['bank:aaa']);
        // Two issuers can mint tokens whose hashes collide; one spending must
        // not make the other's token unreceivable.
        expect(self.state.spentTokens!.has(key('other-bank', 'aaa'))).toBe(false);
    });

    it('refreshes a hash reported spent twice rather than double-counting it', () => {
        const self = receiver();
        remember(self, 'bank', 'aaa');
        remember(self, 'bank', 'aaa');

        expect(self.state.spentTokens!.size).toBe(1);
    });

    it('forgets a spend no subscription can reach any more', () => {
        // The memory only has to outlive the deepest lookback. Kept past that it
        // is dead weight in a state blob that is written on every token change.
        const self = receiver();
        self.state.spentTokens = new Map([
            [key('bank', 'ancient'), nowSec() - 31 * DAY],
            [key('bank', 'recent'), nowSec() - 1 * DAY],
        ]);

        prune(self);

        expect([...self.state.spentTokens.keys()]).toEqual([key('bank', 'recent')]);
    });

    it('caps the memory for a wallet that spends faster than the window expires', () => {
        // An agent paying per call can burn thousands of tokens well inside
        // thirty days. The TTL bounds an ordinary wallet; this bounds that one.
        const self = receiver();
        self.state.spentTokens = new Map();
        for (let i = 0; i < 20050; i++) {
            self.state.spentTokens.set(key('bank', `h${i}`), nowSec());
        }

        prune(self);

        expect(self.state.spentTokens.size).toBe(20000);
        // Oldest first: insertion order is spend order, so the survivors are the
        // spends most likely still to be replayed.
        expect(self.state.spentTokens.has(key('bank', 'h0'))).toBe(false);
        expect(self.state.spentTokens.has(key('bank', 'h20049'))).toBe(true);
    });

    it('prunes on every write, so the cap holds without anyone calling it', () => {
        const self = receiver();
        self.state.spentTokens = new Map([[key('bank', 'ancient'), nowSec() - 31 * DAY]]);

        remember(self, 'bank', 'fresh');

        expect([...self.state.spentTokens.keys()]).toEqual([key('bank', 'fresh')]);
    });
});

/**
 * The guard itself, against a real signed token.
 *
 * The point of this pair of tests is that nothing about the token changes when
 * it is spent — the same JWT verifies before and after — so the only thing that
 * can tell the second delivery from the first is what the wallet remembers.
 */
const ISSUER_SECRET = bytesToHex(generateSecretKey());
const ISSUER = getPublicKey(Buffer.from(ISSUER_SECRET, 'hex') as unknown as Uint8Array);

async function mint(amount: number): Promise<string> {
    const token = new Token();
    await token.build({
        token_type: TokenType.FUNGIBLE,
        payload: Token.createPayload({ iss: ISSUER, amount }),
    });
    const signature = await token.sign(await token.data_to_sign(), {
        secretKey: ISSUER_SECRET,
        publicKey: ISSUER,
    });
    return token.toJWT(bytesToHex(signature));
}

const store = (self: unknown, jwt: string) =>
    (Pocket.prototype as unknown as {
        storeToken(jwt: string): Promise<boolean>;
    }).storeToken.call(self, jwt);

function ingestReceiver() {
    const self = receiver();
    Object.assign(self, {
        async subscribeToIssuerSpent() {
            /* no relay in a unit test */
        },
    });
    return self;
}

describe('a replayed delivery of a spent token', () => {
    it('is taken the first time', async () => {
        const self = ingestReceiver();
        const jwt = await mint(25);

        expect(await store(self, jwt)).toBe(true);
        expect(self.state.tokens.get(ISSUER)?.size).toBe(1);
    });

    it('is refused once the wallet has spent it', async () => {
        // The scenario is ordinary: receive 25 BB, buy into a table with it,
        // reload the page. The resume window looks an hour behind the last event
        // seen, finds the delivery still on the relay, and offers it back.
        const self = ingestReceiver();
        const jwt = await mint(25);
        await store(self, jwt);

        const hash = (await new Token().restore(jwt)).header.token_hash!;
        self.state.tokens.get(ISSUER)!.delete(hash);
        remember(self, ISSUER, hash);

        expect(await store(self, jwt)).toBe(false);
        expect(self.state.tokens.get(ISSUER)?.size ?? 0).toBe(0);
    });

    it('is refused even though the token still verifies', async () => {
        // Guarding the reason, not just the outcome. If the signature or hash
        // check started rejecting it the test above would still pass, and the
        // memory it is meant to exercise would have stopped being load-bearing.
        const self = ingestReceiver();
        const jwt = await mint(25);
        const token = await new Token().restore(jwt);

        expect(await token.verifyTokenHash()).toBe(true);
        expect(await token.verifyTokenSignature()).toBe(true);

        remember(self, ISSUER, token.header.token_hash!);
        expect(await store(self, jwt)).toBe(false);
    });

    it('does not refuse another issuer\'s token that happens to share a hash', async () => {
        const self = ingestReceiver();
        const jwt = await mint(25);
        const hash = (await new Token().restore(jwt)).header.token_hash!;

        remember(self, 'some-other-issuer', hash);

        expect(await store(self, jwt)).toBe(true);
    });
});
