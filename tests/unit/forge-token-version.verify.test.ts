// Rolling out token hash v2 (A7). A pocket on an older SDK verifies incoming
// tokens with the v1 hash rule and rejects v2 tokens as corrupt, so a forge
// mints v1 until its operator switches it to v2.
import "@tat-protocol/nwpc";
import { FungibleForge } from "@tat-protocol/forge";
import { Token } from "@tat-protocol/token";
import { schnorr } from "@noble/curves/secp256k1";
import { bytesToHex } from "@noble/hashes/utils";

const OWNER_SK = "7a".repeat(32);
const OWNER = bytesToHex(schnorr.getPublicKey(OWNER_SK));
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

async function mintedVersion(extra: Record<string, unknown>) {
  const forge = new FungibleForge({
    owner: OWNER,
    keys: { secretKey: OWNER_SK, publicKey: OWNER },
    storage: new MemStore(),
    totalSupply: 0,
    relays: [],
    ...extra,
  } as any) as any;
  forge.keys = { secretKey: OWNER_SK, publicKey: OWNER };
  const sent: any[] = [];
  const res = {
    send: async (data: any) => void sent.push(data),
    error: async (...a: any[]) => void sent.push({ error: a }),
  };
  await forge.forgeToken({ id: "m", params: JSON.stringify({ to: BOB, amount: 5 }) }, { sender: OWNER }, res);
  const jwt = sent.find((d) => d.token)?.token;
  return (await new Token().restore(jwt)).header.ver;
}

describe("forge token hash version", () => {
  it("mints v1 tokens by default, so pockets that have not updated keep receiving", async () => {
    // A pocket on an SDK before v2 rejects a v2 token as corrupt — after the
    // forge has spent the inputs. Rebuilding a forge must not strand them.
    expect(await mintedVersion({})).toBe("1.0.0");
  });

  it("mints v2 tokens once the operator switches over", async () => {
    expect(await mintedVersion({ tokenHashVersion: "2.0.0" })).toBe("2.0.0");
  });
});
