import { sha256 } from "@noble/hashes/sha256";
import { schnorr } from "@noble/curves/secp256k1.js";
import { hexToBytes } from "@noble/hashes/utils";
import { KeyPair } from "@tat-protocol/hdkeys";
import { DebugLogger } from "./debug.js";

const Debug = DebugLogger.getInstance();

export function verifySignature(
  message: Uint8Array,
  signature: Uint8Array,
  pubkey: string,
): boolean {
  try {
    return schnorr.verify(signature, message, hexToBytes(pubkey));
  } catch (error) {
    Debug.error("Signature verification error:" + error, "CryptoHelpers");
    return false;
  }
}

export function signMessage(message: Uint8Array, keys: KeyPair): Uint8Array {
  return schnorr.sign(message, hexToBytes(keys.secretKey));
}

/**
 * Domain-separated digest that binds a P2PK spend authorization (witness) to
 * the specific outputs of a transfer.
 *
 * The spender signs THIS digest instead of the bare, static, public token hash.
 * Because the digest commits to the transfer's outputs (recipient + amount +
 * tokenID), a witness observed on the wire cannot be replayed to redirect the
 * same input to a different recipient — closing the witness-replay theft vector.
 * The leading tag also domain-separates spend authorization from token issuance
 * signing (which signs the token hash directly).
 *
 * Both the wallet (when signing) and the forge (when verifying) must call this
 * with the transaction's full `outs` array (recipients AND change).
 */
export function spendAuthDigest(
  inputTokenHash: string,
  outs: unknown[],
): Uint8Array {
  const normalized = (outs ?? []).map((o) => {
    const out = (typeof o === "string" ? JSON.parse(o) : (o ?? {})) as Record<
      string,
      unknown
    >;
    // Only the value-routing fields are bound, in a fixed key order, so the
    // wallet and forge derive an identical digest regardless of incidental
    // field ordering or extra metadata on the out objects.
    return {
      to: out.to ?? null,
      amount: out.amount ?? null,
      tokenID: out.tokenID ?? null,
    };
  });
  const message =
    "TAT-P2PK-SPEND-v1\n" + inputTokenHash + "\n" + JSON.stringify(normalized);
  return sha256(new TextEncoder().encode(message));
}

export async function createHash(data: string) {
  const encoder = new TextEncoder();
  const buffer = encoder.encode(data);
  return sha256(buffer);
}
export function addBase64Padding(str: string) {
  return str.padEnd(str.length + ((4 - (str.length % 4)) % 4), "=");
}
export function removeBase64Padding(encoded: string) {
  return encoded.replace(/=*$/, "");
}
