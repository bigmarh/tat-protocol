import { describe, it, expect, beforeAll } from "@jest/globals";
import { BoothServerSpec } from "../../packages/booth/src/BoothServerSpec";
import { Token } from "@tat-protocol/token";

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
  return {
    secretKey: `${label}-secret`,
    publicKey: `${label}-public`,
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

describe("Booth TAT payments with forge spent checks", () => {
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

    (booth as any).verifyTokensNotSpent = jest
      .fn()
      .mockResolvedValue([tokenHash]);

    const cleanupTokenMocks = mockTokenRestoreAndValidate();
    try {
      const result = await (booth as any).processPayment(
        invoice,
        { method: "tat", tokens: [jwt] },
        "buyer",
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Token already spent");
      expect((booth as any).verifyTokensNotSpent).toHaveBeenCalled();
    } finally {
      cleanupTokenMocks();
    }
  });

  it("accepts unspent fungible tokens", async () => {
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

    (booth as any).verifyTokensNotSpent = jest.fn().mockResolvedValue([]);

    const cleanupTokenMocks = mockTokenRestoreAndValidate();
    try {
      const result = await (booth as any).processPayment(
        invoice,
        { method: "tat", tokens: [jwt] },
        "buyer",
      );

      expect(result.success).toBe(true);
      expect(result.receipt).toBeDefined();
      expect((booth as any).verifyTokensNotSpent).toHaveBeenCalledWith(
        [tokenHash],
        forgeKeys.publicKey,
      );
    } finally {
      cleanupTokenMocks();
    }
  });
});
