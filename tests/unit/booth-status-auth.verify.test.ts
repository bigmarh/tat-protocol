// A19: booth.status returned the purchased token to anyone who knew the
// invoice id. So did booth.pay on an already-paid invoice (the receipt). The
// token and receipt now go only to the key that paid.
import { BoothServerSpec } from "../../packages/booth/src/BoothServerSpec";
import { BoothAgent } from "../../packages/booth/src/BoothAgent";

const BUYER = "b".repeat(64);
const MALLORY = "d".repeat(64);

class MemoryStore {
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

function makeRes() {
  const calls: { type: string; args: any[] }[] = [];
  return {
    calls,
    send: async (...a: any[]) => void calls.push({ type: "send", args: a }),
    error: async (...a: any[]) => void calls.push({ type: "error", args: a }),
  } as any;
}

for (const [name, Booth] of [
  ["BoothServerSpec", BoothServerSpec],
  ["BoothAgent", BoothAgent],
] as const) {
  describe(`${name}: purchase details go only to the payer`, () => {
    async function paidBooth(paidBy?: string) {
      const booth = new (Booth as any)({
        storage: new MemoryStore(),
        keys: { secretKey: "11".repeat(32), publicKey: "22".repeat(32) },
        relays: [],
        boxOfficeName: "B",
        fee: 0,
      }) as any;
      await booth.initialize();
      booth.state.invoices.set("inv-1", {
        invoiceId: "inv-1",
        catalogItem: { id: "i", issuer: "f".repeat(64), name: "I", price: { amount: 1, currency: "BB" }, tokenType: "FUNGIBLE" },
        expiresAt: Date.now() + 60_000,
        paymentOptions: {},
        status: "paid",
        createdAt: Date.now(),
        buyerPubkey: BUYER,
        ...(paidBy ? { paidBy } : {}),
        fulfillment: { status: "fulfilled", receiptId: "rcpt-1", token: "PURCHASED-TOKEN-JWT" },
      });
      booth.state.receipts.set("rcpt-1", { id: "rcpt-1", invoiceId: "inv-1", buyer: BUYER });
      return booth;
    }

    const status = async (booth: any, sender: string) => {
      const res = makeRes();
      await booth.handleStatus({ id: "s", params: JSON.stringify({ invoiceId: "inv-1" }) }, { sender }, res);
      return res.calls[0].args[0];
    };

    it("tells anyone the invoice is paid, but gives nothing else away", async () => {
      const booth = await paidBooth(BUYER);
      const body = await status(booth, MALLORY);
      expect(body.status).toBe("paid");
      expect(body.tat).toBeUndefined();
      expect(body.receipt).toBeUndefined();
    });

    it("gives the payer the receipt (and the token, where the booth keeps one)", async () => {
      const booth = await paidBooth(BUYER);
      const body = await status(booth, BUYER);
      expect(body.receipt?.id).toBe("rcpt-1");
      if (name === "BoothServerSpec") expect(body.tat).toBe("PURCHASED-TOKEN-JWT");
    });

    it("identifies the payer from the receipt on invoices paid before paidBy existed", async () => {
      const booth = await paidBooth();
      expect((await status(booth, BUYER)).receipt?.id).toBe("rcpt-1");
      expect((await status(booth, MALLORY)).receipt).toBeUndefined();
    });

    it("does not hand the receipt to someone re-submitting booth.pay on a paid invoice", async () => {
      const booth = await paidBooth(BUYER);
      const res = makeRes();
      await booth.handlePay(
        { id: "p", params: JSON.stringify({ invoiceId: "inv-1", payment: { method: "tat", tokens: [] } }) },
        { sender: MALLORY },
        res,
      );
      const sent = res.calls.find((c: any) => c.type === "send")?.args[0];
      expect(sent?.receipt).toBeUndefined();
      expect(sent?.tat).toBeUndefined();
    });
  });
}
