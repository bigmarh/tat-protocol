// A20: a peer accepted a reply to its request from ANY key.
//
// NWPCPeer matched replies on the request id alone (and never checked the
// seal's signature). The Pocket checked the seal but still matched on id alone.
// Anyone who learned or guessed a request id could answer it — e.g. tell a
// pocket its transfer succeeded, after which it deletes its inputs.
//
// A reply now resolves a request only if it was sealed by the key the request
// was sent to.
jest.mock("@tat-protocol/nwpc", () => jest.requireActual("../../packages/nwpc/src/index"));
jest.mock("../../packages/utils/src/Nostr", () => {
  const actual = jest.requireActual("../../packages/utils/src/Nostr");
  return { ...actual, Wrap: jest.fn(actual.Wrap) };
});

import { NWPCPeer } from "../../packages/nwpc/src/NWPCPeer";
import { Pocket } from "../../packages/pocket/src/Pocket";
import * as Nostr from "../../packages/utils/src/Nostr";
import NDK from "@nostr-dev-kit/ndk";
import { getPublicKey } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { EventEmitter } from "node:events";

const key = (hex: string) => ({ secretKey: hex, publicKey: getPublicKey(hexToBytes(hex)) });
const ME = key("0c".repeat(32));
const FORGE = key("0d".repeat(32));
const MALLORY = key("0e".repeat(32));
const realWrap = jest.requireActual("../../packages/utils/src/Nostr").Wrap;
const ndk = new NDK({ explicitRelayUrls: [] });

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

/** Let request() "publish": the outgoing wrap acks immediately. */
function publishInstantly() {
  (Nostr.Wrap as jest.Mock).mockImplementation(async () => {
    const ev = new EventEmitter() as any;
    ev.publish = async () => {
      setTimeout(() => ev.emit("relay:published"), 0);
      return new Set(["r"]);
    };
    return ev;
  });
}

const reply = (from: typeof ME, id: string, result: unknown) =>
  realWrap(ndk, JSON.stringify({ id, timestamp: Date.now(), result }), from, ME.publicKey);

function peer() {
  const p = new NWPCPeer({ keys: ME, relays: [], storage: new MemStore() } as any) as any;
  p.publicKey = ME.publicKey;
  p.ensureConnected = async () => undefined;
  p.ndk.pool.connectedRelays = () => [{ url: "r" }];
  return p;
}

async function pendingRequest(p: any) {
  publishInstantly();
  let settled: any = "pending";
  const promise = p.request("transfer", { x: 1 }, FORGE.publicKey, undefined, 2000).then(
    (r: any) => (settled = r),
    (e: any) => (settled = e),
  );
  await new Promise((r) => setTimeout(r, 20));
  const id = [...p.responseHandlers.keys()][0];
  return { id, promise, settled: () => settled };
}

describe("NWPCPeer accepts a reply only from the key it asked", () => {
  it("ignores a reply sealed by another key, then takes the real one", async () => {
    const p = peer();
    const req = await pendingRequest(p);

    await p.handleEvent(await reply(MALLORY, req.id, { status: "committed", forged: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(req.settled()).toBe("pending");

    await p.handleEvent(await reply(FORGE, req.id, { status: "committed" }));
    await req.promise;
    expect(req.settled().result).toEqual({ status: "committed" });
  });
});

describe("Pocket accepts a reply only from the key it asked", () => {
  it("does not resolve a pending request on another key's reply", async () => {
    const p = peer();
    const req = await pendingRequest(p);
    // Hand the pending request to a Pocket's handleEvent.
    const pocket = Object.create(Pocket.prototype) as any;
    Object.assign(pocket, {
      publicKey: ME.publicKey,
      keys: ME,
      config: {},
      hooks: {},
      responseHandlers: p.responseHandlers,
      state: { singleUseKeys: new Map(), tokens: new Map() },
      isEventProcessed: () => false,
      markEventProcessed: () => undefined,
      savePocketState: async () => undefined,
      storeToken: async () => true,
    });

    await pocket.handleEvent(await reply(MALLORY, req.id, { tx_id: "x", status: "committed" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(req.settled()).toBe("pending");

    await pocket.handleEvent(await reply(FORGE, req.id, { tx_id: "x", status: "committed" }));
    await req.promise;
    expect(req.settled().result.status).toBe("committed");
  });
});
