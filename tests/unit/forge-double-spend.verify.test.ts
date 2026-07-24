// Adversarial tests for the value-inflation findings in the forge transfer
// path (audit C2 / C3). Import the nwpc barrel first so its module-level
// constants (NWPC_SPEC_ERRORS) are initialized before the forge barrel loads.
import "@tat-protocol/nwpc";
import { FungibleForge, NonFungibleForge } from "@tat-protocol/forge";
import { Token, TokenType } from "@tat-protocol/token";
import type { StorageInterface } from "@tat-protocol/storage";
import { schnorr } from "@noble/curves/secp256k1";
import { bytesToHex } from "@noble/hashes/utils";

// A real keypair so issuer-signed inputs pass verifyTokenSignature.
const OWNER_SK = "11".repeat(32);
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

function makeForge(Ctor: any) {
  const forge = new Ctor({
    owner: OWNER,
    keys: { secretKey: OWNER_SK, publicKey: OWNER },
    storage: new MemStore(),
    totalSupply: 0,
    relays: [],
  });
  // Handlers read this.keys directly; initialize() would connect to relays.
  (forge as any).keys = { secretKey: OWNER_SK, publicKey: OWNER };
  return forge;
}

// Mint a genuine issuer-signed token (no P2PKlock, so no witness is required)
// that survives verifyTokenHash / verifyTokenSignature inside validateTXInputs.
async function mintFungible(forge: any, amount: number): Promise<string> {
  const t = new Token();
  await t.build({
    token_type: TokenType.FUNGIBLE,
    payload: Token.createPayload({ iss: OWNER, amount }),
  });
  return await forge.signAndCreateJWT(t);
}

async function mintTAT(forge: any, tokenID: number): Promise<string> {
  const t = new Token();
  await t.build({
    token_type: TokenType.TAT,
    payload: Token.createPayload({ iss: OWNER, tokenID }),
  });
  return await forge.signAndCreateJWT(t);
}

function countSentTokens(calls: { type: string; args: any[] }[]): number {
  return calls.filter(
    (c) => c.type === "send" && c.args?.[0] && "token" in c.args[0],
  ).length;
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

describe("C2: duplicate-input value inflation (fungible)", () => {
  it("accepts a single legitimate input but rejects the same input listed twice", async () => {
    const forge = makeForge(FungibleForge);
    const input = await mintFungible(forge, 100);

    // Sanity: the single input validates.
    const [, singleErr] = await (forge as any).validateTXInputs(
      { ins: [input], outs: [] },
      undefined,
    );
    expect(singleErr).toBeNull();

    // Attack: the SAME input listed twice must be rejected as a duplicate,
    // otherwise validateFungibleTransfer sums it to 200 and mints 200 from 100.
    const [tx, dupErr] = await (forge as any).validateTXInputs(
      { ins: [input, input], outs: [] },
      undefined,
    );
    expect(dupErr).toMatch(/duplicate/i);
    expect(tx).toBeNull();
  });

  it("validateFungibleTransfer rejects duplicate input tokens", async () => {
    const forge = makeForge(FungibleForge);
    const t = new Token();
    await t.build({
      token_type: TokenType.FUNGIBLE,
      payload: Token.createPayload({ iss: OWNER, amount: 100 }),
    });
    await t.create_token_hash();

    // [t, t] summed = 200; a 200-unit output would pass without dedup.
    const err = await forge.validateFungibleTransfer(
      [t, t],
      [{ to: BOB, amount: 200 } as any],
    );
    expect(err).toMatch(/duplicate/i);
  });
});

describe("C3: duplicate tokenID mints multiple NFTs from one input", () => {
  it("does not mint two tokens when outs repeat the same tokenID", async () => {
    const forge = makeForge(NonFungibleForge);
    const input = await mintTAT(forge, 5);
    const restored = await new Token().restore(input);

    const res = makeRes();
    await forge.handleNonFungibleTransfer(
      [restored],
      [
        { tokenID: 5, to: ALICE } as any,
        { tokenID: 5, to: BOB } as any,
      ],
      res,
      OWNER,
    );

    // One NFT input must yield at most one minted NFT, never two.
    expect(countSentTokens(res.calls)).toBeLessThanOrEqual(1);
  });
});
