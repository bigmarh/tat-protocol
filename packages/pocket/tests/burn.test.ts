import { Pocket } from '../src/Pocket';
import { Token, TokenType } from '@tat-protocol/token';
import { burnAuthDigest, txIdForInputs } from '@tat-protocol/utils';
import { schnorr } from '@noble/curves/secp256k1';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

/**
 * The forge now requires a burn witness from the token's lock key over
 * burnAuthDigest — which no SDK client could produce, so every burn broke.
 * `Pocket.burn()` builds it.
 */
const ME_SK = '0a'.repeat(32);
const ME = bytesToHex(schnorr.getPublicKey(ME_SK));
const ISSUER = 'f'.repeat(64);

async function lockedToMe() {
    const t = new Token();
    await t.build({ token_type: TokenType.FUNGIBLE, payload: Token.createPayload({ iss: ISSUER, amount: 5, P2PKlock: ME }) });
    const jwt = await t.toJWT('00'.repeat(64));
    return { jwt, hash: (await new Token().restore(jwt)).header.token_hash! };
}

function pocketWith(respond: (method: string, params: any) => unknown) {
    const self = Object.create(Pocket.prototype) as any;
    Object.assign(self, {
        publicKey: ME,
        keys: { publicKey: ME, secretKey: ME_SK },
        state: { singleUseKeys: new Map() },
        requests: [] as any[],
        deleted: [] as string[],
    });
    self.request = async (method: string, params: any) => {
        self.requests.push({ method, params });
        return respond(method, params);
    };
    self.deleteToken = async (jwt: string) => void self.deleted.push(jwt);
    return self;
}

describe('Pocket.burn', () => {
    it('sends a burn witness from the lock key and drops the token once committed', async () => {
        const t = await lockedToMe();
        const self = pocketWith(() => ({ result: { tx_id: txIdForInputs([t.hash]), status: 'committed', outputs: [] } }));

        await self.burn(t.jwt);

        const [call] = self.requests;
        expect(call.method).toBe('burn');
        expect(call.params.token).toBe(t.jwt);
        expect(schnorr.verify(hexToBytes(call.params.witness), burnAuthDigest(t.hash), ME)).toBe(true);
        expect(self.deleted).toEqual([t.jwt]);
    });

    it('keeps the token when the forge refuses', async () => {
        const t = await lockedToMe();
        const self = pocketWith(() => ({ error: { code: 2004, message: 'Unauthorized' } }));
        await expect(self.burn(t.jwt)).rejects.toThrow(/Unauthorized/);
        expect(self.deleted).toEqual([]);
    });

    it('recovers a lost reply through status', async () => {
        const t = await lockedToMe();
        const self = pocketWith((method) => {
            if (method === 'burn') throw new Error('Request timed out');
            return { result: { tx_id: txIdForInputs([t.hash]), status: 'committed', outputs: [] } };
        });
        await self.burn(t.jwt);
        expect(self.deleted).toEqual([t.jwt]);
    });
});
