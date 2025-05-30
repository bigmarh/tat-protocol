import { ForgeBase } from './ForgeBase';
import { Token, TokenType } from '@tat-protocol/token';
import { NWPCRequest, NWPCContext, NWPCResponseObject } from '@tat-protocol/nwpc';
import { ForgeConfig } from './ForgeConfig';
import { Recipient } from './Types';

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
  async forgeToken(req: NWPCRequest, _context: NWPCContext, res: NWPCResponseObject) {
    const reqObj= JSON.parse(req.params);
    const { to } = reqObj;
    if (!to) {
      return await res.error(400, "Missing required parameters");
    }
    if (
      this.state.totalSupply > 0 &&
      (this.state.circulatingSupply ?? 0) + 1 > this.state.totalSupply
    ) {
      return await res.error(
        400,
        `Forging this token would exceed total supply (${this.state.totalSupply}). Remaining: ${this.state.totalSupply - (this.state.circulatingSupply ?? 0)}`
      );
    }
    const token = new Token();
    await token.build({
      token_type: TokenType.TAT,
      payload: Token.createPayload({
        iss: this.keys.publicKey!,
        tokenID: this.state.lastAssetId,
        P2PKlock: to,
      }),
    });
    this.state.lastAssetId += 1;
    this.state.circulatingSupply = (this.state.circulatingSupply ?? 0) + 1;
    const tokenJWT = await this.signAndCreateJWT(token);
    await this._saveState();
    return await res.send({ token: tokenJWT }, to);
  }

  /* 
  * @dev Transfer a token
  * @param req - The request object
  * @param _context - The context object
  * @param res - The response object
  * @returns The token JWT
  */

  async transferToken(req: NWPCRequest, context: NWPCContext, res: NWPCResponseObject) {
    const sender = context.sender;
    const tx = JSON.parse(req.params);
    // Validate transaction
    const [validTx, error] = await this.validateTXInputs(tx, tx.witnessData);
    if (error) {
      return await res.error(400, "Invalid transaction: " + error);
    }

    validTx.ins = await Promise.all(validTx.ins.map(async (input: string) => {
      return await new Token().restore(input);
    }));
    // Use shared transfer logic
    return await this.handleNonFungibleTransfer(
      validTx.ins,
      validTx.outs,
      res,
      sender
    );
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
    sender?: string
  ) {
    if (!inputs?.length || !outs?.length) {
      return await res.error(400, "Missing required parameters: inputs, outs");
    }
    for (const recipient of outs) {
      const tokenID = recipient.tokenID;
      const to = recipient.to;
      if (!tokenID || !to) {
        return await res.error(
          400,
          "Each recipient must specify tokenID and to",
        );
      }
      // Find the input token with the matching tokenID
      const token = inputs.find(
        (t) =>
          t.payload.tokenID !== undefined &&
          String(t.payload.tokenID) === String(tokenID
          )
      );
      if (!token) {
        return await res.error(
          400,
          `Input token with tokenID ${tokenID} not found`,
        );
      }
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
          timeLock: token.payload.timeLock,
          data_uri: token.payload.data_uri,
        }),
      });
      const newTokenJWT = await this.signAndCreateJWT(newToken);
      await this.publishSpentToken(await token.create_token_hash());
      await this._saveState();
      await res.send({ token: newTokenJWT }, to);
      await res.send({ spent:token.header.token_hash, issuer: this.keys.publicKey! }, sender);
    }
    return;
  }
  async burnToken(req: NWPCRequest, context: NWPCContext, res: NWPCResponseObject) {
    // Use shared burn logic
    return await this.handleBurn(req, context, res);
  }
} 