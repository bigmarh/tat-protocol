// NWPCServer.sendResponse resolved on a publish error, and after 3 s whether or
// not anything was published. Every caller — including a forge delivering the
// outputs of a transfer it had already committed — was told "sent" about a
// token that never left the process. Delivery failure must be visible to the
// caller so it can keep the output for retry.
jest.mock("../../packages/utils/src/Nostr", () => {
  const actual = jest.requireActual("../../packages/utils/src/Nostr");
  return { ...actual, Wrap: jest.fn() };
});

import { NWPCServer } from "../../packages/nwpc/src/NWPCServer";
import { NWPCResponseObject } from "../../packages/nwpc/src/NWPCResponseTypes";
import * as Nostr from "../../packages/utils/src/Nostr";
import { EventEmitter } from "node:events";

function fakeEvent(publish: () => Promise<unknown>) {
  const ev = new EventEmitter() as any;
  ev.publish = publish;
  return ev;
}

function server(): any {
  const s = Object.create(NWPCServer.prototype);
  s.keys = { secretKey: "11".repeat(32), publicKey: "22".repeat(32) };
  s.config = { publishTimeoutMs: 50 };
  return s;
}

const RESPONSE = { id: "r1", timestamp: 0, result: { token: "jwt" } };

describe("NWPCServer.sendResponse surfaces delivery failure", () => {
  afterEach(() => (Nostr.Wrap as jest.Mock).mockReset());

  it("rejects when the publish is rejected by every relay", async () => {
    (Nostr.Wrap as jest.Mock).mockResolvedValue(
      fakeEvent(async () => {
        throw new Error("Not enough relays received the event");
      }),
    );
    await expect(server().sendResponse(RESPONSE, "33".repeat(32))).rejects.toThrow(/relays/);
  });

  it("rejects when no relay acknowledges within the timeout", async () => {
    (Nostr.Wrap as jest.Mock).mockResolvedValue(fakeEvent(() => new Promise(() => {})));
    await expect(server().sendResponse(RESPONSE, "33".repeat(32))).rejects.toThrow(/timed out|no relay/i);
  });

  it("resolves once a relay acknowledges", async () => {
    (Nostr.Wrap as jest.Mock).mockResolvedValue(fakeEvent(async () => new Set(["relay"])));
    await expect(server().sendResponse(RESPONSE, "33".repeat(32))).resolves.toBeUndefined();
  });
});

describe("NWPCResponseObject.send", () => {
  it("fails when the addressed delivery fails", async () => {
    const srv = {
      sendResponse: async (_r: any, to: string) => {
        if (to === "bob") throw new Error("publish failed");
      },
    } as any;
    const res = new NWPCResponseObject("r1", srv, { sender: "alice", poster: "alice" } as any);
    await expect(res.send({ token: "jwt" }, "bob")).rejects.toThrow(/publish failed/);
  });

  it("does not fail a delivered output because the courtesy ack to the sender failed", async () => {
    const delivered: string[] = [];
    const srv = {
      sendResponse: async (_r: any, to: string) => {
        if (to === "alice") throw new Error("ack lost");
        delivered.push(to);
      },
    } as any;
    const res = new NWPCResponseObject("r1", srv, { sender: "alice", poster: "alice" } as any);
    await expect(res.send({ token: "jwt" }, "bob")).resolves.toBeDefined();
    expect(delivered).toEqual(["bob"]);
  });
});
