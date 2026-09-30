// Value loss on delivery failure.
//
// A transfer marked its inputs spent, then pushed each output over the relay
// and kept no copy. A send that failed — or a crash between the spend and the
// send — took the value with it: the inputs were gone and nothing could ever
// re-issue the outputs. Mint had the mirror-image hole: supply was reserved,
// the send failed, and a retry minted again.
//
// Pinned here, against every ledger backend:
// - spent inputs + outputs + the tx record commit as one unit, before any send;
// - a failed send leaves the output in an outbox that retries it;
// - `status {tx_id}` lets a pocket re-fetch its outputs;
// - a failed commit leaves nothing half-applied;
// - a resubmitted transfer or mint returns the committed result rather than
//   minting again.
import "@tat-protocol/nwpc";
import { FungibleForge } from "@tat-protocol/forge";
import { Token, TokenType } from "@tat-protocol/token";
import {
  MemoryForgeLedger,
  SqliteForgeLedger,
  type ForgeLedger,
  type StorageInterface,
  type SqliteDatabaseHandle,
} from "@tat-protocol/storage";
import { serializeData, txIdForInputs } from "@tat-protocol/utils";
import { schnorr } from "@noble/curves/secp256k1";
import { bytesToHex } from "@noble/hashes/utils";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OWNER_SK = "55".repeat(32);
const OWNER = bytesToHex(schnorr.getPublicKey(OWNER_SK));
const ALICE = "a".repeat(64);
const ALICE_CHANGE = "c".repeat(64);
const BOB = "b".repeat(64);
const MALLORY = "d".repeat(64);
const DAY_MS = 24 * 60 * 60 * 1000;

class MemStore implements StorageInterface {
  m = new Map<string, string>();
  failNextWrite = false;
  async getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  async setItem(k: string, v: string) {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error("disk full");
    }
    this.m.set(k, v);
  }
  async removeItem(k: string) {
    this.m.delete(k);
  }
  async clear() {
    this.m.clear();
  }
}

type Backend = {
  name: string;
  make: () => { ledger?: ForgeLedger; cleanup?: () => void };
};

const BACKENDS: Backend[] = [
  { name: "blob state (no ledger)", make: () => ({}) },
  { name: "MemoryForgeLedger", make: () => ({ ledger: new MemoryForgeLedger() }) },
  {
    name: "SqliteForgeLedger",
    make: () => {
      const dir = mkdtempSync(join(tmpdir(), "tat-ledger-"));
      const db = new DatabaseSync(join(dir, "forge.db")) as unknown as SqliteDatabaseHandle;
      const ledger = new SqliteForgeLedger(db);
      return {
        ledger,
        cleanup: () => {
          void ledger.close?.();
          rmSync(dir, { recursive: true, force: true });
        },
      };
    },
  },
];

function makeRes(failFor: string[] = []) {
  const calls: { type: string; args: any[] }[] = [];
  return {
    calls,
    send: async (...args: any[]) => {
      const to = args[1];
      if (failFor.includes(to)) throw new Error(`relay rejected publish to ${to}`);
      calls.push({ type: "send", args });
    },
    error: async (...args: any[]) => {
      calls.push({ type: "error", args });
    },
  } as any;
}

const tokenSendsTo = (res: any, to: string) =>
  res.calls.filter(
    (c: any) => c.type === "send" && c.args[1] === to && c.args[0]?.token,
  );
const replyTo = (res: any, to: string) =>
  res.calls.find(
    (c: any) => c.type === "send" && c.args[1] === to && c.args[0]?.tx_id,
  )?.args[0];

for (const backend of BACKENDS) {
  describe(`delivery atomicity — ${backend.name}`, () => {
    let forge: any;
    let storage: MemStore;
    let ledger: ForgeLedger | undefined;
    let cleanup: (() => void) | undefined;

    beforeEach(async () => {
      ({ ledger, cleanup } = backend.make());
      storage = new MemStore();
      forge = new FungibleForge({
        owner: OWNER,
        keys: { secretKey: OWNER_SK, publicKey: OWNER },
        storage,
        totalSupply: 1000,
        relays: [],
        ledger,
      } as any);
      forge.keys = { secretKey: OWNER_SK, publicKey: OWNER };
      forge.getPublicKey = () => OWNER;
      // No relay: spent notices are fire-and-forget, so just drop them.
      forge.announceSpent = () => undefined;
      // The NWPC mock stubs saveState to a no-op; reinstate a real write so the
      // blob path's durability (and its failure) is actually exercised.
      forge.saveState = async (key: string, state: unknown) => {
        await storage.setItem(key || "forge-state", serializeData(state));
      };
      if (ledger) await ledger.supply.setMaxSupply("default", 1000);
    });

    afterEach(() => cleanup?.());

    async function mintInput(amount: number) {
      const t = new Token();
      await t.build({
        token_type: TokenType.FUNGIBLE,
        payload: Token.createPayload({ iss: OWNER, amount }),
      });
      const jwt = await forge.signAndCreateJWT(t);
      const hash = (await new Token().restore(jwt)).header.token_hash;
      return { jwt, hash };
    }

    function transferReq(ins: string[], id = "req-1") {
      return {
        id,
        method: "transfer",
        params: JSON.stringify({
          ins,
          outs: [
            { to: BOB, amount: 60 },
            { to: ALICE_CHANGE, amount: 40 },
          ],
        }),
      };
    }

    async function issued(): Promise<number> {
      return ledger
        ? await ledger.supply.getIssued("default")
        : forge.state.circulatingSupply ?? 0;
    }

    it("keeps an output whose delivery failed, and delivers it from the outbox", async () => {
      const input = await mintInput(100);
      const txId = txIdForInputs([input.hash]);
      const res = makeRes([BOB]);

      await forge.transferToken(transferReq([input.jwt]), { sender: ALICE }, res);

      // The transfer committed, and the submitter is told so, with its id.
      const reply = replyTo(res, ALICE);
      expect(reply).toMatchObject({ tx_id: txId, status: "committed", pending: 1 });
      expect(await forge.isTokenSpent(input.hash)).toBe(true);

      // Both outputs are on record; only the change got out.
      const rec = await forge.getTx(txId);
      expect(rec.outputs).toHaveLength(2);
      expect(rec.outputs.find((o: any) => o.to === BOB).delivered).toBe(false);
      expect(rec.outputs.find((o: any) => o.to === ALICE_CHANGE).delivered).toBe(true);

      // The outbox retries it over the server's own send path.
      const sent: { response: any; to: string }[] = [];
      forge.sendResponse = async (response: any, to: string) => {
        sent.push({ response, to });
      };
      await forge.drainOutbox(Date.now() + 2_000);
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(BOB);
      expect(sent[0].response.id).toBe("req-1");
      const bobJwt = rec.outputs.find((o: any) => o.to === BOB).jwt;
      expect(sent[0].response.result.token).toBe(bobJwt);
      expect((await forge.getTx(txId)).outputs.every((o: any) => o.delivered)).toBe(true);

      // Delivered is delivered: a later drain sends nothing.
      await forge.drainOutbox(Date.now() + 60_000);
      expect(sent).toHaveLength(1);
    });

    it("backs off an output whose retry also fails", async () => {
      const input = await mintInput(100);
      await forge.transferToken(transferReq([input.jwt]), { sender: ALICE }, makeRes([BOB]));
      let attempts = 0;
      forge.sendResponse = async () => {
        attempts++;
        throw new Error("still down");
      };
      const t0 = Date.now();
      await forge.drainOutbox(t0 + 2_000);
      expect(attempts).toBe(1);
      // Not due again straight away.
      await forge.drainOutbox(t0 + 2_100);
      expect(attempts).toBe(1);
      await forge.drainOutbox(t0 + 10 * 60_000);
      expect(attempts).toBe(2);
    });

    it("lets a recipient re-fetch its output with status {tx_id}", async () => {
      const input = await mintInput(100);
      const txId = txIdForInputs([input.hash]);
      await forge.transferToken(transferReq([input.jwt]), { sender: ALICE }, makeRes([BOB]));
      const bobJwt = (await forge.getTx(txId)).outputs.find((o: any) => o.to === BOB).jwt;

      const res = makeRes();
      await forge.handleStatus(
        { id: "s1", method: "status", params: JSON.stringify({ tx_id: txId }) },
        { sender: BOB },
        res,
      );
      const body = res.calls[0].args[0];
      expect(res.calls[0].args[1]).toBe(BOB);
      expect(body).toMatchObject({ tx_id: txId, status: "committed" });
      expect(body.outputs).toEqual([{ to: BOB, token: bobJwt }]);
    });

    it("gives the submitter every output, and a third party none", async () => {
      const input = await mintInput(100);
      const txId = txIdForInputs([input.hash]);
      await forge.transferToken(transferReq([input.jwt]), { sender: ALICE }, makeRes());

      const mine = makeRes();
      await forge.handleStatus({ params: JSON.stringify({ tx_id: txId }) }, { sender: ALICE }, mine);
      expect(mine.calls[0].args[0].outputs).toHaveLength(2);

      // tx_id is derivable from input hashes, which spent notices publish.
      const theirs = makeRes();
      await forge.handleStatus({ params: JSON.stringify({ tx_id: txId }) }, { sender: MALLORY }, theirs);
      expect(theirs.calls[0].args[0].outputs).toEqual([]);
    });

    it("answers status for an unknown tx without inventing one", async () => {
      const res = makeRes();
      await forge.handleStatus(
        { params: JSON.stringify({ tx_id: "0".repeat(64) }) },
        { sender: ALICE },
        res,
      );
      expect(res.calls[0].args[0]).toEqual({ tx_id: "0".repeat(64), status: "unknown", outputs: [] });
    });

    it("leaves nothing half-applied when the commit fails, and a retry then succeeds", async () => {
      const input = await mintInput(100);
      const txId = txIdForInputs([input.hash]);
      if (ledger) {
        const real = ledger.commitTransfer.bind(ledger);
        let failed = false;
        (ledger as any).commitTransfer = async (...args: any[]) => {
          if (!failed) {
            failed = true;
            throw new Error("database is locked");
          }
          return real(...(args as [any, any]));
        };
      } else {
        storage.failNextWrite = true;
      }

      const res = makeRes();
      await forge.transferToken(transferReq([input.jwt]), { sender: ALICE }, res);
      expect(res.calls.some((c: any) => c.type === "error")).toBe(true);
      expect(tokenSendsTo(res, BOB)).toHaveLength(0);
      expect(await forge.isTokenSpent(input.hash)).toBe(false);
      expect(await forge.getTx(txId)).toBeNull();

      const retry = makeRes();
      await forge.transferToken(transferReq([input.jwt]), { sender: ALICE }, retry);
      expect(tokenSendsTo(retry, BOB)).toHaveLength(1);
      expect(replyTo(retry, ALICE)).toMatchObject({ tx_id: txId, status: "committed" });
    });

    it("answers a resubmitted transfer with the committed result, not a second mint", async () => {
      const input = await mintInput(100);
      const txId = txIdForInputs([input.hash]);
      const first = makeRes();
      await forge.transferToken(transferReq([input.jwt]), { sender: ALICE }, first);
      const second = makeRes();
      await forge.transferToken(transferReq([input.jwt], "req-2"), { sender: ALICE }, second);

      expect(tokenSendsTo(first, BOB)).toHaveLength(1);
      expect(tokenSendsTo(second, BOB)).toHaveLength(0);
      const again = replyTo(second, ALICE);
      expect(again).toMatchObject({ tx_id: txId, status: "committed" });
      expect(again.outputs.map((o: any) => o.token).sort()).toEqual(
        (await forge.getTx(txId)).outputs.map((o: any) => o.jwt).sort(),
      );
    });

    it("refuses the same inputs sent to different outputs, rather than replaying the first transfer", async () => {
      // A replay keyed on inputs alone told a second, conflicting spend of the
      // same token — another device, a second booth invoice — that it had
      // committed. Only a resubmission of the SAME transfer is answered from
      // the record; anything else is a double-spend.
      const input = await mintInput(100);
      await forge.transferToken(transferReq([input.jwt]), { sender: ALICE }, makeRes());
      const other = makeRes();
      await forge.transferToken(
        {
          id: "req-9",
          method: "transfer",
          params: JSON.stringify({
            ins: [input.jwt],
            outs: [{ to: MALLORY, amount: 100 }],
          }),
        },
        { sender: ALICE },
        other,
      );
      expect(replyTo(other, ALICE)).toBeUndefined();
      expect(other.calls.find((c: any) => c.type === "error")?.args[0]).toBe(2002);
      expect(tokenSendsTo(other, MALLORY)).toHaveLength(0);
    });

    it("mints once when a mint's delivery fails and the client retries", async () => {
      const mintReq = {
        id: "mint-1",
        method: "forge",
        params: JSON.stringify({ to: BOB, amount: 100 }),
      };
      const first = makeRes([BOB]);
      await forge.forgeToken(mintReq, { sender: OWNER }, first);
      expect(first.calls.some((c: any) => c.type === "error")).toBe(false);
      const firstReply = replyTo(first, OWNER);
      expect(firstReply).toMatchObject({ status: "committed", pending: 1 });

      const retry = makeRes();
      await forge.forgeToken(mintReq, { sender: OWNER }, retry);
      const retryReply = replyTo(retry, OWNER);
      expect(retryReply.tx_id).toBe(firstReply.tx_id);
      expect(retryReply.outputs).toEqual(firstReply.outputs);
      expect(await issued()).toBe(100);

      // An explicit client nonce survives a new request id.
      const withNonce = (id: string) => ({
        id,
        method: "forge",
        params: JSON.stringify({ to: BOB, amount: 5, nonce: "n-1" }),
      });
      await forge.forgeToken(withNonce("mint-2"), { sender: OWNER }, makeRes());
      await forge.forgeToken(withNonce("mint-3"), { sender: OWNER }, makeRes());
      expect(await issued()).toBe(105);
    });

    it("keeps tx records for the retention window, then prunes them", async () => {
      const input = await mintInput(100);
      const txId = txIdForInputs([input.hash]);
      await forge.transferToken(transferReq([input.jwt]), { sender: ALICE }, makeRes());

      await forge.pruneTxRecords(Date.now() + 29 * DAY_MS);
      expect(await forge.getTx(txId)).not.toBeNull();
      await forge.pruneTxRecords(Date.now() + 31 * DAY_MS);
      expect(await forge.getTx(txId)).toBeNull();
      // Pruning a record never un-spends its inputs.
      expect(await forge.isTokenSpent(input.hash)).toBe(true);
    });
  });
}

describe("production guard", () => {
  const prevEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = prevEnv;
  });

  function forgeWith(extra: Record<string, unknown>) {
    const forge = new FungibleForge({
      owner: OWNER,
      keys: { secretKey: OWNER_SK, publicKey: OWNER },
      storage: new MemStore(),
      totalSupply: 0,
      relays: [],
      ...extra,
    } as any) as any;
    forge.keys = { secretKey: OWNER_SK, publicKey: OWNER };
    return forge;
  }

  it("refuses to start in production without a durable ledger", async () => {
    process.env.NODE_ENV = "production";
    await expect(forgeWith({}).initialize()).rejects.toThrow(/durable ledger/i);
    await expect(
      forgeWith({ ledger: new MemoryForgeLedger() }).initialize(),
    ).rejects.toThrow(/durable ledger/i);
  });

  it("starts in production with an explicit allowBlobState", async () => {
    process.env.NODE_ENV = "production";
    await expect(forgeWith({ allowBlobState: true }).initialize()).resolves.toBeUndefined();
  });

  it("rejects separate spent/supply stores that cannot commit together", async () => {
    const { MemorySpentSetStore } = await import("@tat-protocol/storage");
    await expect(
      forgeWith({ spentSetStore: new MemorySpentSetStore() }).initialize(),
    ).rejects.toThrow(/ForgeLedger/);
  });
});
