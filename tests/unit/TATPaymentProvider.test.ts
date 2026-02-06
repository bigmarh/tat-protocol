import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  TATPaymentProvider,
  TATPaymentConfig,
} from "../../packages/booth/src/TATPaymentProvider";
import { Payment, PaymentMethod } from "../../packages/booth/src/types";

// Mock the Token class
jest.mock("@tat-protocol/token", () => {
  const mockToken = {
    restore: () => Promise.resolve(),
    validate: () => Promise.resolve(),
    verifyTokenSignature: () => Promise.resolve(true),
    getTokenType: () => "FUNGIBLE" as const,
    payload: {
      iss: "issuer-pubkey-1",
      amount: 100,
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    },
    header: {
      typ: "FUNGIBLE",
    },
  };
  return {
    Token: function() {
      return mockToken;
    },
  };
});

describe("TATPaymentProvider", () => {
  let provider: TATPaymentProvider;
  let config: TATPaymentConfig;

  beforeEach(() => {
    config = {
      acceptedIssuers: ["issuer-pubkey-1", "issuer-pubkey-2"],
      acceptedTokenTypes: ["FUNGIBLE", "TAT"],
      receiverPubkey: "receiver-pubkey",
    };
    provider = new TATPaymentProvider(config);
  });

  describe("constructor", () => {
    it("should create provider with valid config", () => {
      expect(provider).toBeDefined();
      expect(provider.name).toBe("tat");
      expect(provider.supportedMethods).toEqual([PaymentMethod.TAT]);
    });

    it("should throw if no accepted issuers", () => {
      expect(
        () =>
          new TATPaymentProvider({
            ...config,
            acceptedIssuers: [],
          }),
      ).toThrow("requires at least one accepted issuer");
    });

    it("should throw if no accepted token types", () => {
      expect(
        () =>
          new TATPaymentProvider({
            ...config,
            acceptedTokenTypes: [],
          }),
      ).toThrow("requires at least one accepted token type");
    });

    it("should throw if no receiver pubkey", () => {
      expect(
        () =>
          new TATPaymentProvider({
            ...config,
            receiverPubkey: "",
          }),
      ).toThrow("requires a receiver pubkey");
    });
  });

  describe("initializePayment", () => {
    it("should initialize payment and return payment details", async () => {
      const payment: Payment = {
        paymentId: "pay-123",
        orderId: "order-456",
        method: PaymentMethod.TAT,
        status: "pending",
        amount: { amount: 100, currency: "tat" },
        provider: "tat",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const result = await provider.initializePayment(payment);

      expect(result.paymentId).toBe("pay-123");
      expect(result.paymentAddress).toBe("receiver-pubkey");
      expect(result.paymentData).toEqual({
        acceptedIssuers: ["issuer-pubkey-1", "issuer-pubkey-2"],
        acceptedTokenTypes: ["FUNGIBLE", "TAT"],
        expectedAmount: 100,
        currency: "tat",
      });
      expect(result.expiresAt).toBeGreaterThan(Date.now());
    });
  });

  describe("verifyPayment", () => {
    it("should return not verified for unknown payment", async () => {
      const result = await provider.verifyPayment("unknown-payment");

      expect(result.verified).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.failureReason).toBe("Payment not found");
    });

    it("should return pending status for unprocessed payment", async () => {
      const payment: Payment = {
        paymentId: "pay-123",
        orderId: "order-456",
        method: PaymentMethod.TAT,
        status: "pending",
        amount: { amount: 100, currency: "tat" },
        provider: "tat",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await provider.initializePayment(payment);
      const result = await provider.verifyPayment("pay-123");

      expect(result.verified).toBe(false);
      expect(result.status).toBe("pending");
    });
  });

  describe("processTATPayment", () => {
    it("should fail for unknown payment", async () => {
      const result = await provider.processTATPayment("unknown", [
        "token-jwt-1",
      ]);

      expect(result.verified).toBe(false);
      expect(result.failureReason).toBe("Payment not found");
    });

    it("should process valid tokens and complete payment", async () => {
      const payment: Payment = {
        paymentId: "pay-123",
        orderId: "order-456",
        method: PaymentMethod.TAT,
        status: "pending",
        amount: { amount: 100, currency: "tat" },
        provider: "tat",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await provider.initializePayment(payment);
      const result = await provider.processTATPayment("pay-123", [
        "valid-token-jwt",
      ]);

      expect(result.verified).toBe(true);
      expect(result.status).toBe("completed");
      expect(result.amount).toEqual({ amount: 100, currency: "tat" });
      expect(result.completedAt).toBeDefined();
    });

    it("should reject already processed payment", async () => {
      const payment: Payment = {
        paymentId: "pay-123",
        orderId: "order-456",
        method: PaymentMethod.TAT,
        status: "pending",
        amount: { amount: 100, currency: "tat" },
        provider: "tat",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await provider.initializePayment(payment);
      await provider.processTATPayment("pay-123", ["valid-token-jwt"]);

      // Try to process again
      const result = await provider.processTATPayment("pay-123", [
        "another-token",
      ]);

      expect(result.verified).toBe(false);
      expect(result.failureReason).toBe("Payment already processed");
    });
  });

  describe("validateTokens", () => {
    it("should reject empty token array", async () => {
      const result = await provider.validateTokens([]);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("No tokens provided");
    });

    it("should accept valid tokens", async () => {
      const result = await provider.validateTokens(["valid-jwt"]);
      expect(result.valid).toBe(true);
    });
  });

  describe("refundPayment", () => {
    it("should fail for unknown payment", async () => {
      const result = await provider.refundPayment(
        "unknown",
        { amount: 100, currency: "tat" },
        "test refund",
      );

      expect(result.success).toBe(false);
      expect(result.failureReason).toBe("Payment not found");
    });

    it("should fail for non-completed payment", async () => {
      const payment: Payment = {
        paymentId: "pay-123",
        orderId: "order-456",
        method: PaymentMethod.TAT,
        status: "pending",
        amount: { amount: 100, currency: "tat" },
        provider: "tat",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await provider.initializePayment(payment);

      const result = await provider.refundPayment(
        "pay-123",
        { amount: 100, currency: "tat" },
        "test refund",
      );

      expect(result.success).toBe(false);
      expect(result.failureReason).toBe("Payment not completed, cannot refund");
    });

    it("should succeed for completed payment", async () => {
      const payment: Payment = {
        paymentId: "pay-123",
        orderId: "order-456",
        method: PaymentMethod.TAT,
        status: "pending",
        amount: { amount: 100, currency: "tat" },
        provider: "tat",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await provider.initializePayment(payment);
      await provider.processTATPayment("pay-123", ["valid-token-jwt"]);

      const result = await provider.refundPayment(
        "pay-123",
        { amount: 100, currency: "tat" },
        "test refund",
      );

      expect(result.success).toBe(true);
      expect(result.refundId).toContain("refund-pay-123");
      expect(result.completedAt).toBeDefined();
    });
  });

  describe("getPaymentStatus", () => {
    it("should return failed for unknown payment", async () => {
      const status = await provider.getPaymentStatus("unknown");
      expect(status).toBe("failed");
    });

    it("should return correct status for tracked payment", async () => {
      const payment: Payment = {
        paymentId: "pay-123",
        orderId: "order-456",
        method: PaymentMethod.TAT,
        status: "pending",
        amount: { amount: 100, currency: "tat" },
        provider: "tat",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await provider.initializePayment(payment);
      expect(await provider.getPaymentStatus("pay-123")).toBe("pending");

      await provider.processTATPayment("pay-123", ["valid-token-jwt"]);
      expect(await provider.getPaymentStatus("pay-123")).toBe("completed");
    });
  });

  describe("cancelPayment", () => {
    it("should return false for unknown payment", async () => {
      const result = await provider.cancelPayment("unknown");
      expect(result).toBe(false);
    });

    it("should cancel pending payment", async () => {
      const payment: Payment = {
        paymentId: "pay-123",
        orderId: "order-456",
        method: PaymentMethod.TAT,
        status: "pending",
        amount: { amount: 100, currency: "tat" },
        provider: "tat",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await provider.initializePayment(payment);
      const result = await provider.cancelPayment("pay-123");

      expect(result).toBe(true);
      expect(await provider.getPaymentStatus("pay-123")).toBe("failed");
    });

    it("should not cancel completed payment", async () => {
      const payment: Payment = {
        paymentId: "pay-123",
        orderId: "order-456",
        method: PaymentMethod.TAT,
        status: "pending",
        amount: { amount: 100, currency: "tat" },
        provider: "tat",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await provider.initializePayment(payment);
      await provider.processTATPayment("pay-123", ["valid-token-jwt"]);

      const result = await provider.cancelPayment("pay-123");
      expect(result).toBe(false);
    });
  });

  describe("getReceivedTokens", () => {
    it("should return empty array for unknown payment", () => {
      const tokens = provider.getReceivedTokens("unknown");
      expect(tokens).toEqual([]);
    });

    it("should return received tokens after payment", async () => {
      const payment: Payment = {
        paymentId: "pay-123",
        orderId: "order-456",
        method: PaymentMethod.TAT,
        status: "pending",
        amount: { amount: 100, currency: "tat" },
        provider: "tat",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await provider.initializePayment(payment);
      await provider.processTATPayment("pay-123", ["token-1", "token-2"]);

      const tokens = provider.getReceivedTokens("pay-123");
      expect(tokens).toEqual(["token-1", "token-2"]);
    });
  });

  describe("getConfig", () => {
    it("should return readonly copy of config", () => {
      const returnedConfig = provider.getConfig();

      expect(returnedConfig.acceptedIssuers).toEqual([
        "issuer-pubkey-1",
        "issuer-pubkey-2",
      ]);
      expect(returnedConfig.acceptedTokenTypes).toEqual(["FUNGIBLE", "TAT"]);
      expect(returnedConfig.receiverPubkey).toBe("receiver-pubkey");
    });
  });
});
