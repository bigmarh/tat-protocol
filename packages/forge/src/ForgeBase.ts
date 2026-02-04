import { ForgeConfig } from "./ForgeConfig";
import { ForgeState } from "./ForgeState";
import { Token } from "@tat-protocol/token";
import { TokenValidator } from "@tat-protocol/token";
import {
  NWPCServer,
  NWPCRequest,
  NWPCContext,
  NWPCResponseObject,
  NWPCResponse,
} from "@tat-protocol/nwpc";
import {
  signMessage,
  verifySignature,
  postToFeed,
  DebugLogger,
} from "@tat-protocol/utils";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { StorageInterface } from "@tat-protocol/storage";

const Debug = DebugLogger.getInstance();

/**
 * Transaction data structure
 */
interface TransactionData {
  ins?: string[];
  outs?: string[];
  witnessData?: string[];
  [key: string]: unknown;
}

/**
 * Base class for implementing a token forge (issuer).
 *
 * ForgeBase provides the core infrastructure for creating, validating, and managing
 * tokens in the TAT Protocol. Subclasses must implement the abstract methods for
 * minting fungible tokens and TATs, as well as handling transfers and burns.
 *
 * The forge maintains state including spent tokens, authorized forgers, and supply limits.
 * It validates all token transactions and publishes spent token notifications.
 *
 * @example
 * ```typescript
 * class MyForge extends ForgeBase {
 *   async forgeToken(req, context, res) {
 *     // Implementation for minting fungible tokens
 *   }
 *   async transferToken(req, context, res) {
 *     // Implementation for transferring tokens
 *   }
 *   async burnToken(req, context, res) {
 *     // Implementation for burning tokens
 *   }
 * }
 * ```
 */
export abstract class ForgeBase extends NWPCServer {
  public config: ForgeConfig;
  public state: ForgeState = undefined as any;
  public storage: StorageInterface;
  public owner: string;
  public isInitialized: boolean = false;

  /**
   * Creates a new ForgeBase instance.
   *
   * The constructor initializes the forge with configuration, sets up storage,
   * and registers default handlers for forge, transfer, and burn operations.
   *
   * @param config - Configuration object containing owner, storage, keys, and supply limits
   * @throws {Error} If owner is not provided in config
   * @throws {Error} If storage is not provided in config
   */
  constructor(config: ForgeConfig) {
    super(config);

    if (!config.owner) throw new Error("Forge owner is required");
    this.owner = config.owner;
    this.config = config;
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
      relays: new Set(),
    };
    if (config.keys) this.keys = config.keys;
    if (!config.storage)
      throw new Error(
        "A StorageInterface implementation must be provided in config.storage",
      );
    this.storage = config.storage;
    this.setupDefaultHandlers();
  }

  /**
   * Abstract method for minting new fungible tokens.
   *
   * Implementations should validate the request, check authorization and supply limits,
   * create new token(s), and return them to the requester. Fungible tokens are identical
   * and interchangeable, each with a specific denomination/amount.
   *
   * @param req - The NWPC request containing minting parameters
   * @param context - The request context with sender and recipient information
   * @param res - Response object for sending the result
   * @returns Response containing the newly minted token(s) or an error
   */
  abstract forgeToken(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ): Promise<NWPCResponse | void>;

  /**
   * Abstract method for transferring tokens between parties.
   *
   * Implementations should validate inputs, verify signatures and locks, check that
   * tokens haven't been spent, update the spent token registry, and create new outputs.
   * This is the core method for handling token transfers in the protocol.
   *
   * @param req - The NWPC request containing the transaction with inputs and outputs
   * @param context - The request context with sender and recipient information
   * @param res - Response object for sending the result
   * @returns Response confirming the transfer or an error
   */
  abstract transferToken(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ): Promise<NWPCResponse | void>;

  /**
   * Abstract method for burning (destroying) tokens.
   *
   * Implementations should verify token ownership, mark the token as spent, and
   * optionally update supply counters. Burning is permanent and cannot be reversed.
   *
   * @param req - The NWPC request containing the token to burn
   * @param context - The request context with sender information
   * @param res - Response object for sending the result
   * @returns Response confirming the burn or an error
   */
  abstract burnToken(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ): Promise<NWPCResponse | void>;

  setupDefaultHandlers() {
    this.use("forge", this.forgeToken.bind(this));
    this.use("transfer", this.transferToken.bind(this));
    this.use("burn", this.burnToken.bind(this));
    this.use("verify", this.handleVerify.bind(this));
  }

  public onlyAuthorized(
    _req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
    next: () => Promise<void>,
  ): Promise<NWPCResponse | void> {
    Debug.log("onlyAuthorized" + context.sender + this.state.owner, "Forge");
    if (
      this.state.authorizedForgers.has(context.sender) ||
      this.state.owner === context.sender
    ) {
      return next();
    }
    return res.error(403, "Forbidden");
  }

  public onlyOwner(
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
   * Initializes the forge instance.
   *
   * This method must be called after construction and before using the forge.
   * It loads or generates keys, initializes storage, loads saved state, and
   * establishes network connections. Safe to call multiple times (idempotent).
   *
   * @throws {Error} If keys cannot be initialized or storage fails
   *
   * @example
   * ```typescript
   * const forge = new MyForge(config);
   * await forge.initialize();
   * // Forge is now ready to handle requests
   * ```
   */
  public async initialize(): Promise<void> {
    await super.init();
    if (this.isInitialized) return;
    try {
      // If signer is provided, get public key from it
      if (this.signer) {
        const signerPubkey = await this.signer.getPublicKey();
        this.keys = { secretKey: "", publicKey: signerPubkey };
        this.stateKey = `forge-state-${signerPubkey}`;
        await this._loadState();
        this.isInitialized = true;
        return;
      }

      // Fall back to key-based initialization for backwards compatibility
      const forgeKeyId = `forge-keys-${this.keys?.publicKey ?? ""}`;
      let keys = this.keys;
      // Try to load keys from storage if not present
      const storedKeys = await this.storage.getItem(forgeKeyId);
      if (keys && keys.publicKey && !storedKeys) {
        await this.storage.setItem(forgeKeyId, JSON.stringify(keys));
      } else if (!keys?.publicKey || !keys?.secretKey) {
        if (storedKeys) {
          const parsedKeys = JSON.parse(storedKeys);
          keys = {
            secretKey: parsedKeys.secretKey,
            publicKey: parsedKeys.publicKey,
          };
        } else {
          const secretKey = bytesToHex(generateSecretKey());
          const publicKey = getPublicKey(hexToBytes(secretKey));
          keys = { secretKey, publicKey };
          await this.storage.setItem(forgeKeyId, JSON.stringify(keys));
        }
        this.keys = keys;
      }
      if (!this.keys || !this.keys.publicKey || !this.keys.secretKey) {
        throw new Error("Keys not properly initialized");
      }
      this.ndk = this.ndk;
      this.stateKey = `forge-state-${this.keys.publicKey}`;
      await this._loadState();
      this.isInitialized = true;
    } catch (error) {
      Debug.error("Failed to initialize Forge:" + error, "Forge");
      throw error;
    }
  }

  public getPublicKey(): string | undefined {
    return this.publicKey || this.keys.publicKey;
  }

  public async sign(data: Uint8Array): Promise<Uint8Array> {
    if (this.signer) {
      const sigHex = await this.signer.sign(data);
      return hexToBytes(sigHex);
    }
    return signMessage(data, this.keys);
  }

  public async verifyToken(
    tokenHash: string,
    signature: string,
    publicKey: string,
    readerPubkey?: string,
    timeWindow?: number,
    currentTime?: number,
  ): Promise<boolean> {
    if (this.state.spentTokens.has(tokenHash)) {
      throw new Error("Token is already spent");
    }
    const dataToSign = new TextEncoder().encode(tokenHash);
    const isValid = verifySignature(
      dataToSign,
      hexToBytes(signature),
      publicKey,
    );
    if (!isValid) {
      throw new Error("Invalid token signature");
    }
    if (timeWindow && currentTime) {
      const currentSlot = Math.floor(currentTime / (timeWindow * 1000));
      const tokenSlot = parseInt(tokenHash.split(":")[1]);
      if (Math.abs(currentSlot - tokenSlot) > 1) {
        throw new Error("Token time window expired");
      }
    }
    if (readerPubkey) {
      const tokenReaderPubkey = tokenHash.split(":")[2];
      if (tokenReaderPubkey !== readerPubkey) {
        throw new Error("Token not valid for this reader");
      }
    }
    return true;
  }

  /**
   * Grants authorization to mint tokens to a specific public key.
   *
   * Only the forge owner can add authorized forgers. Authorized forgers can mint
   * new tokens within the configured supply limits. This is useful for delegating
   * minting authority while maintaining control over the forge.
   *
   * @param pubkey - The public key to authorize for minting
   * @throws {Error} If the forge is not initialized
   *
   * @example
   * ```typescript
   * await forge.addAuthorizedForger('delegatePubkey');
   * // 'delegatePubkey' can now mint tokens
   * ```
   */
  public async addAuthorizedForger(pubkey: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error("Forge must be initialized");
    }
    this.state.authorizedForgers.add(pubkey);
    await this._saveState();
  }

  /**
   * Revokes minting authorization from a public key.
   *
   * Only the forge owner can remove authorized forgers. The removed forger will
   * no longer be able to mint new tokens, though previously minted tokens remain valid.
   *
   * @param pubkey - The public key to remove from authorized forgers
   * @throws {Error} If the forge is not initialized
   *
   * @example
   * ```typescript
   * await forge.removeAuthorizedForger('delegatePubkey');
   * // 'delegatePubkey' can no longer mint tokens
   * ```
   */
  public async removeAuthorizedForger(pubkey: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error("Forge must be initialized");
    }
    this.state.authorizedForgers.delete(pubkey);
    await this._saveState();
  }

  /**
   * Retrieves the list of public keys authorized to mint tokens.
   *
   * @returns Array of authorized forger public keys
   *
   * @example
   * ```typescript
   * const authorizedForgers = forge.getAuthorizedForgers();
   * console.log('Authorized minters:', authorizedForgers);
   * ```
   */
  public getAuthorizedForgers(): string[] {
    return Array.from(this.state.authorizedForgers ?? []);
  }

  public async _saveState(): Promise<void> {
    this.saveState(this.stateKey, this.state);
  }

  public async _loadState(): Promise<void> {
    const savedState = await this.loadState(this.stateKey);
    if (savedState !== null) {
      // Cast to ForgeState to access forge-specific properties
      const forgeState = savedState as any;
      this.state = {
        ...this.state,
        ...savedState,
        spentTokens: new Set(forgeState.spentTokens || []),
        pendingTxs: new Map(forgeState.pendingTxs || []),
        authorizedForgers: new Set(forgeState.authorizedForgers || []),
        tokenUsage: new Map(forgeState.tokenUsage || []),
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
      };
      await this._saveState();
    }
  }

  public async publishSpentToken(tokenHash: string) {
    if (this.keys.publicKey && this.keys.secretKey) {
      await postToFeed(this.ndk, `spent:${tokenHash}`, this.keys, [
        ["t", tokenHash],
        ["p", this.keys.publicKey!],
      ]);
    }

    this.state.spentTokens.add(tokenHash);
    await this._saveState();
  }

  public async handleBurn(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ) {
    let parsed: { token?: string };
    try {
      parsed = JSON.parse(req.params);
    } catch (error) {
      return await res.error(400, "Invalid request parameters");
    }
    const { token } = parsed;
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
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unknown error occurred";
      return await res.error(500, message);
    }
  }

  public async handleVerify(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ) {
    let parsed: { token_hashes?: string[] };
    try {
      parsed = JSON.parse(req.params);
    } catch (error) {
      return await res.error(400, "Invalid request parameters");
    }
    const tokenHashes = parsed.token_hashes;
    if (!Array.isArray(tokenHashes) || tokenHashes.length === 0) {
      return await res.error(400, "token_hashes is required");
    }
    const spent: Record<string, boolean> = {};
    const valid: Record<string, boolean> = {};
    for (const hash of tokenHashes) {
      if (typeof hash !== "string") {
        return await res.error(400, "token_hashes must be strings");
      }
      const isSpent = this.state.spentTokens.has(hash);
      spent[hash] = isSpent;
      valid[hash] = !isSpent;
    }
    return await res.send({ valid, spent }, context.sender);
  }

  /**
   * Signs a token and converts it to JWT format.
   *
   * This method prepares the token for issuance by creating a signature using the
   * forge's private key (or signer) and encoding the result as a JWT string. The JWT
   * can then be sent to users or stored.
   *
   * @param token - The token to sign
   * @returns The signed token as a JWT string
   *
   * @example
   * ```typescript
   * const token = new Token({ token_type: TokenType.FUNGIBLE, payload: {...} });
   * const jwt = await forge.signAndCreateJWT(token);
   * // Send jwt to the user
   * ```
   */
  public async signAndCreateJWT(token: Token): Promise<string> {
    const dataToSign = await token.data_to_sign();

    let signatureHex: string;
    if (this.signer) {
      signatureHex = await this.signer.sign(dataToSign);
    } else {
      const signature = await token.sign(dataToSign, this.keys);
      signatureHex = bytesToHex(signature);
    }

    return await token.toJWT(signatureHex);
  }

  /**
   * Validates all input tokens in a transaction.
   *
   * This method performs comprehensive validation of transaction inputs including:
   * - Checking tokens haven't been spent (double-spend prevention)
   * - Verifying tokens haven't expired
   * - Validating P2PK lock signatures if present
   * - Checking time locks haven't expired
   * - Validating HTLC secrets if present
   *
   * @param tx - The transaction data containing input tokens
   * @param witnessData - Optional witness signatures for P2PK locked tokens
   * @param providedHTLCSecret - Optional secret for unlocking HTLC tokens
   * @returns Tuple of [validated transaction, error message, error code, error details]
   *          On success: [tx, null, null, undefined]
   *          On failure: [null, errorMessage, errorCode, errorDetails]
   *
   * @example
   * ```typescript
   * const [validTx, error, code, details] = await forge.validateTXInputs(tx, witnessData);
   * if (error) {
   *   return res.error(code, error);
   * }
   * // Proceed with validated transaction
   * ```
   */
  public async validateTXInputs(
    tx: TransactionData,
    witnessData?: string[],
    providedHTLCSecret?: string,
  ): Promise<
    [TransactionData | null, string | null, number | null, string | undefined]
  > {
    const inputs = tx.ins;
    if (!inputs) {
      return [null, "Transaction inputs are required", 400, ""];
    }
    for (const input of inputs) {
      const token = await new Token().restore(input);
      const tokenHash = await token.create_token_hash();
      if (this.state.spentTokens.has(tokenHash)) {
        return [
          null,
          "Token is already spent",
          409,
          JSON.stringify({ spent: tokenHash, issuer: token.payload.iss }),
        ];
      }
      if (token.isExpired()) {
        return [null, "Token has expired", 400, ""];
      }
      if (token.payload.P2PKlock) {
        const witness = witnessData?.[inputs.indexOf(input)];
        if (!witness) {
          return [null, "Witness for input not found", 400, ""];
        }
        const isValid = verifySignature(
          hexToBytes(token.header.token_hash),
          hexToBytes(witness),
          token.payload.P2PKlock,
        );
        if (!isValid) {
          return [null, "Witness signature is not valid", 400, ""];
        }
      }
      if (token.payload.timeLock && token.payload.timeLock > Date.now()) {
        return [null, "The TimeLock has not passed", 400, ""];
      }
      if (token.payload.HTLC) {
        const htlc =
          typeof token.payload.HTLC === "string"
            ? JSON.parse(token.payload.HTLC)
            : token.payload.HTLC;
        const payload = {
          ...token.payload,
          HTLC: htlc,
          tokenID: token.payload.tokenID,
        };
        const validation = await TokenValidator.validateTokenHTLC(
          { ...token, payload },
          providedHTLCSecret,
        );
        if (!validation.valid) {
          return [null, validation.error ?? null, 400, ""];
        }
        if (providedHTLCSecret) {
          if (!validation.canRedeem) {
            return [
              null,
              "HTLC cannot be redeemed with provided secret",
              400,
              "",
            ];
          }
        } else {
          if (!validation.canRefund) {
            return [
              null,
              "HTLC secret required to redeem before expiry",
              400,
              "",
            ];
          }
        }
      }
    }
    return [tx, null, null, undefined];
  }
}
