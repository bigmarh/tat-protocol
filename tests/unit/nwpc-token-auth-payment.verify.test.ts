// A17: tokenAuth payment mode ran the paid handler BEFORE spending the token.
//
// It checked isTokenSpent, called next(), and only afterwards markTokenSpent —
// swallowing any error from the mark. Two concurrent requests with one token
// both passed the check and both got the paid service; a mark that failed left
// the token reusable indefinitely.
//
// Now the token is claimed before the handler runs — atomically through
// `trySpendToken`, or with a serialized check-then-mark over the legacy hooks —
// and a claim that fails refuses the request.
import { createSimpleTokenAuth } from "../../packages/nwpc/src/tokenAuth";

const TOKEN = "payment-token-jwt";
const HASH = "ab".repeat(32);

const validateToken = async (jwt: string) => ({
  jwt,
  hash: HASH,
  issuer: "issuer",
  amount: 10,
  isExpired: false,
  isValid: true,
});

function makeRes() {
  const calls: { type: string; args: any[] }[] = [];
  return {
    calls,
    send: async (...args: any[]) => void calls.push({ type: "send", args }),
    error: async (...args: any[]) => void calls.push({ type: "error", args }),
  } as any;
}

const req = { id: "r", method: "paid.thing", params: JSON.stringify({ _token: TOKEN }) } as any;
const ctx = () => ({ sender: "alice" }) as any;

describe("tokenAuth payment mode spends before it serves", () => {
  it("serves one of two concurrent requests paid with the same token (legacy hooks)", async () => {
    const spent = new Set<string>();
    const mw = createSimpleTokenAuth(
      { mode: "payment", cost: 1 },
      {
        validateToken,
        isTokenSpent: async (h) => spent.has(h),
        markTokenSpent: async (h) => {
          await new Promise((r) => setTimeout(r, 5));
          spent.add(h);
        },
      },
    );
    let served = 0;
    const next = async () => {
      await new Promise((r) => setTimeout(r, 5));
      served++;
    };
    const [a, b] = [makeRes(), makeRes()];
    await Promise.all([mw(req, ctx(), a, next), mw(req, ctx(), b, next)]);
    expect(served).toBe(1);
    expect([...a.calls, ...b.calls].filter((c) => c.type === "error")[0]?.args[0]).toBe(2002);
  });

  it("claims through trySpendToken before running the handler", async () => {
    const order: string[] = [];
    const mw = createSimpleTokenAuth(
      { mode: "payment", cost: 1 },
      {
        validateToken,
        trySpendToken: async () => {
          order.push("claim");
          return true;
        },
      },
    );
    await mw(req, ctx(), makeRes(), async () => void order.push("handler"));
    expect(order).toEqual(["claim", "handler"]);
  });

  it("refuses without running the handler when the claim is lost", async () => {
    const mw = createSimpleTokenAuth({ mode: "payment", cost: 1 }, { validateToken, trySpendToken: async () => false });
    let served = false;
    const res = makeRes();
    await mw(req, ctx(), res, async () => void (served = true));
    expect(served).toBe(false);
    expect(res.calls[0].args[0]).toBe(2002);
  });

  it("fails closed when the token cannot be marked spent", async () => {
    const mw = createSimpleTokenAuth(
      { mode: "payment", cost: 1 },
      {
        validateToken,
        isTokenSpent: async () => false,
        markTokenSpent: async () => {
          throw new Error("db down");
        },
      },
    );
    let served = false;
    const res = makeRes();
    await mw(req, ctx(), res, async () => void (served = true));
    expect(served).toBe(false);
    expect(res.calls[0].type).toBe("error");
  });

  it("refuses payment mode configured with no way to spend a token", async () => {
    const mw = createSimpleTokenAuth({ mode: "payment", cost: 1 }, { validateToken, isTokenSpent: async () => false });
    let served = false;
    await mw(req, ctx(), makeRes(), async () => void (served = true));
    expect(served).toBe(false);
  });

  it("refuses the legacy hooks without isTokenSpent, which could never detect reuse", async () => {
    const mw = createSimpleTokenAuth(
      { mode: "payment", cost: 1 },
      { validateToken, markTokenSpent: async () => undefined },
    );
    let served = 0;
    await mw(req, ctx(), makeRes(), async () => void served++);
    await mw(req, ctx(), makeRes(), async () => void served++);
    expect(served).toBe(0);
  });

  it("keeps the token spent when the handler fails — a failed attempt is not a refund", async () => {
    const spent = new Set<string>();
    const mw = createSimpleTokenAuth(
      { mode: "payment", cost: 1 },
      { validateToken, isTokenSpent: async (h) => spent.has(h), markTokenSpent: async (h) => void spent.add(h) },
    );
    await expect(
      mw(req, ctx(), makeRes(), async () => {
        throw new Error("handler blew up");
      }),
    ).rejects.toThrow();
    expect(spent.has(HASH)).toBe(true);
  });
});
