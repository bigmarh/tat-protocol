import { describe, it, expect, beforeEach } from "@jest/globals";
import { bytesToHex } from "@noble/hashes/utils";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { Token, TokenType } from "@tat-protocol/token";

/**
 * Security integration tests for token validation.
 * These tests verify that the real Token verification methods correctly
 * detect forged/tampered tokens - the same logic used by ForgeBase.
 */
describe("Token Validation Security (Integration)", () => {
  let forgeKeys: { secretKey: string; publicKey: string };
  let attackerKeys: { secretKey: string; publicKey: string };

  beforeEach(() => {
    const sk = generateSecretKey();
    forgeKeys = {
      secretKey: bytesToHex(sk),
      publicKey: getPublicKey(sk),
    };

    const attackerSk = generateSecretKey();
    attackerKeys = {
      secretKey: bytesToHex(attackerSk),
      publicKey: getPublicKey(attackerSk),
    };
  });

  describe("Token hash verification", () => {
    it("should reject token with tampered payload (hash mismatch)", async () => {
      // Create a valid token
      const token = new Token();
      await token.build({
        token_type: TokenType.FUNGIBLE,
        payload: {
          iss: forgeKeys.publicKey,
          iat: Math.floor(Date.now() / 1000),
          amount: 100,
        },
      });

      // Sign it properly
      const dataToSign = await token.data_to_sign();
      const signature = await token.sign(dataToSign, forgeKeys);
      const jwt = await token.toJWT(bytesToHex(signature));

      // Restore and tamper with the payload
      const tamperedToken = await new Token().restore(jwt);
      tamperedToken.payload.amount = 999999; // Attacker inflates amount

      // Verification should fail - hash doesn't match tampered payload
      const hashValid = await tamperedToken.verifyTokenHash();
      expect(hashValid).toBe(false);
    });

    it("should accept token with valid hash", async () => {
      const token = new Token();
      await token.build({
        token_type: TokenType.FUNGIBLE,
        payload: {
          iss: forgeKeys.publicKey,
          iat: Math.floor(Date.now() / 1000),
          amount: 100,
        },
      });

      const dataToSign = await token.data_to_sign();
      const signature = await token.sign(dataToSign, forgeKeys);
      const jwt = await token.toJWT(bytesToHex(signature));

      const restoredToken = await new Token().restore(jwt);
      const hashValid = await restoredToken.verifyTokenHash();
      expect(hashValid).toBe(true);
    });
  });

  describe("Token signature verification", () => {
    it("should reject token signed by wrong issuer", async () => {
      // Create token claiming to be from forge but signed by attacker
      const token = new Token();
      await token.build({
        token_type: TokenType.FUNGIBLE,
        payload: {
          iss: forgeKeys.publicKey, // Claims to be from legitimate forge
          iat: Math.floor(Date.now() / 1000),
          amount: 1000,
        },
      });

      // Sign with attacker's key instead of forge's key
      const dataToSign = await token.data_to_sign();
      const signature = await token.sign(dataToSign, attackerKeys);
      const jwt = await token.toJWT(bytesToHex(signature));

      const restoredToken = await new Token().restore(jwt);

      // Hash should be valid (it wasn't tampered with)
      const hashValid = await restoredToken.verifyTokenHash();
      expect(hashValid).toBe(true);

      // But signature should fail - signed by wrong key
      const sigValid = await restoredToken.verifyTokenSignature();
      expect(sigValid).toBe(false);
    });

    it("should accept token with valid signature", async () => {
      const token = new Token();
      await token.build({
        token_type: TokenType.FUNGIBLE,
        payload: {
          iss: forgeKeys.publicKey,
          iat: Math.floor(Date.now() / 1000),
          amount: 100,
        },
      });

      const dataToSign = await token.data_to_sign();
      const signature = await token.sign(dataToSign, forgeKeys);
      const jwt = await token.toJWT(bytesToHex(signature));

      const restoredToken = await new Token().restore(jwt);
      const sigValid = await restoredToken.verifyTokenSignature();
      expect(sigValid).toBe(true);
    });
  });

  describe("Full token validation", () => {
    it("should reject completely forged token", async () => {
      // Create token signed by attacker claiming to be from forge
      const token = new Token();
      await token.build({
        token_type: TokenType.FUNGIBLE,
        payload: {
          iss: forgeKeys.publicKey,
          iat: Math.floor(Date.now() / 1000),
          amount: 999999,
        },
      });

      const dataToSign = await token.data_to_sign();
      const signature = await token.sign(dataToSign, attackerKeys);
      const jwt = await token.toJWT(bytesToHex(signature));

      const restoredToken = await new Token().restore(jwt);

      // This is the validation flow now in ForgeBase.handleBurn and validateTXInputs:
      const hashValid = await restoredToken.verifyTokenHash();
      const sigValid = await restoredToken.verifyTokenSignature();

      // Either check failing should block acceptance
      expect(hashValid && sigValid).toBe(false);
    });

    it("should accept properly signed token", async () => {
      const token = new Token();
      await token.build({
        token_type: TokenType.FUNGIBLE,
        payload: {
          iss: forgeKeys.publicKey,
          iat: Math.floor(Date.now() / 1000),
          amount: 100,
        },
      });

      const dataToSign = await token.data_to_sign();
      const signature = await token.sign(dataToSign, forgeKeys);
      const jwt = await token.toJWT(bytesToHex(signature));

      const restoredToken = await new Token().restore(jwt);

      const hashValid = await restoredToken.verifyTokenHash();
      const sigValid = await restoredToken.verifyTokenSignature();

      expect(hashValid).toBe(true);
      expect(sigValid).toBe(true);
    });

    it("should use full validate() method correctly", async () => {
      const token = new Token();
      await token.build({
        token_type: TokenType.FUNGIBLE,
        payload: {
          iss: forgeKeys.publicKey,
          iat: Math.floor(Date.now() / 1000),
          amount: 100,
        },
      });

      const dataToSign = await token.data_to_sign();
      const signature = await token.sign(dataToSign, forgeKeys);
      const jwt = await token.toJWT(bytesToHex(signature));

      const restoredToken = await new Token().restore(jwt);

      // Full validate() should pass
      await expect(restoredToken.validate()).resolves.toBe(true);
    });

    it("should fail validate() on forged token", async () => {
      const token = new Token();
      await token.build({
        token_type: TokenType.FUNGIBLE,
        payload: {
          iss: forgeKeys.publicKey,
          iat: Math.floor(Date.now() / 1000),
          amount: 100,
        },
      });

      // Sign with wrong key
      const dataToSign = await token.data_to_sign();
      const signature = await token.sign(dataToSign, attackerKeys);
      const jwt = await token.toJWT(bytesToHex(signature));

      const restoredToken = await new Token().restore(jwt);

      // Full validate() should throw on invalid signature
      await expect(restoredToken.validate()).rejects.toThrow(
        "Invalid token signature"
      );
    });
  });
});
