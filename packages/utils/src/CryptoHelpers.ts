import { sha256 } from "@noble/hashes/sha256";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
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
 * Every field a transfer output may carry. The forge reads exactly these, and
 * the v2 spend digest binds exactly these — an output field outside this list
 * could influence nothing the spender signed, so it is refused rather than
 * ignored.
 */
export const SPEND_OUT_FIELDS = [
  "to",
  "amount",
  "tokenID",
  "issuer",
  "timeLock",
] as const;

function parseOut(o: unknown): Record<string, unknown> {
  return (typeof o === "string" ? JSON.parse(o) : (o ?? {})) as Record<
    string,
    unknown
  >;
}

/** Fields on these outputs that no spend digest binds. Empty when all are known. */
export function unboundOutFields(outs: unknown[]): string[] {
  const known = new Set<string>(SPEND_OUT_FIELDS);
  const unknown = new Set<string>();
  for (const o of outs ?? []) {
    for (const key of Object.keys(parseOut(o))) {
      if (!known.has(key)) unknown.add(key);
    }
  }
  return [...unknown];
}

/**
 * Domain-separated digest that binds a P2PK spend authorization (witness) to
 * every output of a transfer (v2).
 *
 * The spender signs THIS digest instead of the bare, static, public token hash,
 * so a witness observed on the wire cannot be replayed onto other outputs
 * (audit C6). v2 binds every field the forge reads from an output —
 * {@link SPEND_OUT_FIELDS}, in a fixed order — where v1 bound only
 * to/amount/tokenID and so let a relayer re-time-lock an output. Throws on an
 * output field it does not bind, so nothing unsigned can ride along.
 *
 * Both the pocket (when signing) and the forge (when verifying) must call this
 * with the transaction's full `outs` array, change included: change is an
 * explicit output, never a remainder the forge fills in.
 */
export function spendAuthDigest(
  inputTokenHash: string,
  outs: unknown[],
): Uint8Array {
  const unknown = unboundOutFields(outs);
  if (unknown.length > 0) {
    throw new Error(
      `spendAuthDigest: output field(s) not covered by the witness: ${unknown.join(", ")}`,
    );
  }
  const normalized = (outs ?? []).map((o) => {
    const out = parseOut(o);
    return Object.fromEntries(SPEND_OUT_FIELDS.map((k) => [k, out[k] ?? null]));
  });
  const message =
    "TAT-P2PK-SPEND-v2\n" + inputTokenHash + "\n" + JSON.stringify(normalized);
  return sha256(new TextEncoder().encode(message));
}

/**
 * The retired v1 spend digest: binds only to/amount/tokenID. Forges accept it
 * only inside a transition window and only where those fields are all an
 * output has (see `ForgeConfig.acceptV1SpendDigestUntil`). Pockets must sign
 * {@link spendAuthDigest}.
 */
export function spendAuthDigestV1(
  inputTokenHash: string,
  outs: unknown[],
): Uint8Array {
  const normalized = (outs ?? []).map((o) => {
    const out = parseOut(o);
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

/**
 * Digest a P2PK holder signs to authorize BURNING a token.
 *
 * Separate domain tag from {@link spendAuthDigest}, so no transfer witness —
 * including one for a transfer with no outputs — verifies as a burn, and no
 * burn witness verifies as a transfer.
 */
export function burnAuthDigest(inputTokenHash: string): Uint8Array {
  return sha256(
    new TextEncoder().encode("TAT-P2PK-BURN-v1\n" + inputTokenHash),
  );
}

/**
 * Identifier of a transfer, derived from its inputs alone.
 *
 * Inputs can each be spent exactly once, so the set of input hashes identifies
 * the one transfer that consumed them. Deriving the id from them (rather than
 * from anything the forge assigns) is what lets a pocket that lost every reply
 * still ask the forge `status {tx_id}` about the transfer it sent. Sorted, so
 * input order does not change the id.
 *
 * Versioned: the spec's v2 id hashes the whole transaction body. That lands as
 * a new tag, not a change to this one.
 */
export function txIdForInputs(inputTokenHashes: string[]): string {
  const sorted = [...inputTokenHashes].map((h) => h.toLowerCase()).sort();
  return bytesToHex(
    sha256(new TextEncoder().encode("TAT-TX-v1\n" + sorted.join("\n"))),
  );
}

/**
 * Identifier of a mint: one per (requester, nonce).
 *
 * The nonce is the client's explicit `nonce` param when it sends one, else the
 * NWPC request id (stable across the peer's own republish). A retried mint with
 * the same id is answered from the ledger instead of minting again.
 */
export function mintTxId(requester: string, nonce: string): string {
  return bytesToHex(
    sha256(new TextEncoder().encode(`TAT-MINT-v1\n${requester}\n${nonce}`)),
  );
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
