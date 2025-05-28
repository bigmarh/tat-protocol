import { ForgeConfig } from "./ForgeConfig";
import { ForgeState } from "./ForgeState";
import { Token } from "@tat-protocol/token";
import { TokenType, TokenValidator } from "@tat-protocol/token";
import { KeyPair } from "@tat-protocol/hdkeys";
import {
  NWPCServer,
  NWPCRequest,
  NWPCContext,
  NWPCResponseObject,
  NWPCResponse,
} from "@tat-protocol/nwpc";

import { signMessage, verifySignature, postToFeed } from "@tat-protocol/utils";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { StorageInterface, Storage } from "@tat-protocol/storage";
import NDK from "@nostr-dev-kit/ndk";

type Recipient = {
  to: string;
  amount?: number;
  tokenID?: string;
  issuer?: string;
};

/**
 * Main Forge class that handles token minting and management
 */
export class Forge extends NWPCServer {
  protected keys!: KeyPair;
  protected config: ForgeConfig;
  protected state!: ForgeState;
  private isInitialized: boolean;
  protected storage: StorageInterface;
  public ndk!: NDK;
  public owner: string;

  /**
   * Create a new Forge instance
   * @param config - Configuration options for the forge
   */
  constructor(config: ForgeConfig) {
    super(config);
    if (!config.owner) {
      throw new Error("Forge owner is required");
    }
    this.owner = config.owner;
    this.config = config;
    this.isInitialized = false;

    // Set keys from config if provided
    if (config.keys) {
      this.keys = config.keys;
    }

    this.storage = new Storage(config?.storage);
    this.ndk = this.ndk; // inherited from NWPCServer

    // Register default handlers
    this.setupDefaultHandlers();
  }

  private onlyAuthorized(
    _req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
    next: () => Promise<void>,
  ): Promise<NWPCResponse | void> {
    console.log("Forge: onlyAuthorized", context.sender, this.state.owner);
    if (
      this.state.authorizedForgers.has(context.sender) ||
      this.state.owner === context.sender
    ) {
      return next();
    }
    return res.error(403, "Forbidden");
  }

  private onlyOwner(
    _req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
    next: () => Promise<void>,
  ): Promise<NWPCResponse | void> {
    if (this.state.owner === context.sender) {
      return next();
    }
    return res.error(403, "Forbidden");
  }

  /**
   * Setup default handlers
   */
  setupDefaultHandlers() {
    this.use("ping", (_req, context, res) => {
      return res.send({ message: "pong" }, context.sender);
    });
    // Transfer
    this.use("transfer", this.handleTransfer.bind(this));
    // Forge
    this.use(
      "forge",
      this.onlyAuthorized.bind(this),
      this.handleForge.bind(this),
    );
    // Burn
    this.use("burn", this.onlyOwner.bind(this), this.handleBurn.bind(this));
    // Verify
    this.use("verify", this.handleVerify.bind(this));
  }

  /**
   * Initialize the forge
   * @param forgeId - Optional ID for the forge
   */
  async initialize(): Promise<void> {
    await super.init();
    if (this.isInitialized) return;

    try {
      // check if keys are in storage
      const storedKeys = await this.storage.getItem(
        `forge-keys-${this.keys.publicKey}`,
      );
      //save passed in keys if they are not in storage
      if (this.keys.publicKey && !storedKeys) {
        //store keys in storage
        await this.storage.setItem(
          `forge-keys-${this.keys.publicKey}`,
          JSON.stringify(this.keys),
        );
      } else if (!this.keys.publicKey || !this.keys.secretKey) {
        // Initialize keys first
        await this.initializeKeys();
      }

      // Ensure we have valid keys
      if (!this.keys || !this.keys.publicKey || !this.keys.secretKey) {
        throw new Error("Keys not properly initialized");
      }

      // NWPCServer is already initialized via super(config)
      this.ndk = this.ndk;
      this.stateKey = `forge-state-${this.keys.publicKey}`;
      await this._loadState();
      this.isInitialized = true;
    } catch (error) {
      console.error("Failed to initialize Forge:", error);
      throw error;
    }
  }

  /**
   * Initialize the keys for the forge
   * @returns void
   */
  private async initializeKeys(): Promise<void> {
    let newKeys: KeyPair;
    try {
      const forgeKeyId = `forge-keys-${this.keys.publicKey}`;
      const existingKeys = await this.storage.getItem(forgeKeyId);

      if (existingKeys) {
        const parsedKeys = JSON.parse(existingKeys);
        this.keys = {
          secretKey: parsedKeys.secretKey,
          publicKey: parsedKeys.publicKey,
        };
        return;
      } else {
        if (this.keys) {
          // If keys are provided, use them
          newKeys = this.keys;
          await this.storage.setItem(forgeKeyId, JSON.stringify(newKeys));
          return;
        } else {
          const secretKey = bytesToHex(generateSecretKey());
          const publicKey = getPublicKey(hexToBytes(secretKey));
          newKeys = {
            secretKey: secretKey,
            publicKey: publicKey,
          };
        }
        await this.storage.setItem(forgeKeyId, JSON.stringify(newKeys));
        this.keys = newKeys;
        return;
      }
    } catch (error: any) {
      throw new Error(`Key initialization failed: ${error.message}`);
    }
  }

  /**
   * Get the forge's public key
   * @returns The public key or undefined if not initialized
   */
  getPublicKey(): string | undefined {
    return this.keys.publicKey;
  }

  /**
   * Sign data using the forge's private key
   * @param data - The data to sign
   * @returns The signature
   */
  async sign(data: Uint8Array): Promise<Uint8Array> {
    return signMessage(data, this.keys);
  }

  /**
   * Verify a token's signature for physical access
   * @param tokenHash - The hash of the token payload
   * @param signature - The signature of the token
   * @param publicKey - The public key of the token issuer
   * @param readerPubkey - The public key of the reader (optional)
   * @param timeWindow - Time window in seconds for nonce validation (optional)
   * @param currentTime - Current time in milliseconds (optional, defaults to Date.now())
   * @returns Promise that resolves to true if valid
   */
  async verifyToken(
    tokenHash: string,
    signature: string,
    publicKey: string,
    readerPubkey?: string,
    timeWindow?: number,
    currentTime?: number,
  ): Promise<boolean> {
    // Check if token is already spent (only if connected)
    if (this.state.spentTokens.has(tokenHash)) {
      throw new Error("Token has already been spent");
    }

    // Verify the signature
    const dataToSign = new TextEncoder().encode(tokenHash);
    const isValid = verifySignature(
      dataToSign,
      hexToBytes(signature),
      publicKey,
    );
    if (!isValid) {
      throw new Error("Invalid token signature");
    }

    // If time window is provided, verify the time slot
    if (timeWindow && currentTime) {
      const currentSlot = Math.floor(currentTime / (timeWindow * 1000));
      const tokenSlot = parseInt(tokenHash.split(":")[1]);
      if (Math.abs(currentSlot - tokenSlot) > 1) {
        // Allow 1 slot drift
        throw new Error("Token time window expired");
      }
    }

    // If reader pubkey is provided, verify it matches
    if (readerPubkey) {
      const tokenReaderPubkey = tokenHash.split(":")[2];
      if (tokenReaderPubkey !== readerPubkey) {
        throw new Error("Token not valid for this reader");
      }
    }

    return true;
  }

  /**
   * Add an authorized forger
   * @param pubkey - The public key of the forger to add
   */
  async addAuthorizedForger(pubkey: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error("Forge must be initialized");
    }
    this.state.authorizedForgers.add(pubkey);
    await this._saveState();
  }

  /**
   * Remove an authorized forger
   * @param pubkey - The public key of the forger to remove
   */
  async removeAuthorizedForger(pubkey: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error("Forge must be initialized");
    }
    this.state.authorizedForgers.delete(pubkey);
    await this._saveState();
  }

  /**
   * Get list of authorized forgers
   */
  getAuthorizedForgers(): string[] {
    return Array.from(this.state.authorizedForgers ?? []);
  }

  public async _saveState(): Promise<void> {
    this.saveState(this.stateKey, this.state);
  }

  public async _loadState(): Promise<void> {
    const savedState = await this.loadState(this.stateKey);
    if (savedState !== null) {
      // Restore from saved state, but ensure Set/Map fields are properly restored
      this.state = {
        ...this.state,
        ...savedState,
        spentTokens: new Set(savedState.spentTokens || []),
        pendingTxs: new Map(savedState.pendingTxs || []),
        authorizedForgers: new Set(savedState.authorizedForgers || []),
        tokenUsage: new Map(savedState.tokenUsage || []),
        processedEventIds: new Set(savedState.processedEventIds || []),
      };
    } else {
      this.state = {
        ...this.state,
        owner: this.config.owner || "",
        version: 1,
        spentTokens: new Set(),
        pendingTxs: new Map(),
        totalSupply: this.config.totalSupply || 0,
        lastAssetId: 0,
        authorizedForgers: new Set(this.config.authorizedForgers || []),
        tokenUsage: new Map(),
        circulatingSupply: 0,
        processedEventIds: new Set(),
      };
      await this._saveState();
    }
  }

  async publishSpentToken(tokenHash: string) {
    if (this.keys.publicKey && this.keys.secretKey) {
      // Publish spent token event to Nostr
      await postToFeed(this.ndk, `spent:${tokenHash}`, this.keys, [
        ["t", tokenHash],
        ["p", this.keys.publicKey!],
      ]);
    }
  }




  //Handlers

  /**
   * Handles a transfer of a token
   * @param req - The request object
   * @param context - The context object
   * @param res - The response object
   * @returns The response object
   */
  private async handleTransfer(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ) {
    const [method, tx] = JSON.parse(req.params);
    const sender = context.sender; // Get sender from context

    //validate transaction
    const [validTx, error] = await this.validateTXInputs(tx);
    if (error) {
      return await res.error(400, "Invalid transaction");
    }

    switch (method) {
      case 'transferTAT':
        //takes a tokenJWT and a to address
        return await this.handleNonFungibleTransfer(validTx.inputs, validTx.outs, res);
      case 'transfer':
        //takes inputs and outputs to build a fungible transfer
        return await this.handleFungibleTransfer(validTx.inputs, validTx.outs, res, sender);
      default:
        return await res.error(400, "Invalid method");
    }

  }

  /**
   * Handles a transactional transfer of fungible tokens with multiple inputs and outputs.
   * Ensures all-or-nothing: no state is mutated and no tokens are sent until all checks and preparations succeed.
   */
  private async handleFungibleTransfer(
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
      inputs.map(
        async (token) =>
          await this.publishSpentToken(await token.create_token_hash()),
      ),
    );

    // Send output tokens to recipients
    for (const { to, jwt } of recipientTokens) {
      await res.send({ token: jwt }, to);
    }
    // Send change token to sender, if any
    if (changeTokenJWT) {
      return await res.send({ token: changeTokenJWT }, sender);
    }
    return;
  }

  // Helper: Validate fungible transfer with multiple inputs/outputs
  private async validateFungibleTransfer(
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

  // Helper: Prepare tokens for recipients and change (multi-input, multi-output)
  private async prepareFungibleTransfer(
      inputs: Token[],
    outs: Recipient[],
    sender: string,
  ) {
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
          timeLock: baseToken.payload.timeLock,
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
    const outputTotal = outs.reduce((sum, entry) => sum + (entry.amount ?? 0), 0);
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


  private async handleNonFungibleTransfer(
    inputs: Token[],
    outs: Recipient[],
    res: NWPCResponseObject,
  ) {
    if (!inputs?.length || !outs?.length) {
      return await res.error(400, "Missing required parameters: inputs, outs");
    }

    for (const recipient of outs) {
      const tokenID = recipient.tokenID;
      const to = recipient.to;

      if (!tokenID || !to) {
        return await res.error(400, "Each recipient must specify tokenID and to");
      }

      // Find the input token with the matching tokenID
      const token = inputs.find(
        t =>
          t.payload.tokenID !== undefined &&
          String(t.payload.tokenID) === String(tokenID)
      );

      if (!token) {
        return await res.error(400, `Input token with tokenID ${tokenID} not found`);
      }

      // Mint new token for recipient
      const newToken = new Token();
      await newToken.build({
        token_type: TokenType.TAT,
        payload: Token.createPayload({
          iss: this.keys.publicKey!,
          tokenID: typeof token.payload.tokenID === "string"
            ? Number(token.payload.tokenID)
            : token.payload.tokenID,
          P2PKlock: to,
          timeLock: token.payload.timeLock,
          data_uri: token.payload.data_uri,
        }),
      });

      const newTokenJWT = await this.signAndCreateJWT(newToken);
      await this.publishSpentToken(await token.create_token_hash());

      await res.send({ token: newTokenJWT }, to);
    }
    return;
  }

  // Helper method to sign and create JWT
  private async signAndCreateJWT(token: Token): Promise<string> {
    const dataToSign = await token.data_to_sign();
    const signature = await token.sign(dataToSign, this.keys);
    return await token.toJWT(bytesToHex(signature));
  }

  /**
   * Handle token minting request
   */
  private async handleForge(
    req: NWPCRequest,
    _context: NWPCContext,
    res: NWPCResponseObject,
  ) {
    const response = JSON.parse(req.params);
    const reqObj = response[0];
    console.log("Forge: handleForge", reqObj, req.params);

    try {
      const token = new Token();
      const tokenType = this.config.tokenType || TokenType.TAT;
      console.log("Type:", tokenType);

      switch (tokenType) {
        case TokenType.FUNGIBLE:
          console.log("Forge: handleForge: FUNGIBLE", reqObj);

          if (!reqObj.amount || !reqObj.to) {
            return await res.error(400, "Missing required parameters");
          }
          // --- SUPPLY CHECK ---
          const amountToForge = Number(reqObj.amount);
          if (amountToForge <= 0) {
            return await res.error(400, "Amount must be positive");
          }
          // Only enforce cap if totalSupply is set and > 0
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

          await token.build({
            token_type: TokenType.FUNGIBLE,
            payload: Token.createPayload({
              iss: this.keys.publicKey!,
              amount: amountToForge,
              P2PKlock: reqObj.to,
            }),
          });

          // Update circulating supply
          this.state.circulatingSupply =
            (this.state.circulatingSupply ?? 0) + amountToForge;
          break;
        case TokenType.TAT:
          if (!reqObj.to) {
            return await res.error(400, "Missing required parameters");
          }
          // --- SUPPLY CHECK FOR NON-FUNGIBLE ---
          if (
            this.state.totalSupply > 0 &&
            (this.state.circulatingSupply ?? 0) + 1 > this.state.totalSupply
          ) {
            return await res.error(
              400,
              `Forging this token would exceed total supply (${this.state.totalSupply}). Remaining: ${this.state.totalSupply - (this.state.circulatingSupply ?? 0)}`,
            );
          }
          await token.build({
            token_type: TokenType.TAT,
            payload: Token.createPayload({
              iss: this.keys.publicKey!,
              tokenID: this.state.lastAssetId,
              P2PKlock: reqObj.to,
            }),
          });
          this.state.lastAssetId += 1;
          // Update circulating supply for TAT
          this.state.circulatingSupply =
            (this.state.circulatingSupply ?? 0) + 1;
          break;
      }
      const tokenJWT = await this.signAndCreateJWT(token);
      await this._saveState();
      return await res.send({ token: tokenJWT }, reqObj.to);
    } catch (error: any) {
      return await res.error(500, error.message);
    }
  }

  /**
   * Handle token burning request
   */
  private async handleBurn(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ) {
    const { token } = JSON.parse(req.params);
    if (!token) {
      return await res.error(400, "Missing token JWT");
    }

    try {
      const restoredToken = await new Token().restore(token);
      const tokenHash = await restoredToken.create_token_hash();

      if (this.state.spentTokens.has(tokenHash)) {
        return await res.error(400, "Token already spent");
      }

      await this.publishSpentToken(tokenHash);
      return await res.send({ success: true }, context.sender);
    } catch (error: any) {
      return await res.error(500, error.message);
    }
  }

  /**
   * Handle token verification request
   */

  private async validateTXInputs(tx: any, witnessData?:string[], providedHTLCSecret?: string): Promise<[any, string | null]> {
    //check if inputs can be used
    for (const input of tx.inputs) {
      const token = await new Token().restore(input.token);
      const tokenHash = await token.create_token_hash();


      if (this.state.spentTokens.has(tokenHash)) {
        return [null, "Token has already been spent"];
      }
      if (token.isExpired()) {
        return [null, "Token has expired"];
      }
      if (token.payload.P2PKlock) {
        //get witness from witness array with same index as input
        const witness = witnessData?.[tx.inputs.indexOf(input)];
        if (!witness) {
          return [null, "Witness for input not found"];
        }
        //verify witness signature
        const isValid = verifySignature(hexToBytes(token.header.token_hash), hexToBytes(witness), token.payload.P2PKlock);
        if (!isValid) {
          return [null, "Witness signature is not valid"];
        }
      }
      if (token.payload.timeLock && token.payload.timeLock > Date.now()) {
        return [null, "The TimeLock has not passed"];
      }
      if (token.payload.HTLC) {
        // Parse HTLC if it's a string
        const htlc = typeof token.payload.HTLC === "string"
          ? JSON.parse(token.payload.HTLC)
          : token.payload.HTLC;
        const payload = {
          ...token.payload,
          HTLC: htlc,
          tokenID: token.payload.tokenID !== undefined
            ? Number(token.payload.tokenID)
            : undefined,
        };
        const validation = await TokenValidator.validateTokenHTLC(
          { ...token, payload },
          providedHTLCSecret
        );
        if (!validation.valid) {
          return [null, validation.error ?? null];
        }
        if (!validation.canRedeem && !validation.canRefund) {
          return [null, "Token is locked and cannot be used"];
        }
      }

    }
    return [tx, null];
  }

  private async handleVerify(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ) {
    const { tokenJWT } = JSON.parse(req.params);
    if (!tokenJWT) {
      return await res.error(400, "Missing token JWT");
    }

    try {
      const token = await new Token().restore(tokenJWT);
      const tokenHash = await token.create_token_hash();

      const isValid = !this.state.spentTokens.has(tokenHash);
      return await res.send({ valid: isValid }, context.sender);
    } catch (error: any) {
      return await res.error(500, error.message);
    }
  }
}
