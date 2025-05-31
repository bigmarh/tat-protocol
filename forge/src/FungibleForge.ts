import { ForgeBase } from "./ForgeBase";
import { Token, TokenType } from "@tat-protocol/token";
import {
  NWPCRequest,
  NWPCContext,
  NWPCResponseObject,
} from "@tat-protocol/nwpc";
import { ForgeConfig } from "./ForgeConfig";
import { Recipient } from "./Types";

export class FungibleForge extends ForgeBase {
  constructor(config: ForgeConfig) {
    super(config);
    this.config.tokenType = TokenType.FUNGIBLE;
  }
  async forgeToken(
    req: NWPCRequest,
    _context: NWPCContext,
    res: NWPCResponseObject,
  ) {
    const reqObj = JSON.parse(req.params);

    const { to, amount } = reqObj;
    if (!amount || !to) {
      return await res.error(400, "Missing required parameters");
    }
    const amountToForge = Number(amount);
    if (amountToForge <= 0) {
      return await res.error(400, "Amount must be positive");
    }
    if (
      this.state.totalSupply > 0 &&
      (this.state.circulatingSupply ?? 0) + amountToForge >
        this.state.totalSupply
    ) {
      return await res.error(
        400,
        `Forging this amount (${amountToForge}) would exceed total supply (${this.state.totalSupply}). Remaining: ${this.state.totalSupply - (this.state.circulatingSupply ?? 0)}`,
      );
    }
    const token = new Token();
    await token.build({
      token_type: TokenType.FUNGIBLE,
      payload: Token.createPayload({
        iss: this.keys.publicKey!,
        amount: amountToForge,
        P2PKlock: to,
      }),
    });
    this.state.circulatingSupply =
      (this.state.circulatingSupply ?? 0) + amountToForge;
    const tokenJWT = await this.signAndCreateJWT(token);
    return await res.send({ token: tokenJWT }, to);
  }

  async transferToken(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ) {
    const tx = JSON.parse(req.params);
    const sender = context.sender;
    // Validate transaction
    const [validTx, error, code, params] = await this.validateTXInputs(
      tx,
      tx.witnessData,
    );
    if (error) {
      return await res.error(
        code ?? 400,
        "Invalid transaction: " + error,
        params,
      );
    }
    validTx.ins = await Promise.all(
      validTx.ins.map(async (input: string) => {
        return await new Token().restore(input);
      }),
    );

    // Use shared transfer logic
    return await this.handleFungibleTransfer(
      validTx.ins,
      validTx.outs,
      res,
      sender,
    );
  }

  // Make these methods public so handlers can call them
  public async handleFungibleTransfer(
    inputs: Token[],
    outs: Recipient[],
    res: NWPCResponseObject,
    sender: string,
  ) {
    if (!inputs || !outs) {
      return await res.error(400, "Missing required parameters: inputs, outs");
    }
    // 1. Validate
    const validationError = await this.validateFungibleTransfer(inputs, outs);
    if (validationError) return await res.error(400, validationError);
    // 2. Prepare
    const { recipientTokens, changeTokenJWT } =
      await this.prepareFungibleTransfer(inputs, outs, sender);
    // 3. Commit (mark all input tokens as spent)
    await Promise.all(
      inputs.map(async (token) => {
        const tokenHash = await token.create_token_hash();
        await this.publishSpentToken(tokenHash);
      }),
    );

    console.log("recipientTokens:", recipientTokens.length);
    // Send output tokens to recipients
    for (const { to, jwt } of recipientTokens) {
      console.log("sending token to:", to);
      await res.send({ token: jwt }, to);
    }
    // Send change token to sender, if any
    if (changeTokenJWT) {
      console.log("sending change token to SENDER:", sender);
      return await res.send({ token: changeTokenJWT }, sender);
    }

    //send spent tokens to the sender
    inputs.forEach(async (token) => {
      await res.send(
        {
          spent: await token.create_token_hash(),
          issuer: this.keys.publicKey!,
        },
        sender,
      );
    });
    return;
  }

  public async validateFungibleTransfer(
    inputs: Token[],
    outs: Recipient[],
  ): Promise<string | null> {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      return "At least one input token is required";
    }
    let inputTotal = 0;
    for (const token of inputs) {
      if (
        typeof token.payload.amount !== "number" ||
        token.payload.amount <= 0
      ) {
        return "Each input token must have a valid positive amount";
      }
      inputTotal += token.payload.amount;
    }
    let outputTotal = 0;
    for (const entry of outs) {
      if (
        typeof entry.amount !== "number" ||
        isNaN(entry.amount) ||
        entry.amount <= 0
      ) {
        return "Invalid or missing amount for recipient";
      }
      if (!entry.to) {
        return "Recipient 'to' is required";
      }
      outputTotal += entry.amount ?? 0;
    }
    if (outputTotal > inputTotal) {
      return "Insufficient total input token amount for transfer";
    }
    return null;
  }

  public async prepareFungibleTransfer(
    inputs: Token[],
    outs: Recipient[],
    sender: string,
  ): Promise<{
    recipientTokens: { to: string; jwt: string }[];
    changeTokenJWT?: string;
  }> {
    // For simplicity, use the first input token's properties for timeLock/data_uri/change lock
    const baseToken = inputs[0];
    const recipientTokens: { to: string; jwt: string }[] = [];
    for (const entry of outs) {
      const newToken = new Token();
      await newToken.build({
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
    // Calculate change
    const inputTotal = inputs.reduce(
      (sum, t) => sum + (t.payload.amount || 0),
      0,
    );
    const outputTotal = outs.reduce(
      (sum, entry) => sum + (entry.amount ?? 0),
      0,
    );
    let changeTokenJWT: string | undefined = undefined;
    if (inputTotal > outputTotal) {
      const changeToken = new Token();
      await changeToken.build({
        token_type: TokenType.FUNGIBLE,
        payload: Token.createPayload({
          iss: this.keys.publicKey!,
          amount: inputTotal - outputTotal,
          P2PKlock: sender,
          timeLock: baseToken.payload.timeLock,
          data_uri: baseToken.payload.data_uri,
        }),
      });
      changeTokenJWT = await this.signAndCreateJWT(changeToken);
    }
    return { recipientTokens, changeTokenJWT };
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
