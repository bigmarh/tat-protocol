// A18: gate paths that granted access when they should have refused.
//
// - A "minimal disclosure" proof was entirely self-asserted: the client named
//   the issuer, declared itself unexpired and of a tier, and signed the nonce
//   with any key it liked. No token, no verification — anyone got in.
// - tokenIdPattern was skipped for a token with no tokenID.
// - Expiry was checked only when the (then client-chosen) requirements asked.
// - A session granted for one resource was valid for every resource.
// - GateBase treated a forge check that FAILED as a pass ("falling back to
//   offline mode") even when the gate was not configured for offline use.
import { GateServerSpec } from "../../packages/gate/src/GateServerSpec";
import { GateBase } from "../../packages/gate/src/GateBase";
import { Token, TokenType } from "@tat-protocol/token";
import { schnorr } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

const ISSUER_SK = "f1".repeat(32);
const ISSUER = bytesToHex(schnorr.getPublicKey(ISSUER_SK));
const HOLDER_SK = "f2".repeat(32);
const HOLDER = bytesToHex(schnorr.getPublicKey(HOLDER_SK));

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

async function issued(payload: Record<string, unknown>) {
  const t = new Token();
  await t.build({ token_type: TokenType.TAT, payload: Token.createPayload({ iss: ISSUER, P2PKlock: HOLDER, ...payload }) });
  const sig = await t.sign(await t.data_to_sign(), { secretKey: ISSUER_SK, publicKey: ISSUER });
  return await t.toJWT(bytesToHex(sig));
}

async function gate(requirements: Record<string, unknown>) {
  const g = new GateServerSpec({
    storage: new MemoryStore() as any,
    keys: { secretKey: "11".repeat(32), publicKey: "22".repeat(32) },
    relays: [],
    serviceName: "test",
    resources: { premium: { issuer: ISSUER, notExpired: false, ...requirements } },
  } as any) as any;
  g._saveState = async () => undefined;
  g.state = { challenges: new Map(), sessions: new Map(), usedNonces: new Set() };
  return g;
}

async function challengeFor(g: any) {
  const res = makeRes();
  await g.handleRequestAccess({ id: "r", params: JSON.stringify({ resource: "premium" }) }, { sender: HOLDER }, res);
  return res.calls[0].args[0].params;
}

async function prove(g: any, proof: unknown) {
  const res = makeRes();
  await g.handleProof({ id: "p", params: JSON.stringify(proof) }, { sender: HOLDER }, res);
  return res.calls[0].args[0].result;
}

const signNonce = (nonce: string) => bytesToHex(schnorr.sign(hexToBytes(nonce), HOLDER_SK));

describe("GateServerSpec fails closed", () => {
  it("refuses a minimal-disclosure proof, which nothing can verify", async () => {
    const g = await gate({});
    const c = await challengeFor(g);
    const result = await prove(g, {
      mode: "minimal",
      nonce: c.nonce,
      signature: signNonce(c.nonce),
      claim: { tokenHash: "00".repeat(32), issuer: ISSUER, holderPubkey: HOLDER, disclosed: { notExpired: true } },
    });
    expect(result.granted).toBe(false);
  });

  it("refuses a token with no tokenID when a tokenID pattern is required", async () => {
    const g = await gate({ tokenIdPattern: "^premium-" });
    const c = await challengeFor(g);
    const result = await prove(g, { mode: "full", tat: await issued({}), nonce: c.nonce, signature: signNonce(c.nonce) });
    expect(result.granted).toBe(false);
  });

  it("refuses an expired token even when the rules do not mention expiry", async () => {
    const g = await gate({});
    const c = await challengeFor(g);
    const tat = await issued({ tokenID: 1, exp: Math.floor(Date.now() / 1000) - 60 });
    const result = await prove(g, { mode: "full", tat, nonce: c.nonce, signature: signNonce(c.nonce) });
    expect(result.granted).toBe(false);
  });

  it("binds a session to the resource it was granted for", async () => {
    const g = await gate({});
    const c = await challengeFor(g);
    const result = await prove(g, { mode: "full", tat: await issued({ tokenID: 1 }), nonce: c.nonce, signature: signNonce(c.nonce) });
    expect(result.granted).toBe(true);
    expect(g.verifySession(result.session.token, "premium")).toBe(true);
    expect(g.verifySession(result.session.token, "admin")).toBe(false);
  });
});

describe("GateServerSpec sessions without a resource", () => {
  it("refuses a session saved before sessions were bound, and a call that names no resource", async () => {
    const g = await gate({});
    g.state.sessions.set("legacy", { token: "legacy", validUntil: Date.now() + 60_000, holderPubkey: HOLDER });
    expect(g.verifySession("legacy", "premium")).toBe(false);
    expect((g.verifySession as any)("legacy")).toBe(false);
    g.state.sessions.set("bound", { token: "bound", validUntil: Date.now() + 60_000, holderPubkey: HOLDER, resource: "premium" });
    expect((g.verifySession as any)("bound")).toBe(false);
  });
});

describe("GateBase fails closed when the forge cannot be asked", () => {
  class ForgeUnreachableGate extends (GateBase as any) {
    async validateTokenWithForge(): Promise<boolean> {
      throw new Error("forge unreachable");
    }
  }

  function base(offlineMode: boolean) {
    const g = new (ForgeUnreachableGate as any)({ storage: new MemoryStore(), offlineMode }) as any;
    g.state = { blockedTokens: new Set(), redemptions: new Map(), attempts: [] };
    g.recordAttempt = async () => undefined;
    return g;
  }

  it("denies access instead of passing a token it could not check", async () => {
    const result = await base(false).validateToken(await issued({ tokenID: 1 }));
    expect(result.valid).toBe(false);
  });

  it("does not ask the forge at all in offline mode", async () => {
    const result = await base(true).validateToken(await issued({ tokenID: 1 }));
    expect(result.valid).toBe(true);
  });
});
