// The 10-minute offline window.
//
// Every server subscription asked relays for events from `now - 10 min`, and
// nothing recorded how far a server had actually read. A forge that was down
// for an hour never saw the requests sent during that hour. Pockets resumed
// from a persisted point for their main key, but a reconnect re-subscribed only
// that key — single-use change keys went deaf — and the issuer spent feed was
// pinned to ten minutes and never reopened at all.
//
// Now the last-seen event time is persisted in NWPC state for every peer and
// server, subscriptions resume from it (less a safety margin), and a reconnect
// re-opens every subscription, spent feeds included.
// Pocket extends NWPCPeer; use the real one (the shared mock has no
// subscription machinery), since that machinery is what is under test.
jest.mock("@tat-protocol/nwpc", () => jest.requireActual("../../packages/nwpc/src/index"));

import { NWPCServer } from "../../packages/nwpc/src/NWPCServer";
import { Pocket } from "../../packages/pocket/src/Pocket";
import { EventEmitter } from "node:events";

const NOW = () => Math.floor(Date.now() / 1000);

// Freeze the clock: expectations recompute NOW(), and a second boundary
// crossed mid-test would otherwise shift them by one.
const FROZEN = Date.now();
beforeEach(() => jest.spyOn(Date, "now").mockReturnValue(FROZEN));
afterEach(() => jest.restoreAllMocks());
const HOUR = 3600;
const MARGIN = 10 * 60;

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

/** Captures every REQ filter; relays can be marked dead to force a reconnect. */
function fakeNdk() {
  const subs: { filter: any; sub: EventEmitter & { stop(): void } }[] = [];
  const relay = { url: "wss://r", connected: true, disconnect() {} };
  return {
    subs,
    relay,
    pool: {
      relays: new Map([["wss://r", relay]]),
      connectedRelays: () => (relay.connected ? [relay] : []),
    },
    connect: async () => {
      relay.connected = true;
    },
    subscribe(filter: any) {
      const sub = Object.assign(new EventEmitter(), { stop() {} });
      subs.push({ filter, sub });
      return sub;
    },
  };
}

function server(lastSeenAt?: number) {
  const s = new NWPCServer({ keys: { secretKey: "11".repeat(32), publicKey: "22".repeat(32) }, relays: [], storage: new MemStore() } as any) as any;
  s.ndk = fakeNdk();
  s.publicKey = "22".repeat(32);
  s.queueSaveState = async () => undefined;
  if (lastSeenAt !== undefined) s.state.lastSeenAt = lastSeenAt;
  return s;
}

describe("servers resume from the last event they saw", () => {
  it("asks relays for everything since the persisted point, less a margin", async () => {
    const last = NOW() - 3 * HOUR;
    const s = server(last);
    await s.subscribe(s.publicKey, async () => undefined);
    expect(s.ndk.subs[0].filter.since).toBe(last - MARGIN);
  });

  it("uses a short window on first start, when there is nothing to catch up on", async () => {
    const s = server();
    await s.subscribe(s.publicKey, async () => undefined);
    expect(s.ndk.subs[0].filter.since).toBeGreaterThanOrEqual(NOW() - MARGIN - 1);
  });

  it("does not replay unbounded history after a very long outage", async () => {
    const s = server(NOW() - 365 * 24 * HOUR);
    await s.subscribe(s.publicKey, async () => undefined);
    expect(s.ndk.subs[0].filter.since).toBe(NOW() - 7 * 24 * HOUR);
  });

  const flush = () => new Promise((r) => setTimeout(r, 10));

  it("advances the resume point only as events are handled, never past one in flight", async () => {
    const s = server(NOW() - 3 * HOUR);
    const release: Record<string, () => void> = {};
    await s.subscribe(s.publicKey, (e: any) => new Promise<void>((r) => (release[e.id] = r)));
    const sub = s.ndk.subs[0].sub;
    sub.emit("eose");
    const older = NOW() - 120;
    const newer = NOW() - 60;
    sub.emit("event", { id: "o".padEnd(64, "0"), created_at: older });
    sub.emit("event", { id: "n".padEnd(64, "0"), created_at: newer });
    await flush();
    release["n".padEnd(64, "0")]();
    await flush();
    // The newer one finished, but the older is still being handled: a crash
    // now must resume from before it.
    expect(s.state.lastSeenAt).toBeLessThan(older);
    release["o".padEnd(64, "0")]();
    await flush();
    expect(s.state.lastSeenAt).toBe(newer);
    // Never moves backwards.
    sub.emit("event", { id: "b".padEnd(64, "0"), created_at: newer - HOUR });
    await flush();
    release["b".padEnd(64, "0")]?.();
    await flush();
    expect(s.state.lastSeenAt).toBe(newer);
  });

  it("does not advance during a relay's backfill, which arrives newest first", async () => {
    const s = server(NOW() - 3 * HOUR);
    await s.subscribe(s.publicKey, async () => undefined);
    const sub = s.ndk.subs[0].sub;
    // The newest stored event arrives and is handled before the older ones
    // have even been sent. Advancing now would skip them after a crash.
    sub.emit("event", { id: "x".padEnd(64, "0"), created_at: NOW() - 30 });
    await flush();
    expect(s.state.lastSeenAt).toBe(NOW() - 3 * HOUR);
    sub.emit("event", { id: "y".padEnd(64, "0"), created_at: NOW() - 2 * HOUR });
    await flush();
    sub.emit("eose");
    await flush();
    expect(s.state.lastSeenAt).toBe(NOW() - 30);
  });

  it("stops waiting for a backfill whose EOSE never comes (a relay is down)", async () => {
    // NDK only emits EOSE once enough relays have sent theirs; with one of two
    // relays down it never does, and the resume point would never move again.
    const s = server(NOW() - 3 * HOUR);
    s.config.backfillTimeoutMs = 20;
    await s.subscribe(s.publicKey, async () => undefined);
    s.ndk.subs[0].sub.emit("event", { id: "z".padEnd(64, "0"), created_at: NOW() - 30 });
    await new Promise((r) => setTimeout(r, 60));
    expect(s.state.lastSeenAt).toBe(NOW() - 30);
  });

  it("re-opens every subscription on reconnect, resuming rather than starting over", async () => {
    const s = server(NOW() - 2 * HOUR);
    await s.subscribe(s.publicKey, async () => undefined);
    await s.subscribe("33".repeat(32), async () => undefined);
    s.ndk.subs.length = 0;
    s.ndk.relay.connected = false;
    await s.ensureConnected();
    const pubkeys = s.ndk.subs.map((x: any) => x.filter["#p"][0]).sort();
    expect(pubkeys).toEqual(["22".repeat(32), "33".repeat(32)].sort());
    for (const x of s.ndk.subs) expect(x.filter.since).toBe(NOW() - 2 * HOUR - MARGIN);
  });
});

describe("pockets keep every feed open across reconnects", () => {
  const ISSUER = "44".repeat(32);
  const ME = "55".repeat(32);
  const CHANGE = "66".repeat(32);

  function pocket(lastSeenAt: number) {
    const p = Object.create(Pocket.prototype) as any;
    Object.assign(p, {
      ndk: fakeNdk(),
      publicKey: ME,
      keys: { publicKey: ME, secretKey: "" },
      config: {},
      state: { relays: new Set(), lastSeenAt, singleUseKeys: new Map() },
      activeSubscriptions: new Map(),
      subscriptionHandlers: new Map(),
      backfilling: new Set(),
      inFlight: [],
      newestHandled: 0,
      subscribedIssuers: new Set(),
      spentFeedSubscriptions: new Map(),
      _lastReconnectAt: 0,
      queueSaveState: async () => undefined,
      handleEvent: async () => undefined,
    });
    return p;
  }

  it("opens the issuer spent feed from the resume point, not ten minutes ago", async () => {
    const p = pocket(NOW() - 5 * HOUR);
    await p.subscribeToIssuerSpent(ISSUER);
    const feed = p.ndk.subs.find((x: any) => x.filter.authors?.[0] === ISSUER);
    expect(feed.filter.since).toBe(NOW() - 5 * HOUR - HOUR);
  });

  it("re-opens single-use key and spent-feed subscriptions after a reconnect", async () => {
    const p = pocket(NOW() - 5 * HOUR);
    await p.subscribe(ME);
    await p.subscribe(CHANGE);
    await p.subscribeToIssuerSpent(ISSUER);
    p.ndk.subs.length = 0;
    p.ndk.relay.connected = false;

    await p.ensureConnected();

    const dm = p.ndk.subs.filter((x: any) => x.filter.kinds?.includes(1059)).map((x: any) => x.filter["#p"][0]);
    expect(dm.sort()).toEqual([ME, CHANGE].sort());
    const feeds = p.ndk.subs.filter((x: any) => x.filter.authors?.[0] === ISSUER);
    expect(feeds).toHaveLength(1);
    for (const x of p.ndk.subs) expect(x.filter.since).toBe(NOW() - 5 * HOUR - HOUR);
  });
});
