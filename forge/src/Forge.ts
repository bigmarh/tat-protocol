import { ForgeConfig } from "./ForgeConfig";
import { ForgeState } from "./ForgeState";
import { Token } from "@tat-protocol/token";
import { TokenType } from "@tat-protocol/token";
import { KeyPair } from "@tat-protocol/hdkeys";
import {
  NWPCServer,
  NWPCRequest,
  NWPCContext,
  NWPCResponseObject,
  NWPCHandler,
  NWPCResponse,
} from "@tat-protocol/nwpc";

import { signMessage, verifySignature, postToFeed } from "@tat-protocol/utils";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { StorageInterface, Storage } from "@tat-protocol/storage";
import NDK from "@nostr-dev-kit/ndk";

type Recipient = {
  to: string;
  amount: number;
};



/**
 * Main Forge class that handles token minting and management
 */
export class Forge {
  private keys!: KeyPair;
  private config: ForgeConfig;
  private state!: ForgeState;
  private isInitialized: boolean;
  private storage: StorageInterface;
  private nwpcServer!: NWPCServer;
  public ndk!: NDK;
  public owner: string;
  /**
   * Create a new Forge instance
   * @param config - Configuration options for the forge
   */
  constructor(config: ForgeConfig) {
    if (!config.owner) {
      throw new Error("Forge owner is required");
    }
    this.owner = config.owner;
    this.config = config;
    this.isInitialized = false;

    console.log("Forge: config\n\n", config);
    // Set keys from config if provided
    if (config.keys) {
      this.keys = config.keys;
    }

    this.storage = new Storage(config?.storage || {});
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
    if (this.isInitialized) return;

    try {
      if (!this.keys.publicKey || !this.keys.secretKey) {
        // Initialize keys first
        await this.initializeKeys();
      }
      // Ensure we have valid keys
      if (!this.keys || !this.keys.publicKey || !this.keys.secretKey) {
        throw new Error("Keys not properly initialized");
      }

      // Initialize NWPC server with the initialized keys
      this.nwpcServer = new NWPCServer({
        keys: {
          publicKey: this.keys.publicKey,
          secretKey: this.keys.secretKey,
        },
        relays: this.config.relays || ["ws://localhost:8080"],
      });
      this.ndk = this.nwpcServer.ndk;

      console.log(
        "Forge: NWPC server initialized with keys:",
        this.keys.publicKey,
      );

      // Register default handlers
      this.setupDefaultHandlers();

      await this.loadState();
      await this.saveState();
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
   * Use a handler for a specific method
   * @param method - The method to use the handler for
   * @param handlers - The handlers to use
   */
  use(method: string, ...handlers: NWPCHandler[]): void {
    this.nwpcServer.use(method, ...handlers);
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
    await this.saveState();
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
    await this.saveState();
  }

  /**
   * Get list of authorized forgers
   */
  getAuthorizedForgers(): string[] {
    return Array.from(this.state.authorizedForgers);
  }

  private async saveState(): Promise<void> {
    const serializableState = {
      ...this.state,
      spentTokens: Array.from(this.state.spentTokens),
      pendingTxs: Array.from(this.state.pendingTxs.entries()),
      tokenUsage: Array.from(this.state.tokenUsage.entries()),
      lastSavedAt: Date.now(),
      circulatingSupply: this.state.circulatingSupply ?? 0,
    };
    await this.storage.setItem(
      `forge-state-${this.keys.publicKey}`,
      JSON.stringify(serializableState),
    );
  }

  private async loadState(): Promise<void> {
    const savedState = await this.storage.getItem(`forge-state-${this.keys.publicKey}`);
    if (savedState) {
      const parsedState = JSON.parse(savedState);
      this.state = {
        owner: parsedState.owner,
        version: parsedState.version || 1,
        spentTokens: new Set(parsedState.spentTokens || []),
        pendingTxs: new Map(parsedState.pendingTxs || []),
        totalSupply: parsedState.totalSupply || 0,
        lastAssetId: parsedState.lastAssetId || 0,
        lastProcessedEvent: parsedState.lastProcessedEvent,
        lastSavedAt: parsedState.lastSavedAt,
        authorizedForgers: new Set(
          Array.isArray(parsedState.authorizedForgers)
            ? parsedState.authorizedForgers
            : [],
        ),
        tokenUsage: new Map(parsedState.tokenUsage || []),
        circulatingSupply: parsedState.circulatingSupply ?? 0,
      };
    } else {
      this.state = {
        owner: this.config.owner || "",
        version: 1,
        spentTokens: new Set(),
        pendingTxs: new Map(),
        totalSupply: this.config.totalSupply || 0,
        lastAssetId: 0,
        authorizedForgers: new Set(this.config.authorizedForgers || []),
        tokenUsage: new Map(),
        circulatingSupply: 0,
      };
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
    const { tokenJWT, to } = JSON.parse(req.params);
    const sender = context.sender; // Get sender from context

    // Basic validation
    if (!tokenJWT || !to) {
      return await res.error(
        400,
        "Missing required parameters: tokenJWT and to",
      );
    }

    try {
      const token = await new Token().restore(tokenJWT);

      // Route to appropriate handler based on token type
      switch (token.getTokenType()) {
        case TokenType.FUNGIBLE:
          return await this.handleFungibleTransfer([token], to, res, sender);
        case TokenType.TAT:
          return await this.handleNonFungibleTransfer(token, to, res);
        default:
          return await res.error(400, "Invalid token type");
      }
    } catch (error: any) {
      return await res.error(500, error.message);
    }
  }

  /**
   * Handles a transactional transfer of fungible tokens with multiple inputs and outputs.
   * Ensures all-or-nothing: no state is mutated and no tokens are sent until all checks and preparations succeed.
   */
  private async handleFungibleTransfer(
    tokens: Token[],
    toArray: Recipient[],
    res: NWPCResponseObject,
    sender: string,
  ) {
    // 1. Validate
    const validationError = await this.validateFungibleTransfer(tokens, toArray);
    if (validationError) return await res.error(400, validationError);

    // 2. Prepare
    const { recipientTokens, changeTokenJWT } = await this.prepareFungibleTransfer(tokens, toArray, sender);

    // 3. Commit (mark all input tokens as spent)
    await Promise.all(tokens.map(async (token) => await this.publishSpentToken(await token.create_token_hash())));

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
  private async validateFungibleTransfer(tokens: Token[], toArray: Recipient[]): Promise<string | null> {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return "At least one input token is required";
    }
    let inputTotal = 0;
    for (const token of tokens) {
      if (typeof token.payload.amount !== "number" || token.payload.amount <= 0) {
        return "Each input token must have a valid positive amount";
      }
      if (token.isExpired()) {
        return "One or more input tokens have expired";
      }
      const tokenHash = await token.create_token_hash();
      if (this.state.spentTokens.has(tokenHash)) {
        return "One or more input tokens have already been spent";
      }
      inputTotal += token.payload.amount;
    }
    let outputTotal = 0;
    for (const entry of toArray) {
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
      outputTotal += entry.amount;
    }
    if (outputTotal > inputTotal) {
      return "Insufficient total input token amount for transfer";
    }
    return null;
  }

  // Helper: Prepare tokens for recipients and change (multi-input, multi-output)
  private async prepareFungibleTransfer(tokens: Token[], toArray: Recipient[], sender: string) {
    // For simplicity, use the first input token's properties for timeLock/data_uri/change lock
    const baseToken = tokens[0];
    const recipientTokens: { to: string; jwt: string }[] = [];
    for (const entry of toArray) {
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
    const inputTotal = tokens.reduce((sum, t) => sum + (t.payload.amount || 0), 0);
    const outputTotal = toArray.reduce((sum, entry) => sum + entry.amount, 0);
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
    token: Token,
    to: string,
    res: NWPCResponseObject,
  ) {
    // Validate NFT properties
    if (!token.payload.tokenID) {
      return await res.error(400, "Non-fungible token must have a tokenID");
    }

    // Check token validity
    if (token.isExpired()) {
      return await res.error(400, "Token has expired");
    }

    // Check if token is already spent
    const tokenHash = await token.create_token_hash();
    if (this.state.spentTokens.has(tokenHash)) {
      return await res.error(400, "Token has already been spent");
    }

    // Create new token for recipient
    const newToken = new Token();
    await newToken.build({
      token_type: TokenType.TAT,
      payload: Token.createPayload({
        iss: this.keys.publicKey!,
        tokenID: token.payload.tokenID,
        P2PKlock: to,
        timeLock: token.payload.timeLock,
        data_uri: token.payload.data_uri,
      }),
    });

    const newTokenJWT = await this.signAndCreateJWT(newToken);
    await this.publishSpentToken(tokenHash);

    return await res.send({ token: newTokenJWT }, to);
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
            ((this.state.circulatingSupply ?? 0) + amountToForge > this.state.totalSupply)
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
          this.state.circulatingSupply = (this.state.circulatingSupply ?? 0) + amountToForge;
          break;
        case TokenType.TAT:
          if (!reqObj.to) {
            return await res.error(400, "Missing required parameters");
          }
          // --- SUPPLY CHECK FOR NON-FUNGIBLE ---
          if (
            this.state.totalSupply > 0 &&
            ((this.state.circulatingSupply ?? 0) + 1 > this.state.totalSupply)
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
          this.state.circulatingSupply = (this.state.circulatingSupply ?? 0) + 1;
          break;
      }
      const tokenJWT = await this.signAndCreateJWT(token);
      await this.saveState();
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
