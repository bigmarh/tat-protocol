// Adversarial test for the concurrent double-spend race (audit C1). The forge
// checks the spent-set, then signs outputs, then marks the input spent — with
// awaits in between. Two transfers of the SAME input, interleaved on the event
// loop, can both pass the spent-check before either marks spent, minting the
// value twice. A per-forge critical section must serialize them so exactly one
// succeeds.
import "@tat-protocol/nwpc";
import { FungibleForge } from "@tat-protocol/forge";
import { Token, TokenType } from "@tat-protocol/token";
import type { StorageInterface } from "@tat-protocol/storage";
import { schnorr } from "@noble/curves/secp256k1";
import { bytesToHex } from "@noble/hashes/utils";

const OWNER_SK = "33".repeat(32);
const OWNER = bytesToHex(schnorr.getPublicKey(OWNER_SK));
const ALICE = "e".repeat(64);
const BOB = "f".repeat(64);

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

function makeForge() {
  const forge = new FungibleForge({
    owner: OWNER,
    keys: { secretKey: OWNER_SK, publicKey: OWNER },
    storage: new MemStore(),
    totalSupply: 0,
    relays: [],
  } as any);
  (forge as any).keys = { secretKey: OWNER_SK, publicKey: OWNER };
  return forge;
}

async function mintFungible(forge: any, amount: number): Promise<string> {
  const t = new Token();
  await t.build({
    token_type: TokenType.FUNGIBLE,
    payload: Token.createPayload({ iss: OWNER, amount }),
  });
  return await forge.signAndCreateJWT(t);
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

function tokenSends(res: any): number {
  return res.calls.filter(
    (c: any) => c.type === "send" && c.args?.[0] && "token" in c.args[0],
  ).length;
}

describe("C1: concurrent transfers of the same input", () => {
  it("mints the value at most once when two transfers race", async () => {
    const forge = makeForge();
    const input = await mintFungible(forge, 100);

    const req = {
      params: JSON.stringify({
        ins: [input],
        outs: [{ to: BOB, amount: 100 }],
      }),
    };
    const ctx = { sender: ALICE };

    const resA = makeRes();
    const resB = makeRes();

    // Fire both transfers of the same input concurrently.
    await Promise.all([
      forge.transferToken(req as any, ctx as any, resA),
      forge.transferToken(req as any, ctx as any, resB),
    ]);

    // Exactly one recipient token may be minted from a single 100-unit input.
    const totalMinted = tokenSends(resA) + tokenSends(resB);
    expect(totalMinted).toBe(1);
  });
});
