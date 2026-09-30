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
import { v4 as uuidv4 } from "uuid";
import { DebugLogger, mintTxId } from "@tat-protocol/utils";
import type { TxOutput, TxRecord } from "@tat-protocol/storage";

const Debug = DebugLogger.getInstance();

export class NonFungibleForge extends ForgeBase {
  constructor(config: ForgeConfig) {
    super(config);
    this.config.tokenType = TokenType.TAT;
  }
  /*
   * @dev Forge a new token
   * @param req - The request object
   * @param _context - The context object
   * @param res - The response object
   * @returns The token JWT
   */
  async forgeToken(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ) {
    let reqObj: { to?: string; nonce?: string };
    try {
      reqObj = JSON.parse(req.params);
    } catch (error) {
      return await res.error(
        NWPC_SPEC_ERRORS.PARSE_ERROR.code,
        NWPC_SPEC_ERRORS.PARSE_ERROR.message,
      );
    }
    const { to } = reqObj;
    if (!to) {
      return await res.error(
        NWPC_SPEC_ERRORS.INVALID_PARAMS.code,
        "Missing required parameters",
      );
    }
    // One mint per (requester, nonce) — see FungibleForge.forgeToken.
    const requester = context.sender;
    const txId = mintTxId(
      requester,
      String(reqObj.nonce ?? req.id ?? uuidv4()),
    );
    const existing = await this.getTx(txId);
    if (existing) return await this.deliverAndReply(existing, res, requester);

    // Choose tokenID strategy
    let tokenID: string | number;
    if (this.config.assetIdStrategy === "unique") {
      tokenID = uuidv4();
    } else {
      // Same defect as the supply counter, one degree less dangerous: N
      // processes each holding their own lastAssetId mint duplicate ids rather
      // than duplicate money. Allocated atomically when a store is configured.
      // An id allocated for a mint that then fails the cap is skipped, not
      // reused — the safe direction.
      tokenID = await this.allocateAssetId();
    }
    const token = new Token();
    await token.build({
      token_type: TokenType.TAT,
      payload: Token.createPayload({
        iss: this.keys.publicKey!,
        tokenID,
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
    let result;
    try {
      result = await this.commitMint(record, 1);
    } catch (err) {
      Debug.error(
        `Mint ${txId} could not be committed: ${err}`,
        "NonFungibleForge",
      );
      return await res.error(
        NWPC_SPEC_ERRORS.INTERNAL_ERROR.code,
        "Mint could not be committed; nothing was issued. Retry.",
      );
    }
    if (!result.ok && !("existing" in result)) {
      return await res.error(
        NWPC_SPEC_ERRORS.SUPPLY_LIMIT.code,
        `Forging this token would exceed total supply (${this.state.totalSupply}). Remaining: ${await this.remainingSupply()}`,
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

  /*
   * @dev Transfer a token
   * @param req - The request object
   * @param _context - The context object
   * @param res - The response object
   * @returns The token JWT
   */

  async transferToken(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ) {
    // Serialize the whole validate→mint→mark-spent sequence so concurrent
    // transfers of the same NFT input cannot both pass the spent-check (C1).
    return await this.runExclusive(async () => {
      const sender = context.sender;
      let tx: any;
      try {
        tx = JSON.parse(req.params);
      } catch (error) {
        return await res.error(
          NWPC_SPEC_ERRORS.PARSE_ERROR.code,
          NWPC_SPEC_ERRORS.PARSE_ERROR.message,
        );
      }
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
      return await this.handleNonFungibleTransfer(
        restoredInputs,
        recipients,
        res,
        sender,
        req.id,
      );
    });
  }

  /*
   * @dev Handle a non-fungible transfer
   * @param inputs - The input tokens
   * @param outs - The output recipients
   * @param res - The response object
   * @returns The token JWT
   */
  public async handleNonFungibleTransfer(
    inputs: Token[],
    outs: Recipient[],
    res: NWPCResponseObject,
    sender?: string,
    requestId?: string,
  ) {
    if (!inputs?.length || !outs?.length) {
      return await res.error(
        NWPC_SPEC_ERRORS.INVALID_PARAMS.code,
        "Missing required parameters: inputs, outs",
      );
    }
    // Track inputs already consumed by an earlier recipient in this same
    // request. The spent-set is only checked once, up front in validateTXInputs,
    // so without this a duplicate tokenID in `outs` would re-find the same input
    // and mint a second valid token from a single NFT.
    const consumedInputs = new Set<Token>();
    const outputs: TxOutput[] = [];
    for (const recipient of outs) {
      const tokenID = recipient.tokenID;
      const to = recipient.to;
      if (!tokenID || !to) {
        return await res.error(
          NWPC_SPEC_ERRORS.INVALID_PARAMS.code,
          "Each recipient must specify tokenID and to",
        );
      }
      // Find an unconsumed input token with the matching tokenID
      const token = inputs.find(
        (t) =>
          !consumedInputs.has(t) &&
          t.payload.tokenID !== undefined &&
          String(t.payload.tokenID) === String(tokenID),
      );
      if (!token) {
        return await res.error(
          NWPC_SPEC_ERRORS.NOT_FOUND.code,
          `Input token with tokenID ${tokenID} not found`,
        );
      }
      consumedInputs.add(token);
      // Forge new token for recipient
      const newToken = new Token();
      await newToken.build({
        token_type: TokenType.TAT,
        payload: Token.createPayload({
          iss: this.keys.publicKey!,
          tokenID:
            typeof token.payload.tokenID === "string"
              ? Number(token.payload.tokenID)
              : token.payload.tokenID,
          P2PKlock: to,
          // The output's timeLock, which the spender signed (v2 digest). The
          // input's own timeLock has already passed — validateTXInputs checked.
          timeLock: recipient.timeLock,
          data_uri: token.payload.data_uri,
        }),
      });
      outputs.push({ to, jwt: await this.signAndCreateJWT(newToken) });
    }
    // Every input must go somewhere. One left over would be neither spent nor
    // in the tx id, so the id recorded here would not be the one the pocket
    // computes from everything it sent, and `status` recovery would miss it.
    if (consumedInputs.size !== inputs.length) {
      return await res.error(
        NWPC_SPEC_ERRORS.INVALID_PARAMS.code,
        "Every input token must be sent to an output",
      );
    }
    // Every output is prepared before anything is spent; commit them with the
    // spent inputs as one unit, then deliver.
    const inputHashes = await Promise.all(
      [...consumedInputs].map((t) => t.create_token_hash()),
    );
    return await this.commitAndDeliverTransfer(
      { inputHashes, outs, outputs, submitter: sender ?? "", requestId },
      res,
    );
  }

  // Add a getter for total supply
  public getTotalSupply(): number {
    return this.state.totalSupply;
  }

  async burnToken(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ) {
    // Use shared burn logic
    const burnResult = await this.handleBurn(req, context, res);
    // Decrement circulatingSupply on successful burn
    if (burnResult && !(burnResult as any).error) {
      this.state.circulatingSupply = Math.max(
        0,
        (this.state.circulatingSupply ?? 1) - 1,
      );
      await this._saveState();
    }
    return burnResult;
  }
}
