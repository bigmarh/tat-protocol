// A5: gate.request_access took its requirements from the CLIENT.
//
// The requester named the issuer (and tier, pattern, expiry rule) its token
// would be checked against, so anyone could mint a token from their own key,
// ask for a challenge requiring that key as issuer, and be granted access.
// Requirements now come from the gate's own configuration, per resource; an
// unknown resource is refused, and client-sent requirements are ignored.
import { GateServerSpec } from "../../packages/gate/src/GateServerSpec";
import { Token, TokenType } from "@tat-protocol/token";
import { schnorr } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

const REAL_ISSUER_SK = "e1".repeat(32);
const REAL_ISSUER = bytesToHex(schnorr.getPublicKey(REAL_ISSUER_SK));
const ATTACKER_SK = "e2".repeat(32);
const ATTACKER = bytesToHex(schnorr.getPublicKey(ATTACKER_SK));

class MemoryStore {
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
    send: async (...a: any[]) => void calls.push({ type: "send", args: a }),
    error: async (...a: any[]) => void calls.push({ type: "error", args: a }),
  } as any;
}

async function gate(resources?: Record<string, unknown>) {
  const g = new GateServerSpec({
    storage: new MemoryStore() as any,
    keys: { secretKey: "11".repeat(32), publicKey: "22".repeat(32) },
    relays: [],
    serviceName: "test",
    ...(resources ? { resources } : {}),
  } as any) as any;
  g._saveState = async () => undefined;
  g.state = { challenges: new Map(), sessions: new Map(), usedNonces: new Set() };
  return g;
}

/** A token the holder's own key issued and is locked to. */
async function selfIssuedToken(sk: string) {
  const pub = bytesToHex(schnorr.getPublicKey(sk));
  const t = new Token();
  await t.build({ token_type: TokenType.TAT, payload: Token.createPayload({ iss: pub, tokenID: 1, P2PKlock: pub }) });
  const sig = await t.sign(await t.data_to_sign(), { secretKey: sk, publicKey: pub });
  return await t.toJWT(bytesToHex(sig));
}

async function requestAndProve(g: any, requester: string, sk: string, params: Record<string, unknown>) {
  const res = makeRes();
  await g.handleRequestAccess({ id: "r", params: JSON.stringify(params) }, { sender: requester }, res);
  const challenge = res.calls.find((c: any) => c.type === "send")?.args[0]?.params;
  if (!challenge) return { challenge, res };
  const proof = {
    mode: "full",
    tat: await selfIssuedToken(sk),
    nonce: challenge.nonce,
    signature: bytesToHex(schnorr.sign(hexToBytes(challenge.nonce), sk)),
  };
  const pres = makeRes();
  await g.handleProof({ id: "p", params: JSON.stringify(proof) }, { sender: requester }, pres);
  return { challenge, res, result: pres.calls[0]?.args[0]?.result };
}

describe("gate requirements come from the gate, not the requester", () => {
  it("checks the configured issuer, whatever the client asks for", async () => {
    const g = await gate({ premium: { issuer: REAL_ISSUER, notExpired: true } });
    const { challenge, result } = await requestAndProve(g, ATTACKER, ATTACKER_SK, {
      resource: "premium",
      requirements: { issuer: ATTACKER, notExpired: false },
    });
    expect(challenge.requirements.issuer).toBe(REAL_ISSUER);
    expect(result.granted).toBe(false);
  });

  it("refuses a resource it has no requirements for", async () => {
    const g = await gate({ premium: { issuer: REAL_ISSUER, notExpired: true } });
    const res = makeRes();
    await g.handleRequestAccess(
      { id: "r", params: JSON.stringify({ resource: "admin", requirements: { issuer: ATTACKER, notExpired: false } }) },
      { sender: ATTACKER },
      res,
    );
    expect(res.calls[0].type).toBe("error");
    expect(g.state.challenges.size).toBe(0);
  });

  it("grants nothing when no resources are configured", async () => {
    const g = await gate();
    const { challenge } = await requestAndProve(g, ATTACKER, ATTACKER_SK, {
      resource: "anything",
      requirements: { issuer: ATTACKER, notExpired: false },
    });
    expect(challenge).toBeUndefined();
  });

  it("still grants a holder of the configured issuer's token", async () => {
    const g = await gate({ premium: { issuer: REAL_ISSUER, notExpired: true } });
    const holderSk = "e3".repeat(32);
    const holder = bytesToHex(schnorr.getPublicKey(holderSk));
    const res = makeRes();
    await g.handleRequestAccess({ id: "r", params: JSON.stringify({ resource: "premium" }) }, { sender: holder }, res);
    const challenge = res.calls[0].args[0].params;
    const t = new Token();
    await t.build({ token_type: TokenType.TAT, payload: Token.createPayload({ iss: REAL_ISSUER, tokenID: 7, P2PKlock: holder }) });
    const sig = await t.sign(await t.data_to_sign(), { secretKey: REAL_ISSUER_SK, publicKey: REAL_ISSUER });
    const proof = {
      mode: "full",
      tat: await t.toJWT(bytesToHex(sig)),
      nonce: challenge.nonce,
      signature: bytesToHex(schnorr.sign(hexToBytes(challenge.nonce), holderSk)),
    };
    const pres = makeRes();
    await g.handleProof({ id: "p", params: JSON.stringify(proof) }, { sender: holder }, pres);
    expect(pres.calls[0].args[0].result.granted).toBe(true);
  });
});
