// Adversarial test for the timeLock unit bug (audit F-1): `timeLock` is a Unix
// timestamp in SECONDS (spec §3.3) but was compared against Date.now() in
// MILLISECONDS, so any realistic future timeLock was ~1000x smaller than
// Date.now() and the lock never fired.
import "@tat-protocol/nwpc";
import { FungibleForge } from "@tat-protocol/forge";
import { Token, TokenType } from "@tat-protocol/token";
import type { StorageInterface } from "@tat-protocol/storage";
import { schnorr } from "@noble/curves/secp256k1";
import { bytesToHex } from "@noble/hashes/utils";

const OWNER_SK = "22".repeat(32);
const OWNER = bytesToHex(schnorr.getPublicKey(OWNER_SK));

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

async function mintWithTimeLock(
  forge: any,
  amount: number,
  timeLockSeconds: number,
): Promise<string> {
  const t = new Token();
  await t.build({
    token_type: TokenType.FUNGIBLE,
    payload: Token.createPayload({ iss: OWNER, amount, timeLock: timeLockSeconds }),
  });
  return await forge.signAndCreateJWT(t);
}

describe("F-1: timeLock is enforced in Unix seconds", () => {
  it("rejects an input whose timeLock is one hour in the future", async () => {
    const forge = makeForge();
    const nowSec = Math.floor(Date.now() / 1000);
    const input = await mintWithTimeLock(forge, 100, nowSec + 3600);

    const [tx, err, code] = await (forge as any).validateTXInputs(
      { ins: [input], outs: [] },
      undefined,
    );
    expect(err).toMatch(/timelock/i);
    expect(tx).toBeNull();
    // INVALID_REQUEST (1001) per the spec error table.
    expect(code).toBe(1001);
  });

  it("accepts an input whose timeLock has already passed", async () => {
    const forge = makeForge();
    const nowSec = Math.floor(Date.now() / 1000);
    const input = await mintWithTimeLock(forge, 100, nowSec - 3600);

    const [, err] = await (forge as any).validateTXInputs(
      { ins: [input], outs: [] },
      undefined,
    );
    expect(err).toBeNull();
  });
});
