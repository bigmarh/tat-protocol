import { Token } from "@tat-protocol/token";
import { spendAuthDigest, txIdForInputs } from "@tat-protocol/utils";
import type { Invoice } from "./spec-types.js";

/** The slice of an NWPC client the booth needs to talk to a forge. */
export interface ForgeRequester {
  request(
    method: string,
    params: unknown,
    forgePubkey: string,
  ): Promise<{ result?: any; error?: { code?: number; message?: string } }>;
}

export type CollectResult =
  | {
      ok: true;
      txId: string;
      amount: number;
      tokenHashes: string[];
      /** Output JWTs now locked to the booth's key. */
      collected: string[];
    }
  | { ok: false; error: string };

const TOKEN_SPENT = 2002;

/**
 * Take a token payment: transfer the buyer's tokens to the booth's own key at
 * the issuing forge, and succeed only once the forge has committed that
 * transfer.
 *
 * Checking that tokens are unspent is not taking payment — the buyer keeps
 * them, and the same tokens pass the check for every invoice. Spending them
 * into the booth's key is. The tokens must already be P2PK-locked to the booth
 * (so the booth's witness is the one that authorizes the spend), a second
 * invoice paid with the same tokens fails at the forge as a double-spend, and
 * an overpayment goes back to the buyer as an explicit output.
 *
 * When the transfer's reply is lost the forge is asked `status {tx_id}`: only a
 * committed answer counts as paid, and anything else leaves the invoice unpaid
 * with the buyer's tokens untouched.
 */
export async function collectTokenPayment(args: {
  invoice: Invoice;
  tokens: string[];
  boothPubkey: string;
  buyerPubkey: string;
  /** Sign a 32-byte digest with the booth's key; returns hex. */
  sign: (digest: Uint8Array) => Promise<string>;
  forge: ForgeRequester;
}): Promise<CollectResult> {
  const { invoice, tokens, boothPubkey, buyerPubkey } = args;
  const item = invoice.catalogItem;
  const issuer = item.issuer;
  if (!tokens?.length) return { ok: false, error: "No tokens provided" };
  if (!boothPubkey) return { ok: false, error: "Booth has no public key" };

  let total = 0;
  const hashes: string[] = [];
  const restored: Token[] = [];
  for (const jwt of tokens) {
    const token = await new Token().restore(jwt);
    if (!(await token.validate())) return { ok: false, error: "Invalid token" };
    if (token.payload.iss !== issuer) {
      return { ok: false, error: "Token issuer mismatch" };
    }
    if (token.header.typ !== item.tokenType) {
      return { ok: false, error: "Token type mismatch" };
    }
    if (token.payload.P2PKlock !== boothPubkey) {
      // An unlocked token is a bearer note anyone who saw it could spend first;
      // one locked to another key is not the booth's to spend at all.
      return { ok: false, error: "Token must be locked to the booth" };
    }
    if (item.tokenType === "FUNGIBLE") {
      const amount = token.payload.amount;
      if (
        typeof amount !== "number" ||
        !Number.isSafeInteger(amount) ||
        amount <= 0
      ) {
        return { ok: false, error: "Invalid token amount" };
      }
      total += amount;
    } else if (token.payload.tokenID === undefined) {
      return { ok: false, error: "Missing tokenID" };
    }
    const hash = token.header.token_hash;
    if (hashes.includes(hash)) return { ok: false, error: "Duplicate token" };
    hashes.push(hash);
    restored.push(token);
  }

  let outs: Record<string, unknown>[];
  let amount: number;
  if (item.tokenType === "FUNGIBLE") {
    const due = item.price.amount * (invoice.quantity ?? 1);
    if (total < due) return { ok: false, error: "Insufficient payment amount" };
    amount = due;
    outs = [{ issuer, to: boothPubkey, amount: due }];
    if (total > due)
      outs.push({ issuer, to: buyerPubkey, amount: total - due });
  } else {
    amount = restored.length;
    outs = restored.map((t) => ({
      issuer,
      to: boothPubkey,
      tokenID: String(t.payload.tokenID),
    }));
  }

  const witnessData = await Promise.all(
    hashes.map((h) => args.sign(spendAuthDigest(h, outs))),
  );
  const txId = txIdForInputs(hashes);

  let committed: { outputs?: { to: string; token: string }[] } | undefined;
  try {
    const response = await args.forge.request(
      "transfer",
      { ins: tokens, outs, witnessData },
      issuer,
    );
    if (response.error) {
      return {
        ok: false,
        error:
          response.error.code === TOKEN_SPENT
            ? "Token already spent"
            : `Forge refused the payment: ${response.error.message ?? response.error.code}`,
      };
    }
    const r = response.result;
    if (r?.status === "committed" && r?.tx_id === txId) committed = r;
  } catch {
    // Fall through: the reply may be all that was lost.
  }
  if (!committed) {
    // Not the committed reply (lost, or the first message to arrive was an
    // output delivery): ask the forge what it recorded.
    try {
      const status = await args.forge.request(
        "status",
        { tx_id: txId },
        issuer,
      );
      if (status.result?.status === "committed") committed = status.result;
    } catch {
      // Unknown either way; unpaid is the safe answer.
    }
  }
  if (!committed) {
    return {
      ok: false,
      error: "The forge did not confirm the payment; nothing was charged",
    };
  }

  const collected = (committed.outputs ?? [])
    .filter((o) => o.to === boothPubkey)
    .map((o) => o.token);
  return { ok: true, txId, amount, tokenHashes: hashes, collected };
}
