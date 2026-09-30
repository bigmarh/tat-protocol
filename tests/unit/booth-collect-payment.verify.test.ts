// Booth never takes payment.
//
// `booth.pay` checked that the submitted tokens were unspent at the forge and
// then marked the invoice paid. It never consumed them: the buyer still held
// spendable tokens afterwards, and the same unspent tokens paid for any number
// of invoices. The price check also ignored quantity.
//
// Now the booth transfers the tokens to its own key at the forge — a spend the
// forge commits — and marks the invoice paid only once that transfer is
// committed. Paying a second invoice with the same tokens fails at the forge as
// a double-spend.
import { BoothServerSpec } from "../../packages/booth/src/BoothServerSpec";
import { Token, TokenType } from "@tat-protocol/token";
import { spendAuthDigest, txIdForInputs } from "@tat-protocol/utils";
import { schnorr } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

const FORGE_SK = "a1".repeat(32);
const FORGE = bytesToHex(schnorr.getPublicKey(FORGE_SK));
const BOOTH_SK = "b2".repeat(32);
const BOOTH = bytesToHex(schnorr.getPublicKey(BOOTH_SK));
const BUYER = "c3".repeat(32);

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

async function tokenJwt(amount: number, lock?: string) {
  const t = new Token();
  await t.build({
    token_type: TokenType.FUNGIBLE,
    payload: Token.createPayload({ iss: FORGE, amount, ...(lock ? { P2PKlock: lock } : {}) }),
  });
  const sig = await t.sign(await t.data_to_sign(), { secretKey: FORGE_SK, publicKey: FORGE });
  return { jwt: await t.toJWT(bytesToHex(sig)), hash: t.header.token_hash };
}

/**
 * A stand-in forge: commits a transfer if none of its inputs are spent, and
 * answers `status`. Enough to show the booth relies on the forge's commit.
 */
function fakeForge(opts: { dropTransferReply?: boolean; failCommit?: boolean } = {}) {
  const spent = new Set<string>();
  const committed = new Map<string, any>();
  const calls: { method: string; params: any }[] = [];
  return {
    calls,
    spent,
    async request(method: string, params: any) {
      calls.push({ method, params });
      if (method === "status") {
        const tx = committed.get(params.tx_id);
        return { result: tx ? { tx_id: params.tx_id, status: "committed", outputs: tx.outputs } : { tx_id: params.tx_id, status: "unknown", outputs: [] } };
      }
      if (method !== "transfer") throw new Error(`unexpected ${method}`);
      const hashes = await Promise.all(params.ins.map(async (j: string) => (await new Token().restore(j)).header.token_hash));
      if (opts.failCommit) throw new Error("Request timed out");
      const txId = txIdForInputs(hashes);
      // Like the real forge: resubmitting the exact same transfer (same inputs,
      // same outputs) is answered from the record as committed.
      const prior = committed.get(txId);
      if (prior && JSON.stringify(prior.params.outs) === JSON.stringify(params.outs)) {
        return { result: { tx_id: txId, status: "committed", outputs: prior.outputs, pending: 0 } };
      }
      if (hashes.some((h: string) => spent.has(h))) {
        return { error: { code: 2002, message: "Token Spent" } };
      }
      hashes.forEach((h: string) => spent.add(h));
      const outputs = params.outs.map((o: any) => ({ to: o.to, token: `jwt-for-${o.to}-${o.amount}` }));
      committed.set(txId, { outputs, params });
      if (opts.dropTransferReply) throw new Error("Request timed out");
      return { result: { tx_id: txId, status: "committed", outputs, pending: 0 } };
    },
  };
}

function makeBooth(forge: ReturnType<typeof fakeForge>) {
  const booth = new BoothServerSpec({
    storage: new MemoryStore() as any,
    keys: { secretKey: BOOTH_SK, publicKey: BOOTH },
    relays: [],
    boxOfficeName: "Test Booth",
    fee: 0.05,
    supportedPaymentMethods: ["tat"],
  }) as any;
  booth.nwpcServer.publicKey = BOOTH;
  booth.getForgeClient = async () => forge;
  return booth;
}

function invoice(id: string, price: number, quantity = 1) {
  return {
    invoiceId: id,
    catalogItem: {
      id: "item-1",
      issuer: FORGE,
      name: "Item",
      description: "Test",
      price: { amount: price, currency: "BB" },
      tokenType: "FUNGIBLE",
    },
    expiresAt: Date.now() + 60_000,
    paymentOptions: {},
    status: "pending",
    createdAt: Date.now(),
    buyerPubkey: BUYER,
    quantity,
  };
}

async function pay(booth: any, inv: any, tokens: string[]) {
  await booth.initialize();
  booth.state.invoices.set(inv.invoiceId, inv);
  const calls: any[] = [];
  const res = {
    send: async (...a: any[]) => void calls.push({ type: "send", a }),
    error: async (...a: any[]) => void calls.push({ type: "error", a }),
  };
  await booth.handlePay(
    { id: "p", method: "booth.pay", params: JSON.stringify({ invoiceId: inv.invoiceId, payment: { method: "tat", tokens } }) },
    { sender: BUYER },
    res,
  );
  return { calls, invoice: booth.state.invoices.get(inv.invoiceId) };
}

describe("booth.pay consumes the tokens at the forge", () => {
  it("transfers the tokens to the booth, signed by the booth, before marking paid", async () => {
    const forge = fakeForge();
    const booth = makeBooth(forge);
    const t = await tokenJwt(100, BOOTH);

    const { calls, invoice: inv } = await pay(booth, invoice("inv-1", 100), [t.jwt]);

    expect(calls.find((c) => c.type === "error")).toBeUndefined();
    expect(inv.status).toBe("paid");
    const transfer = forge.calls.find((c) => c.method === "transfer")!;
    expect(transfer.params.ins).toEqual([t.jwt]);
    expect(transfer.params.outs).toEqual([{ issuer: FORGE, to: BOOTH, amount: 100 }]);
    // The witness is the booth's, bound to exactly these outputs.
    expect(
      schnorr.verify(hexToBytes(transfer.params.witnessData[0]), spendAuthDigest(t.hash, transfer.params.outs), BOOTH),
    ).toBe(true);
    expect(forge.spent.has(t.hash)).toBe(true);
    expect(inv.settlement?.txId).toBe(txIdForInputs([t.hash]));
  });

  it("returns an overpayment to the buyer as an explicit output", async () => {
    const forge = fakeForge();
    const booth = makeBooth(forge);
    const t = await tokenJwt(130, BOOTH);
    await pay(booth, invoice("inv-1", 100), [t.jwt]);
    expect(forge.calls.find((c) => c.method === "transfer")!.params.outs).toEqual([
      { issuer: FORGE, to: BOOTH, amount: 100 },
      { issuer: FORGE, to: BUYER, amount: 30 },
    ]);
  });

  it("will not let the same tokens pay a second invoice", async () => {
    const forge = fakeForge();
    const booth = makeBooth(forge);
    const t = await tokenJwt(100, BOOTH);
    const first = await pay(booth, invoice("inv-1", 100), [t.jwt]);
    const second = await pay(booth, invoice("inv-2", 100), [t.jwt]);
    expect(first.invoice.status).toBe("paid");
    expect(second.invoice.status).not.toBe("paid");
    expect(second.calls.find((c) => c.type === "error")?.a[1]).toMatch(/spent/i);
  });

  it("refuses tokens not locked to the booth, which it could not spend", async () => {
    const forge = fakeForge();
    const booth = makeBooth(forge);
    for (const lock of [undefined, BUYER]) {
      const t = await tokenJwt(100, lock);
      const { invoice: inv } = await pay(booth, invoice(`inv-${lock}`, 100), [t.jwt]);
      expect(inv.status).not.toBe("paid");
    }
    expect(forge.calls).toHaveLength(0);
  });

  it("charges price × quantity", async () => {
    const forge = fakeForge();
    const booth = makeBooth(forge);
    const t = await tokenJwt(60, BOOTH);
    const { invoice: inv } = await pay(booth, invoice("inv-1", 50, 2), [t.jwt]);
    expect(inv.status).not.toBe("paid");
    expect(forge.calls).toHaveLength(0);
  });

  it("stays unpaid when the forge does not commit the transfer", async () => {
    const forge = fakeForge({ failCommit: true });
    const booth = makeBooth(forge);
    const t = await tokenJwt(100, BOOTH);
    const { invoice: inv } = await pay(booth, invoice("inv-1", 100), [t.jwt]);
    expect(inv.status).not.toBe("paid");
  });

  it("is paid when the transfer committed but its reply was lost", async () => {
    const forge = fakeForge({ dropTransferReply: true });
    const booth = makeBooth(forge);
    const t = await tokenJwt(100, BOOTH);
    const { invoice: inv } = await pay(booth, invoice("inv-1", 100), [t.jwt]);
    expect(forge.calls.map((c) => c.method)).toEqual(["transfer", "status"]);
    expect(inv.status).toBe("paid");
  });
});
