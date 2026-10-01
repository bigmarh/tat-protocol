import { Pocket } from '../src/Pocket';
import { Token, TokenType } from '@tat-protocol/token';
import { txIdForInputs } from '@tat-protocol/utils';

/**
 * A transfer whose reply never arrives used to leave the pocket blind: it could
 * not tell "the forge never saw it" (inputs still good, retry is safe) from "it
 * committed and the reply was lost" (inputs gone, outputs waiting at the
 * forge). `sendTx` now asks the forge with `status {tx_id}` — the id is derived
 * from the inputs, so it is known even when every response was lost — and acts
 * on the answer.
 */
const ISSUER = 'f'.repeat(64);
const ME = 'a'.repeat(64);
const MY_CHANGE = 'c'.repeat(64);
const BOB = 'b'.repeat(64);

async function jwtLockedTo(lock: string | undefined, amount: number): Promise<string> {
    const t = new Token();
    await t.build({
        token_type: TokenType.FUNGIBLE,
        payload: Token.createPayload({ iss: ISSUER, amount, ...(lock ? { P2PKlock: lock } : {}) }),
    });
    return await t.toJWT('00'.repeat(64));
}

function pocketWith(respond: (method: string, params: any) => unknown) {
    // A real Pocket's prototype, with the network and persistence edges stubbed.
    const self = Object.create(Pocket.prototype) as any;
    self.publicKey = ME;
    self.state = { singleUseKeys: new Map([[MY_CHANGE, { publicKey: MY_CHANGE, secretKey: '11'.repeat(32) }]]) };
    self.requests = [] as Array<{ method: string; params: any }>;
    self.stored = [] as string[];
    self.deleted = [] as string[];
    self.buildWitnessData = async () => [];
    self.request = async (method: string, params: any) => {
        self.requests.push({ method, params });
        return respond(method, params);
    };
    self.storeToken = async (jwt: string) => {
        self.stored.push(jwt);
        return true;
    };
    self.deleteToken = async (jwt: string) => {
        self.deleted.push(jwt);
    };
    return self;
}

const timeout = () => {
    throw new Error('Request timed out');
};

describe('sendTx recovers a lost transfer reply through status', () => {
    let input: string;
    let inputHash: string;
    let changeOut: string;
    let bobOut: string;

    beforeAll(async () => {
        input = await jwtLockedTo(undefined, 100);
        inputHash = (await new Token().restore(input)).header.token_hash!;
        changeOut = await jwtLockedTo(MY_CHANGE, 40);
        bobOut = await jwtLockedTo(BOB, 60);
    });

    const tx = () => ({
        ins: [input],
        outs: [
            { to: BOB, amount: 60 },
            { to: MY_CHANGE, amount: 40 },
        ],
    });

    it('stores its own outputs and drops the inputs when the forge committed', async () => {
        const self = pocketWith((method) => {
            if (method === 'transfer') return timeout();
            return {
                result: {
                    tx_id: txIdForInputs([inputHash]),
                    status: 'committed',
                    outputs: [
                        { to: BOB, token: bobOut },
                        { to: MY_CHANGE, token: changeOut },
                    ],
                },
            };
        });

        const response = await self.sendTx('transfer', ISSUER, tx());

        expect(self.requests.map((r: any) => r.method)).toEqual(['transfer', 'status']);
        expect(self.requests[1].params).toEqual({ tx_id: txIdForInputs([inputHash]) });
        expect(response.result.status).toBe('committed');
        // Only the output locked to a key this pocket holds.
        expect(self.stored).toEqual([changeOut]);
        expect(self.deleted).toEqual([input]);
    });

    it('keeps the inputs when the forge has no record of the transfer', async () => {
        const self = pocketWith((method) => {
            if (method === 'transfer') return timeout();
            return { result: { tx_id: txIdForInputs([inputHash]), status: 'unknown', outputs: [] } };
        });

        await expect(self.sendTx('transfer', ISSUER, tx())).rejects.toThrow(/timed out/);
        expect(self.deleted).toEqual([]);
        expect(self.stored).toEqual([]);
    });

    it('keeps the inputs when status cannot be reached either', async () => {
        const self = pocketWith(() => timeout());
        await expect(self.sendTx('transfer', ISSUER, tx())).rejects.toThrow(/timed out/);
        expect(self.deleted).toEqual([]);
    });

    it('stores its own outputs carried in a committed reply', async () => {
        const self = pocketWith(() => ({
            result: {
                tx_id: txIdForInputs([inputHash]),
                status: 'committed',
                outputs: [
                    { to: BOB, token: bobOut },
                    { to: MY_CHANGE, token: changeOut },
                ],
            },
        }));

        await self.sendTx('transfer', ISSUER, tx());
        expect(self.requests.map((r: any) => r.method)).toEqual(['transfer']);
        expect(self.stored).toEqual([changeOut]);
        expect(self.deleted).toEqual([input]);
    });

    it('can ask for a transfer status directly', async () => {
        const self = pocketWith(() => ({ result: { tx_id: 'x', status: 'unknown', outputs: [] } }));
        expect(await self.fetchTxStatus(ISSUER, 'x')).toEqual({ tx_id: 'x', status: 'unknown', outputs: [] });
    });
});
