import { describe, it, expect, beforeAll } from "@jest/globals";
import { BoothServerSpec } from "../../packages/booth/src/BoothServerSpec";
import { Token } from "@tat-protocol/token";
import { txIdForInputs } from "@tat-protocol/utils";
import { schnorr } from "@noble/curves/secp256k1";
import { bytesToHex } from "@noble/hashes/utils";

class MemoryStore {
  private store = new Map<string, string>();
  async getItem(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async removeItem(key: string): Promise<void> {
    this.store.delete(key);
  }
  async clear(): Promise<void> {
    this.store.clear();
  }
}

function createKeyPair(label: string) {
  // Real keys: the booth now signs the witness for the transfer that takes
  // the payment.
  const secretKey = label === "booth" ? "b0".repeat(32) : "f0".repeat(32);
  return {
    secretKey,
    publicKey: bytesToHex(schnorr.getPublicKey(secretKey)),
  };
}

/** A forge client that answers `transfer` the way a forge would. */
function forgeClient(spentHashes: string[]) {
  const calls: { method: string; params: any }[] = [];
  return {
    calls,
    async request(method: string, params: any) {
      calls.push({ method, params });
      if (method !== "transfer") return { result: { status: "unknown" } };
      const hashes = params.ins.map((j: string) => JSON.parse(j).header.token_hash);
      if (hashes.some((h: string) => spentHashes.includes(h))) {
        return { error: { code: 2002, message: "Token Spent" } };
      }
      return { result: { tx_id: txIdForInputs(hashes), status: "committed", outputs: [] } };
    },
  };
}

function createFungibleTokenJWT(
  issuerPubkey: string,
  amount: number,
  lockTo: string,
) {
  const tokenHash = `hash-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    tokenHash,
    jwt: JSON.stringify({
      header: {
        typ: "FUNGIBLE",
        token_hash: tokenHash,
      },
      payload: {
        iss: issuerPubkey,
        amount,
        P2PKlock: lockTo,
      },
    }),
  };
}

function mockTokenRestoreAndValidate() {
  const restoreMock = jest
    .spyOn(Token.prototype, "restore")
    .mockImplementation(async function (this: Token, token: string) {
      const parsed = JSON.parse(token);
      this.header = {
        alg: "Schnorr",
        typ: parsed.header.typ,
        token_hash: parsed.header.token_hash,
        ver: "1.0.0",
      };
      this.payload = {
        iss: parsed.payload.iss,
        iat: Math.floor(Date.now() / 1000),
        amount: parsed.payload.amount,
        P2PKlock: parsed.payload.P2PKlock,
      };
      this.signature = "mock-signature";
      return this;
    });

  const validateMock = jest
    .spyOn(Token.prototype, "validate")
    .mockResolvedValue(true);

  return () => {
    restoreMock.mockRestore();
    validateMock.mockRestore();
  };
}

describe("Booth TAT payments are taken by a forge transfer", () => {
  let boothKeys: { secretKey: string; publicKey: string };
  let forgeKeys: { secretKey: string; publicKey: string };

  beforeAll(() => {
    boothKeys = createKeyPair("booth");
    forgeKeys = createKeyPair("forge");
  });

  it("rejects spent tokens", async () => {
    const storage = new MemoryStore();
    const booth = new BoothServerSpec({
      storage,
      keys: boothKeys,
      relays: [],
      boxOfficeName: "Test Booth",
      fee: 0.05,
      supportedPaymentMethods: ["tat"],
    });
    await booth.initialize();
    (booth as any).nwpcServer.publicKey = boothKeys.publicKey;

    const { jwt, tokenHash } = createFungibleTokenJWT(
      forgeKeys.publicKey,
      100,
      boothKeys.publicKey,
    );

    const invoice = {
      invoiceId: "inv-1",
      catalogItem: {
        id: "item-1",
        issuer: forgeKeys.publicKey,
        name: "Item",
        description: "Test",
        price: { amount: 100, currency: "USD" },
        tokenType: "FUNGIBLE",
      },
      expiresAt: Date.now() + 10000,
      paymentOptions: {},
      status: "pending",
      createdAt: Date.now(),
      buyerPubkey: "buyer",
    };

    const forge = forgeClient([tokenHash]);
    (booth as any).getForgeClient = async () => forge;

    const cleanupTokenMocks = mockTokenRestoreAndValidate();
    try {
      const result = await (booth as any).processPayment(
        invoice,
        { method: "tat", tokens: [jwt] },
        "buyer",
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Token already spent");
      expect(forge.calls[0].method).toBe("transfer");
    } finally {
      cleanupTokenMocks();
    }
  });

  it("accepts unspent fungible tokens once the forge commits the transfer", async () => {
    const storage = new MemoryStore();
    const booth = new BoothServerSpec({
      storage,
      keys: boothKeys,
      relays: [],
      boxOfficeName: "Test Booth",
      fee: 0.05,
      supportedPaymentMethods: ["tat"],
    });
    await booth.initialize();
    (booth as any).nwpcServer.publicKey = boothKeys.publicKey;

    const { jwt, tokenHash } = createFungibleTokenJWT(
      forgeKeys.publicKey,
      100,
      boothKeys.publicKey,
    );

    const invoice = {
      invoiceId: "inv-2",
      catalogItem: {
        id: "item-1",
        issuer: forgeKeys.publicKey,
        name: "Item",
        description: "Test",
        price: { amount: 100, currency: "USD" },
        tokenType: "FUNGIBLE",
      },
      expiresAt: Date.now() + 10000,
      paymentOptions: {},
      status: "pending",
      createdAt: Date.now(),
      buyerPubkey: "buyer",
    };

    const forge = forgeClient([]);
    (booth as any).getForgeClient = async () => forge;

    const cleanupTokenMocks = mockTokenRestoreAndValidate();
    try {
      const result = await (booth as any).processPayment(
        invoice,
        { method: "tat", tokens: [jwt] },
        "buyer",
      );

      expect(result.success).toBe(true);
      expect(result.receipt).toBeDefined();
      expect(result.settlement.txId).toBe(txIdForInputs([tokenHash]));
      expect(forge.calls[0].params.outs).toEqual([
        { issuer: forgeKeys.publicKey, to: boothKeys.publicKey, amount: 100 },
      ]);
    } finally {
      cleanupTokenMocks();
    }
  });
});
