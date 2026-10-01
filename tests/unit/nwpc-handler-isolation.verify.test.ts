// A6: the router shared one HandlerEngine across every request, and the engine
// read its handler list lazily from `this.handlers` on each `next()`. A request
// whose middleware awaited (a relay round trip, a storage read) could resume
// after a concurrent request had overwritten that list, and its `next()` would
// then run the OTHER route's handlers from the same index — e.g. a `transfer`
// request stepping straight into `forge`'s mint handler, past its auth gate.
//
// Also pinned: the engine's `res.error` wrapper forwarded only three arguments
// (naming the third "recipient", though it lands in `error`'s `params` slot),
// so an explicit fourth-argument recipient was silently dropped and the error
// went to the request sender instead.
import { NWPCRouter } from "../../packages/nwpc/src/NWPCRouter";
import { NWPCResponseObject } from "../../packages/nwpc/src/NWPCResponseTypes";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

function fakeRes() {
  const calls: { type: string; args: unknown[] }[] = [];
  return {
    calls,
    send: async (...args: unknown[]) => {
      calls.push({ type: "send", args });
    },
    error: async (...args: unknown[]) => {
      calls.push({ type: "error", args });
    },
  } as any;
}

describe("NWPC handler chains are isolated per request", () => {
  it("a suspended middleware resumes into its OWN route, not a concurrent one", async () => {
    const router = new NWPCRouter(new Map());
    const gate = deferred();
    const ran: string[] = [];

    router.use(
      "transfer",
      async (_req, _ctx, _res, next) => {
        ran.push("transfer:check");
        await gate.promise; // e.g. awaiting a storage read
        await next();
      },
      async (_req, _ctx, res) => {
        ran.push("transfer:handle");
        await res.send({ ok: true });
      },
    );
    router.use(
      "forge",
      async (_req, _ctx, res) => {
        ran.push("forge:auth-reject");
        await res.error(1, "unauthorized"); // gate refuses; never calls next()
      },
      async (_req, _ctx, res) => {
        ran.push("forge:MINT");
        await res.send({ minted: true });
      },
    );

    const ctx = { sender: "alice" } as any;
    const transfer = router.handle(
      { id: "1", method: "transfer", params: "{}" } as any,
      ctx,
      fakeRes(),
    );
    await router.handle(
      { id: "2", method: "forge", params: "{}" } as any,
      ctx,
      fakeRes(),
    );
    gate.resolve();
    await transfer;

    expect(ran).not.toContain("forge:MINT");
    expect(ran).toEqual([
      "transfer:check",
      "forge:auth-reject",
      "transfer:handle",
    ]);
  });

  it("res.error(code, message, params, recipient) reaches that recipient with params", async () => {
    const sent: { response: any; to: string }[] = [];
    const fakeServer = {
      sendResponse: async (response: any, to: string) => {
        sent.push({ response: JSON.parse(JSON.stringify(response)), to });
      },
    } as any;
    const ctx = { sender: "alice", poster: "alice" } as any;
    const res = new NWPCResponseObject("req-1", fakeServer, ctx);

    const router = new NWPCRouter(new Map());
    const params = JSON.stringify({ spent: "ab".repeat(32), issuer: "forge" });
    router.use("transfer", async (_req, _ctx, r) => {
      await r.error(1234, "Token spent", params, "bob");
    });
    await router.handle(
      { id: "req-1", method: "transfer", params: "{}" } as any,
      ctx,
      res,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("bob");
    expect(sent[0].response.error).toEqual({
      code: 1234,
      message: "Token spent",
      params,
    });
  });
});
