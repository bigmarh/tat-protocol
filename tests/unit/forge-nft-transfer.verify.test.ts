// The NFT transfer path and what the spender signed.
//
// - The v2 spend digest binds each output's `timeLock`, but the NFT forge
//   copied the INPUT's timeLock onto the new token, silently discarding what
//   the spender signed.
// - An input that no output referred to was left out of the transfer: not
//   spent, and not in the tx id, so the tx id the forge recorded differed from
//   the one a pocket computes over everything it sent, and `status` recovery
//   missed.
import "@tat-protocol/nwpc";
import { NonFungibleForge } from "@tat-protocol/forge";
import { Token, TokenType } from "@tat-protocol/token";
import { txIdForInputs } from "@tat-protocol/utils";
import { schnorr } from "@noble/curves/secp256k1";
import { bytesToHex } from "@noble/hashes/utils";

const OWNER_SK = "ce".repeat(32);
const OWNER = bytesToHex(schnorr.getPublicKey(OWNER_SK));
const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);

class MemStore {
  m = new Map<string, string>();
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
  const forge = new NonFungibleForge({
    owner: OWNER,
    keys: { secretKey: OWNER_SK, publicKey: OWNER },
    storage: new MemStore(),
    totalSupply: 0,
    relays: [],
  } as any) as any;
  forge.keys = { secretKey: OWNER_SK, publicKey: OWNER };
  forge.announceSpent = () => undefined;
  return forge;
}

async function nft(forge: any, tokenID: number) {
  const t = new Token();
  await t.build({ token_type: TokenType.TAT, payload: Token.createPayload({ iss: OWNER, tokenID }) });
  const jwt = await forge.signAndCreateJWT(t);
  return { jwt, hash: (await new Token().restore(jwt)).header.token_hash as string };
}

function makeRes() {
  const calls: { type: string; args: any[] }[] = [];
  return {
    calls,
    send: async (...args: any[]) => void calls.push({ type: "send", args }),
    error: async (...args: any[]) => void calls.push({ type: "error", args }),
  } as any;
}

describe("NFT transfers honour what the spender signed", () => {
  it("gives the new token the output's timeLock", async () => {
    const forge = makeForge();
    const a = await nft(forge, 1);
    const lockUntil = Math.floor(Date.now() / 1000) + 86_400;
    const res = makeRes();
    await forge.transferToken(
      { id: "t1", params: JSON.stringify({ ins: [a.jwt], outs: [{ to: BOB, tokenID: "1", timeLock: lockUntil }] }) },
      { sender: ALICE },
      res,
    );
    const sent = res.calls.find((c: any) => c.type === "send" && c.args[0]?.token);
    expect(sent).toBeDefined();
    const out = await new Token().restore(sent.args[0].token);
    expect(out.payload.timeLock).toBe(lockUntil);
  });

  it("refuses an input no output uses, and spends nothing", async () => {
    const forge = makeForge();
    const a = await nft(forge, 1);
    const b = await nft(forge, 2);
    const res = makeRes();
    await forge.transferToken(
      { id: "t2", params: JSON.stringify({ ins: [a.jwt, b.jwt], outs: [{ to: BOB, tokenID: "1" }] }) },
      { sender: ALICE },
      res,
    );
    expect(res.calls.some((c: any) => c.type === "error")).toBe(true);
    expect(await forge.isTokenSpent(a.hash)).toBe(false);
    expect(await forge.isTokenSpent(b.hash)).toBe(false);
  });

  it("records the transfer under the tx id a pocket computes from its inputs", async () => {
    const forge = makeForge();
    const a = await nft(forge, 1);
    const b = await nft(forge, 2);
    await forge.transferToken(
      {
        id: "t3",
        params: JSON.stringify({ ins: [a.jwt, b.jwt], outs: [{ to: BOB, tokenID: "1" }, { to: ALICE, tokenID: "2" }] }),
      },
      { sender: ALICE },
      makeRes(),
    );
    expect(await forge.getTx(txIdForInputs([a.hash, b.hash]))).not.toBeNull();
  });
});
