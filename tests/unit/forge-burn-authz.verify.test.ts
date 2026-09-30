// Unauthenticated burn.
//
// `burn` checked only that the JWT was well-formed, self-consistent and
// unspent. It asked for no witness and never compared `iss` to the forge, so
// anyone who had seen a token — a recipient's JWT goes over the relay — could
// destroy it, and a token from a different issuer was marked spent here too.
//
// A burn must now carry a P2PK witness from the token's lock key over a
// burn-specific digest (so a transfer witness cannot be replayed as a burn),
// and the token must be one this forge issued.
import "@tat-protocol/nwpc";
import { FungibleForge } from "@tat-protocol/forge";
import { Token, TokenType } from "@tat-protocol/token";
import type { StorageInterface } from "@tat-protocol/storage";
import { burnAuthDigest, spendAuthDigest } from "@tat-protocol/utils";
import { schnorr } from "@noble/curves/secp256k1";
import { bytesToHex } from "@noble/hashes/utils";

const OWNER_SK = "66".repeat(32);
const OWNER = bytesToHex(schnorr.getPublicKey(OWNER_SK));
const ALICE_SK = "77".repeat(32);
const ALICE = bytesToHex(schnorr.getPublicKey(ALICE_SK));
const MALLORY_SK = "88".repeat(32);
const MALLORY = bytesToHex(schnorr.getPublicKey(MALLORY_SK));
const OTHER_FORGE_SK = "99".repeat(32);
const OTHER_FORGE = bytesToHex(schnorr.getPublicKey(OTHER_FORGE_SK));

class MemStore implements StorageInterface {
  private m = new Map<string, string>();
  async getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  async setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  async removeItem(k: string) {
    this.m.delete(k);
  }
  async clear() {
    this.m.clear();
  }
}

function makeRes() {
  const calls: { type: string; args: any[] }[] = [];
  return {
    calls,
    send: async (...args: any[]) => {
      calls.push({ type: "send", args });
    },
    error: async (...args: any[]) => {
      calls.push({ type: "error", args });
    },
  } as any;
}
const errorOf = (res: any) => res.calls.find((c: any) => c.type === "error")?.args;

describe("burn requires the lock key and this forge's issuance", () => {
  let forge: any;

  beforeEach(() => {
    forge = new FungibleForge({
      owner: OWNER,
      keys: { secretKey: OWNER_SK, publicKey: OWNER },
      storage: new MemStore(),
      totalSupply: 0,
      relays: [],
    } as any);
    forge.keys = { secretKey: OWNER_SK, publicKey: OWNER };
    forge.announceSpent = () => undefined;
  });

  async function token(opts: { lock?: string; issuerSk?: string } = {}) {
    const issuerSk = opts.issuerSk ?? OWNER_SK;
    const iss = bytesToHex(schnorr.getPublicKey(issuerSk));
    const t = new Token();
    await t.build({
      token_type: TokenType.FUNGIBLE,
      payload: Token.createPayload({ iss, amount: 50, ...(opts.lock ? { P2PKlock: opts.lock } : {}) }),
    });
    const sig = await t.sign(await t.data_to_sign(), { secretKey: issuerSk, publicKey: iss });
    const jwt = await t.toJWT(bytesToHex(sig));
    return { jwt, hash: t.header.token_hash };
  }

  const sign = (msg: Uint8Array, sk: string) => bytesToHex(schnorr.sign(msg, sk));

  async function burn(params: Record<string, unknown>, sender = ALICE) {
    const res = makeRes();
    await forge.burnToken({ id: "b1", method: "burn", params: JSON.stringify(params) }, { sender }, res);
    return res;
  }

  it("burns with a witness from the lock key over the burn digest", async () => {
    const t = await token({ lock: ALICE });
    const res = await burn({ token: t.jwt, witness: sign(burnAuthDigest(t.hash), ALICE_SK) });
    expect(errorOf(res)).toBeUndefined();
    expect(await forge.isTokenSpent(t.hash)).toBe(true);
  });

  it("refuses a burn with no witness", async () => {
    const t = await token({ lock: ALICE });
    const res = await burn({ token: t.jwt }, MALLORY);
    expect(errorOf(res)).toBeDefined();
    expect(await forge.isTokenSpent(t.hash)).toBe(false);
  });

  it("refuses a witness from any key but the lock's", async () => {
    const t = await token({ lock: ALICE });
    const res = await burn({ token: t.jwt, witness: sign(burnAuthDigest(t.hash), MALLORY_SK) }, MALLORY);
    expect(errorOf(res)?.[0]).toBe(2004);
    expect(await forge.isTokenSpent(t.hash)).toBe(false);
  });

  it("refuses a transfer witness replayed as a burn", async () => {
    const t = await token({ lock: ALICE });
    for (const outs of [[], [{ to: ALICE, amount: 50 }]]) {
      const res = await burn({ token: t.jwt, witness: sign(spendAuthDigest(t.hash, outs), ALICE_SK) }, MALLORY);
      expect(errorOf(res)?.[0]).toBe(2004);
    }
    expect(await forge.isTokenSpent(t.hash)).toBe(false);
  });

  it("refuses a bare token-hash (legacy) witness", async () => {
    const t = await token({ lock: ALICE });
    const { hexToBytes } = await import("@noble/hashes/utils");
    const res = await burn({ token: t.jwt, witness: sign(hexToBytes(t.hash), ALICE_SK) }, MALLORY);
    expect(errorOf(res)?.[0]).toBe(2004);
    expect(await forge.isTokenSpent(t.hash)).toBe(false);
  });

  it("refuses a token issued by a different forge", async () => {
    const t = await token({ lock: ALICE, issuerSk: OTHER_FORGE_SK });
    const res = await burn({ token: t.jwt, witness: sign(burnAuthDigest(t.hash), ALICE_SK) });
    expect(errorOf(res)?.[0]).toBe(2004);
    expect(await forge.isTokenSpent(t.hash)).toBe(false);
    expect(OTHER_FORGE).not.toBe(OWNER);
  });

  it("refuses an unlocked token, which no key can authorize burning", async () => {
    const t = await token();
    const res = await burn({ token: t.jwt, witness: sign(burnAuthDigest(t.hash), ALICE_SK) }, MALLORY);
    expect(errorOf(res)?.[0]).toBe(2004);
    expect(await forge.isTokenSpent(t.hash)).toBe(false);
  });

  it("reports an already-spent token as spent", async () => {
    const t = await token({ lock: ALICE });
    const witness = sign(burnAuthDigest(t.hash), ALICE_SK);
    await burn({ token: t.jwt, witness });
    const again = await burn({ token: t.jwt, witness });
    expect(errorOf(again)?.[0]).toBe(2002);
  });
});
