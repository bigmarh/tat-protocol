// Adversarial test for the forge init-ordering finding (audit F1-replay):
// the forge must load its persisted spent-set / replay bloom BEFORE it
// subscribes to relays. Subscribing first means the relay's on-connect replay
// (the subscription `since` window) is validated against an empty spent-set,
// re-minting already-spent transfers on every restart.
import "@tat-protocol/nwpc";
import { NWPCServer } from "@tat-protocol/nwpc";
import { FungibleForge } from "@tat-protocol/forge";
import type { StorageInterface } from "@tat-protocol/storage";

const OWNER = "a".repeat(64);
const OWNER_SK = "d".repeat(64);

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
  return new FungibleForge({
    owner: OWNER,
    keys: { secretKey: OWNER_SK, publicKey: OWNER },
    storage: new MemStore(),
    totalSupply: 0,
    relays: [],
  } as any);
}

describe("F1-replay: forge loads state before subscribing", () => {
  it("calls _loadState before super.init() (subscribe)", async () => {
    const order: string[] = [];

    // Spy on the base subscribe step (super.init resolves to NWPCServer.init).
    const origInit = NWPCServer.prototype.init;
    NWPCServer.prototype.init = async function () {
      order.push("subscribe");
      return origInit.call(this);
    };

    try {
      const forge = makeForge();
      const origLoad = (forge as any)._loadState.bind(forge);
      (forge as any)._loadState = async function () {
        order.push("loadState");
        return origLoad();
      };

      await forge.initialize();

      expect(order).toEqual(["loadState", "subscribe"]);
    } finally {
      NWPCServer.prototype.init = origInit;
    }
  });
});
