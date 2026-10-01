// Change not covered by the witness.
//
// Two gaps, one effect — value the spender never signed for:
//
// 1. Implicit change. Whatever the outputs left over, the forge minted as change
//    locked to whoever submitted the request. The witness binds the outputs,
//    not the remainder, so the remainder went to the submitter — which, with a
//    witness observed on the wire, need not be the owner.
// 2. The v1 digest bound only {to, amount, tokenID}. The forge also reads
//    `timeLock` from each output, so a relayer could re-time-lock a recipient's
//    output without invalidating the witness.
//
// Now: outputs must spend the inputs exactly (change is an explicit output),
// the v2 digest binds every output field the forge reads, unknown output fields
// are refused, and a v1 witness is accepted only for a plain transfer inside an
// announced window — after which the pocket is told to upgrade.
import "@tat-protocol/nwpc";
import { FungibleForge } from "@tat-protocol/forge";
import { Token, TokenType } from "@tat-protocol/token";
import { spendAuthDigest } from "@tat-protocol/utils";
import type { StorageInterface } from "@tat-protocol/storage";
import { schnorr } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

const OWNER_SK = "12".repeat(32);
const OWNER = bytesToHex(schnorr.getPublicKey(OWNER_SK));
const ALICE_SK = "34".repeat(32);
const ALICE = bytesToHex(schnorr.getPublicKey(ALICE_SK));
const ALICE_CHANGE = "c".repeat(64);
const BOB = "b".repeat(64);
const NOW_S = () => Math.floor(Date.now() / 1000);

/** The v1 wire format, independently of the SDK: to/amount/tokenID only. */
function v1Digest(hash: string, outs: any[]): Uint8Array {
  const normalized = outs.map((o) => ({ to: o.to ?? null, amount: o.amount ?? null, tokenID: o.tokenID ?? null }));
  return sha256(new TextEncoder().encode("TAT-P2PK-SPEND-v1\n" + hash + "\n" + JSON.stringify(normalized)));
}

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

function makeForge(extra: Record<string, unknown> = {}) {
  const forge = new FungibleForge({
    owner: OWNER,
    keys: { secretKey: OWNER_SK, publicKey: OWNER },
    storage: new MemStore(),
    totalSupply: 0,
    relays: [],
    ...extra,
  } as any) as any;
  forge.keys = { secretKey: OWNER_SK, publicKey: OWNER };
  forge.announceSpent = () => undefined;
  return forge;
}

async function lockedInput(forge: any, amount: number) {
  const t = new Token();
  await t.build({
    token_type: TokenType.FUNGIBLE,
    payload: Token.createPayload({ iss: OWNER, amount, P2PKlock: ALICE }),
  });
  const jwt = await forge.signAndCreateJWT(t);
  return { jwt, hash: (await new Token().restore(jwt)).header.token_hash as string };
}

const sign = (digest: Uint8Array) => bytesToHex(schnorr.sign(digest, ALICE_SK));

function makeRes() {
  const calls: { type: string; args: any[] }[] = [];
  return {
    calls,
    send: async (...args: any[]) => void calls.push({ type: "send", args }),
    error: async (...args: any[]) => void calls.push({ type: "error", args }),
  } as any;
}

describe("change must be an explicit output", () => {
  it("refuses outputs that spend less than the inputs", async () => {
    const forge = makeForge();
    const input = await new Token().restore((await lockedInput(forge, 100)).jwt);
    expect(await forge.validateFungibleTransfer([input], [{ to: BOB, amount: 40 }])).toMatch(/exactly|change/i);
    expect(
      await forge.validateFungibleTransfer([input], [
        { to: BOB, amount: 40 },
        { to: ALICE_CHANGE, amount: 60 },
      ]),
    ).toBeNull();
  });

  it("mints no change to the submitter, and spends nothing, when change is left implicit", async () => {
    const forge = makeForge();
    const { jwt, hash } = await lockedInput(forge, 100);
    const outs = [{ to: BOB, amount: 40, issuer: OWNER }];
    const res = makeRes();
    await forge.transferToken(
      { id: "t1", params: JSON.stringify({ ins: [jwt], outs, witnessData: [sign(spendAuthDigest(hash, outs))] }) },
      { sender: "e".repeat(64) },
      res,
    );
    expect(res.calls.some((c: any) => c.type === "error")).toBe(true);
    expect(res.calls.filter((c: any) => c.type === "send" && c.args[0]?.token)).toHaveLength(0);
    expect(await forge.isTokenSpent(hash)).toBe(false);
  });
});

describe("the v2 spend digest binds every output field", () => {
  it("changes when any bound field changes, including timeLock and issuer", () => {
    const h = "ab".repeat(32);
    const base = { to: BOB, amount: 100, issuer: OWNER };
    const d = bytesToHex(spendAuthDigest(h, [base]));
    expect(bytesToHex(spendAuthDigest(h, [{ ...base, timeLock: NOW_S() + 3600 }]))).not.toBe(d);
    expect(bytesToHex(spendAuthDigest(h, [{ ...base, issuer: "f".repeat(64) }]))).not.toBe(d);
    // Field order on the wire does not matter.
    expect(bytesToHex(spendAuthDigest(h, [{ issuer: OWNER, amount: 100, to: BOB }]))).toBe(d);
    // And it is not the v1 digest.
    expect(d).not.toBe(bytesToHex(v1Digest(h, [base])));
  });

  it("rejects a witness whose output was re-time-locked in flight", async () => {
    const forge = makeForge();
    const { jwt, hash } = await lockedInput(forge, 100);
    const signed = [{ to: BOB, amount: 100, issuer: OWNER }];
    const tampered = [{ to: BOB, amount: 100, issuer: OWNER, timeLock: NOW_S() + 10 * 365 * 86400 }];
    const [tx, err] = await forge.validateTXInputs({ ins: [jwt], outs: tampered }, [sign(spendAuthDigest(hash, signed))]);
    expect(tx).toBeNull();
    expect(err).toMatch(/witness/i);
  });

  it("accepts a v2 witness that covers a timeLock", async () => {
    const forge = makeForge();
    const { jwt, hash } = await lockedInput(forge, 100);
    const outs = [{ to: BOB, amount: 100, issuer: OWNER, timeLock: NOW_S() + 60 }];
    const [, err] = await forge.validateTXInputs({ ins: [jwt], outs }, [sign(spendAuthDigest(hash, outs))]);
    expect(err).toBeNull();
  });

  it("refuses output fields the digest does not bind", async () => {
    const forge = makeForge();
    const { jwt, hash } = await lockedInput(forge, 100);
    const outs = [{ to: BOB, amount: 100, issuer: OWNER, htlc: "deadbeef" }];
    const [tx, err, code] = await forge.validateTXInputs({ ins: [jwt], outs }, [sign(v1Digest(hash, outs))]);
    expect(tx).toBeNull();
    expect(err).toMatch(/htlc/);
    expect(code).toBe(1003);
  });

  it("refuses an output naming a different issuer", async () => {
    const forge = makeForge();
    const { jwt, hash } = await lockedInput(forge, 100);
    const outs = [{ to: BOB, amount: 100, issuer: "f".repeat(64) }];
    const [tx, err] = await forge.validateTXInputs({ ins: [jwt], outs }, [sign(spendAuthDigest(hash, outs))]);
    expect(tx).toBeNull();
    expect(err).toMatch(/issuer/i);
  });
});

describe("v1 witnesses during the announced window", () => {
  it("accepts a v1 witness for a plain transfer while the window is open", async () => {
    const forge = makeForge({ acceptV1SpendDigestUntil: NOW_S() + 3600 });
    const { jwt, hash } = await lockedInput(forge, 100);
    const outs = [
      { to: BOB, amount: 60, issuer: OWNER },
      { to: ALICE_CHANGE, amount: 40, issuer: OWNER },
    ];
    const [, err] = await forge.validateTXInputs({ ins: [jwt], outs }, [sign(v1Digest(hash, outs))]);
    expect(err).toBeNull();
  });

  it("refuses a v1 witness over outputs carrying a timeLock it does not cover", async () => {
    const forge = makeForge({ acceptV1SpendDigestUntil: NOW_S() + 3600 });
    const { jwt, hash } = await lockedInput(forge, 100);
    const outs = [{ to: BOB, amount: 100, issuer: OWNER, timeLock: NOW_S() + 60 }];
    const [tx, err] = await forge.validateTXInputs({ ins: [jwt], outs }, [sign(v1Digest(hash, outs))]);
    expect(tx).toBeNull();
    expect(err).toMatch(/timeLock/);
  });

  it("tells the pocket to upgrade once the window has closed", async () => {
    const forge = makeForge({ acceptV1SpendDigestUntil: NOW_S() - 1 });
    const { jwt, hash } = await lockedInput(forge, 100);
    const outs = [{ to: BOB, amount: 100, issuer: OWNER }];
    const [tx, err, code] = await forge.validateTXInputs({ ins: [jwt], outs }, [sign(v1Digest(hash, outs))]);
    expect(tx).toBeNull();
    expect(code).toBe(2010);
    expect(err).toMatch(/update your pocket/i);
  });
});
