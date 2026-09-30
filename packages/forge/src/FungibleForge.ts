import { ForgeBase } from "./ForgeBase.js";
import { Token, TokenType } from "@tat-protocol/token";
import {
  NWPCRequest,
  NWPCContext,
  NWPCResponseObject,
  NWPC_SPEC_ERRORS,
} from "@tat-protocol/nwpc";
import { ForgeConfig } from "./ForgeConfig.js";
import { Recipient } from "./Types.js";
import {
  DebugLogger,
  isValidTokenAmount,
  invalidTokenAmountReason,
  mintTxId,
} from "@tat-protocol/utils";
import type { TxOutput, TxRecord } from "@tat-protocol/storage";

const Debug = DebugLogger.getInstance();

export class FungibleForge extends ForgeBase {
  constructor(config: ForgeConfig) {
    super(config);
    this.config.tokenType = TokenType.FUNGIBLE;
  }
  async forgeToken(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ) {
    let reqObj: { to?: string; amount?: number | string; nonce?: string };
    try {
      reqObj = JSON.parse(req.params);
    } catch (error) {
      return await res.error(
        NWPC_SPEC_ERRORS.PARSE_ERROR.code,
        NWPC_SPEC_ERRORS.PARSE_ERROR.message,
      );
    }

    const { to, amount } = reqObj;
    if (!amount || !to) {
      return await res.error(
        NWPC_SPEC_ERRORS.INVALID_PARAMS.code,
        "Missing required parameters",
      );
    }
    const amountToForge = Number(amount);
    // Amounts are positive safe integers. Doubles represent integers exactly up
    // to 2^53, so this is what makes the conservation arithmetic exact — a
    // fractional amount accumulates float drift and lets a transfer output
    // marginally more than its inputs while still passing the check. NaN and
    // ±Infinity are covered too: `Number("abc")` is NaN and every comparison
    // against NaN is false, so a bare `<= 0` check would let a valueless token
    // through and defeat conservation once it was spent as an input.
    const badAmount = invalidTokenAmountReason(amountToForge);
    if (badAmount) {
      return await res.error(NWPC_SPEC_ERRORS.INVALID_PARAMS.code, badAmount);
    }

    // One mint per (requester, nonce). A retry after a lost reply — same
    // request id, or the same explicit nonce — is answered from the ledger
    // rather than minting again.
    const requester = context.sender;
    const txId = mintTxId(
      requester,
      String(reqObj.nonce ?? req.id ?? globalThis.crypto.randomUUID()),
    );
    const existing = await this.getTx(txId);
    if (existing) return await this.deliverAndReply(existing, res, requester);

    const token = new Token();
    await token.build({
      ver: this.tokenVersion,
      token_type: TokenType.FUNGIBLE,
      payload: Token.createPayload({
        iss: this.keys.publicKey!,
        amount: amountToForge,
        P2PKlock: to,
      }),
    });
    const tokenJWT = await this.signAndCreateJWT(token);
    const record: TxRecord = {
      txId,
      kind: "mint",
      requestId: req.id ?? txId,
      submitter: requester,
      inputHashes: [],
      outputs: [{ to, jwt: tokenJWT }],
      createdAt: Date.now(),
    };

    // Reserve against the cap and record the output in one commit, BEFORE the
    // token is released. With a durable ledger the cap is a constraint the
    // store evaluates, not a read-compare-write that N replicas would each pass.
    let result;
    try {
      result = await this.commitMint(record, amountToForge);
    } catch (err) {
      Debug.error(
        `Mint ${txId} could not be committed: ${err}`,
        "FungibleForge",
      );
      return await res.error(
        NWPC_SPEC_ERRORS.INTERNAL_ERROR.code,
        "Mint could not be committed; nothing was issued. Retry.",
      );
    }
    if (!result.ok && !("existing" in result)) {
      return await res.error(
        NWPC_SPEC_ERRORS.SUPPLY_LIMIT.code,
        `Forging this amount (${amountToForge}) would exceed total supply (${this.state.totalSupply}). Remaining: ${await this.remainingSupply()}`,
      );
    }
    if ("existing" in result) {
      return await this.deliverAndReply(result.existing, res, requester);
    }
    return await this.deliverAndReply(
      {
        ...record,
        outputs: record.outputs.map((o) => ({ ...o, delivered: false })),
      },
      res,
      requester,
    );
  }

  async transferToken(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ) {
    // Serialize the whole validate→sign→mark-spent sequence so concurrent
    // transfers of the same input cannot both pass the spent-check (C1).
    return await this.runExclusive(async () => {
      let tx: any;
      try {
        tx = JSON.parse(req.params);
      } catch (error) {
        return await res.error(
          NWPC_SPEC_ERRORS.PARSE_ERROR.code,
          NWPC_SPEC_ERRORS.PARSE_ERROR.message,
        );
      }
      const sender = context.sender;
      // The same inputs again: a retry of a transfer that already committed.
      // Answer it from the ledger — validation would call it a double-spend.
      const replay = await this.replayCommittedTransfer(
        tx?.ins,
        tx?.outs,
        sender,
        res,
      );
      if (replay) return replay.response as any;
      // Validate transaction
      const [validTx, error, code, params] = await this.validateTXInputs(
        tx,
        tx.witnessData,
      );
      if (error || !validTx) {
        return await res.error(
          code ?? NWPC_SPEC_ERRORS.INVALID_PARAMS.code,
          "Invalid transaction: " + (error || "Validation failed"),
          params,
        );
      }

      // Restore tokens from serialized inputs
      const restoredInputs = await Promise.all(
        (validTx.ins || []).map(async (input: string) => {
          return await new Token().restore(input);
        }),
      );

      // Parse output recipients
      const recipients = (validTx.outs || []).map((out: string) =>
        typeof out === "string" ? JSON.parse(out) : out,
      );

      // Use shared transfer logic
      return await this.handleFungibleTransfer(
        restoredInputs,
        recipients,
        res,
        sender,
        req.id,
      );
    });
  }

  // Make these methods public so handlers can call them
  public async handleFungibleTransfer(
    inputs: Token[],
    outs: Recipient[],
    res: NWPCResponseObject,
    sender: string,
    requestId?: string,
  ) {
    if (!inputs || !outs) {
      return await res.error(
        NWPC_SPEC_ERRORS.INVALID_PARAMS.code,
        "Missing required parameters: inputs, outs",
      );
    }
    // 1. Validate
    const validationError = await this.validateFungibleTransfer(inputs, outs);
    if (validationError) {
      return await res.error(
        NWPC_SPEC_ERRORS.INVALID_PARAMS.code,
        validationError,
      );
    }
    // 2. Prepare every output in memory. Nothing is spent or sent yet.
    const { recipientTokens, changeTokenJWT } =
      await this.prepareFungibleTransfer(inputs, outs, sender);
    const outputs: TxOutput[] = recipientTokens.map(({ to, jwt }) => ({
      to,
      jwt,
    }));
    if (changeTokenJWT) outputs.push({ to: sender, jwt: changeTokenJWT });
    Debug.log("transfer outputs:" + outputs.length, "FungibleForge");

    // 3. Commit spent inputs + outputs together, then deliver. A failed send
    // leaves the output in the outbox, never lost.
    const inputHashes = await Promise.all(
      inputs.map((token) => token.create_token_hash()),
    );
    return await this.commitAndDeliverTransfer(
      { inputHashes, outs, outputs, submitter: sender, requestId },
      res,
    );
  }

  public async validateFungibleTransfer(
    inputs: Token[],
    outs: Recipient[],
  ): Promise<string | null> {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      return "At least one input token is required";
    }
    // Defense in depth against duplicate-input value inflation: the same token
    // listed twice must never be summed twice. (validateTXInputs also dedupes
    // on the transfer entry path; this guards direct callers of this method.)
    const seen = new Set<string>();
    for (const token of inputs) {
      const h = token.header?.token_hash ?? (await token.create_token_hash());
      if (seen.has(h)) {
        return "Duplicate input token in transfer";
      }
      seen.add(h);
    }
    let inputTotal = 0;
    for (const token of inputs) {
      // Must be a positive safe integer, so this sum stays exact. A fractional
      // input makes inputTotal drift, which lets the outputs below claim more
      // than was put in. Non-finite is covered by the same check: a single NaN
      // input makes inputTotal NaN, and `outputTotal > NaN` is always false, so
      // the conservation check would pass for arbitrary outputs.
      if (!isValidTokenAmount(token.payload.amount)) {
        return "Each input token must have a positive whole-number amount";
      }
      inputTotal += token.payload.amount;
    }
    let outputTotal = 0;
    for (const entry of outs) {
      if (!isValidTokenAmount(entry.amount)) {
        return "Each recipient needs a positive whole-number amount";
      }
      if (!entry.to) {
        return "Recipient 'to' is required";
      }
      outputTotal += entry.amount ?? 0;
    }
    if (outputTotal > inputTotal) {
      return "Insufficient total input token amount for transfer";
    }
    // Change is an explicit output. The forge used to mint any remainder as
    // change locked to whoever submitted the request — value no witness bound,
    // so a relayer holding someone else's witness could collect it.
    if (outputTotal !== inputTotal) {
      return "Outputs must spend the inputs exactly; include change as an explicit output";
    }
    return null;
  }

  public async prepareFungibleTransfer(
    inputs: Token[],
    outs: Recipient[],
    _sender: string,
  ): Promise<{
    recipientTokens: { to: string; jwt: string }[];
    changeTokenJWT?: string;
  }> {
    // For simplicity, use the first input token's data_uri for every output
    const baseToken = inputs[0];
    const recipientTokens: { to: string; jwt: string }[] = [];
    for (const entry of outs) {
      const newToken = new Token();
      await newToken.build({
        ver: this.tokenVersion,
        token_type: TokenType.FUNGIBLE,
        payload: Token.createPayload({
          iss: this.keys.publicKey!,
          amount: entry.amount,
          P2PKlock: entry.to,
          timeLock: entry.timeLock,
          data_uri: baseToken.payload.data_uri,
        }),
      });
      const jwt = await this.signAndCreateJWT(newToken);
      recipientTokens.push({ to: entry.to, jwt });
    }
    // No implicit change: validateFungibleTransfer requires outputs to spend
    // the inputs exactly. The field stays for subclasses that still return it.
    return { recipientTokens, changeTokenJWT: undefined };
  }

  async burnToken(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ) {
    // Use shared burn logic
    return await this.handleBurn(req, context, res);
  }
}
