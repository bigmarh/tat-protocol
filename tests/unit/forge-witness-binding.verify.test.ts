// Adversarial test for the P2PK witness-binding fix (audit C6). The unlock
// witness must be signed over a digest bound to the transfer's outputs, not the
// bare (public, static) token hash — otherwise a witness observed on the wire
// can be replayed to redirect the same input to a different recipient.
import "@tat-protocol/nwpc";
import { FungibleForge } from "@tat-protocol/forge";
import { Token, TokenType } from "@tat-protocol/token";
import { spendAuthDigest } from "@tat-protocol/utils";
import type { StorageInterface } from "@tat-protocol/storage";
import { schnorr } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

const OWNER_SK = "44".repeat(32);
const OWNER = bytesToHex(schnorr.getPublicKey(OWNER_SK));
const ALICE_SK = "55".repeat(32); // holder of the P2PK-locked token
const ALICE = bytesToHex(schnorr.getPublicKey(ALICE_SK));
const BOB = "b".repeat(64);
const ATTACKER = "a".repeat(64);

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

function makeForge(opts: { allowLegacyWitness?: boolean } = {}) {
  const forge = new FungibleForge({
    owner: OWNER,
    keys: { secretKey: OWNER_SK, publicKey: OWNER },
    storage: new MemStore(),
    totalSupply: 0,
    relays: [],
    ...opts,
  } as any);
  (forge as any).keys = { secretKey: OWNER_SK, publicKey: OWNER };
  return forge;
}

function legacyWitness(hash: string): string {
  // Pre-C6 scheme: sign the bare token hash.
  return bytesToHex(schnorr.sign(hexToBytes(hash), ALICE_SK));
}

function boundWitness(hash: string, outs: unknown[]): string {
  return bytesToHex(schnorr.sign(spendAuthDigest(hash, outs), ALICE_SK));
}

// Mint a P2PK-locked token owned by ALICE, signed by the forge (OWNER).
async function mintP2PK(forge: any, amount: number): Promise<string> {
  const t = new Token();
  await t.build({
    token_type: TokenType.FUNGIBLE,
    payload: Token.createPayload({ iss: OWNER, amount, P2PKlock: ALICE }),
  });
  return await forge.signAndCreateJWT(t);
}

async function tokenHashOf(jwt: string): Promise<string> {
  const t = await new Token().restore(jwt);
  return t.header.token_hash as string;
}

describe("C6: P2PK witness is bound to the transfer outputs", () => {
  it("accepts a witness signed over the correct outputs", async () => {
    const forge = makeForge();
    const jwt = await mintP2PK(forge, 100);
    const outs = [{ to: BOB, amount: 100, issuer: OWNER }];
    const hash = await tokenHashOf(jwt);
    const witness = bytesToHex(
      schnorr.sign(spendAuthDigest(hash, outs), ALICE_SK),
    );

    const [tx, err] = await (forge as any).validateTXInputs(
      { ins: [jwt], outs },
      [witness],
    );
    expect(err).toBeNull();
    expect(tx).not.toBeNull();
  });

  it("rejects a witness replayed onto attacker-chosen outputs (theft attempt)", async () => {
    const forge = makeForge();
    const jwt = await mintP2PK(forge, 100);
    const hash = await tokenHashOf(jwt);

    // ALICE authorized a transfer to BOB...
    const honestOuts = [{ to: BOB, amount: 100, issuer: OWNER }];
    const witness = bytesToHex(
      schnorr.sign(spendAuthDigest(hash, honestOuts), ALICE_SK),
    );

    // ...an attacker grabs the witness and redirects the same input to themself.
    const attackerOuts = [{ to: ATTACKER, amount: 100, issuer: OWNER }];
    const [tx, err] = await (forge as any).validateTXInputs(
      { ins: [jwt], outs: attackerOuts },
      [witness],
    );
    expect(err).toMatch(/witness/i);
    expect(tx).toBeNull();
  });

  it("accepts a legacy (token-hash-only) witness during the transition (default)", async () => {
    // Backward compatibility: wallets on the pre-C6 SDK keep working while
    // allowLegacyWitness is left at its default (true).
    const forge = makeForge();
    const jwt = await mintP2PK(forge, 100);
    const hash = await tokenHashOf(jwt);
    const outs = [{ to: BOB, amount: 100, issuer: OWNER }];

    const [tx, err] = await (forge as any).validateTXInputs(
      { ins: [jwt], outs },
      [legacyWitness(hash)],
    );
    expect(err).toBeNull();
    expect(tx).not.toBeNull();
  });

  it("rejects a legacy witness once allowLegacyWitness is false (C6 fully closed)", async () => {
    const forge = makeForge({ allowLegacyWitness: false });
    const jwt = await mintP2PK(forge, 100);
    const hash = await tokenHashOf(jwt);
    const outs = [{ to: BOB, amount: 100, issuer: OWNER }];

    const [, err] = await (forge as any).validateTXInputs(
      { ins: [jwt], outs },
      [legacyWitness(hash)],
    );
    expect(err).toMatch(/witness/i);
  });

  it("in strict mode, the bound witness still works and replay is rejected", async () => {
    const forge = makeForge({ allowLegacyWitness: false });
    const jwt = await mintP2PK(forge, 100);
    const hash = await tokenHashOf(jwt);
    const honestOuts = [{ to: BOB, amount: 100, issuer: OWNER }];
    const witness = boundWitness(hash, honestOuts);

    const [okTx, okErr] = await (forge as any).validateTXInputs(
      { ins: [jwt], outs: honestOuts },
      [witness],
    );
    expect(okErr).toBeNull();
    expect(okTx).not.toBeNull();

    const attackerOuts = [{ to: ATTACKER, amount: 100, issuer: OWNER }];
    const [, replayErr] = await (forge as any).validateTXInputs(
      { ins: [jwt], outs: attackerOuts },
      [witness],
    );
    expect(replayErr).toMatch(/witness/i);
  });
});
