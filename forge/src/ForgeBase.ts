import { ForgeConfig } from "./ForgeConfig";
import { ForgeState } from "./ForgeState";
import { Token } from "@tat-protocol/token";
import { TokenValidator } from "@tat-protocol/token";
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

export abstract class ForgeBase extends NWPCServer {
  public keys!: KeyPair;
  public config: ForgeConfig;
  public state!: ForgeState;
  public storage: StorageInterface;
  public owner: string;
  public isInitialized: boolean = false;
  public stateKey!: string;

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
      processedEventIds: new Set(),
      relays: new Set(),
    };
    if (config.keys) this.keys = config.keys;
    this.storage = new Storage(config?.storage);
    this.setupDefaultHandlers();

  }

  abstract forgeToken(req: NWPCRequest, context: NWPCContext, res: NWPCResponseObject): Promise<any>;
  abstract transferToken(req: NWPCRequest, context: NWPCContext, res: NWPCResponseObject): Promise<any>;
  abstract burnToken(req: NWPCRequest, context: NWPCContext, res: NWPCResponseObject): Promise<any>;

  setupDefaultHandlers() {
    this.use("forge", this.forgeToken.bind(this));
    this.use("transfer", this.transferToken.bind(this));
    this.use("burn", this.burnToken.bind(this));
  }


  public onlyAuthorized(
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


  public async initialize(): Promise<void> {
    await super.init();
    if (this.isInitialized) return;
    try {
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
      console.error("Failed to initialize Forge:", error);
      throw error;
    }
  }

  public getPublicKey(): string | undefined {
    return this.keys.publicKey;
  }

  public async sign(data: Uint8Array): Promise<Uint8Array> {
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

  public async addAuthorizedForger(pubkey: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error("Forge must be initialized");
    }
    this.state.authorizedForgers.add(pubkey);
    await this._saveState();
  }

  public async removeAuthorizedForger(pubkey: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error("Forge must be initialized");
    }
    this.state.authorizedForgers.delete(pubkey);
    await this._saveState();
  }

  public getAuthorizedForgers(): string[] {
    return Array.from(this.state.authorizedForgers ?? []);
  }

  public async _saveState(): Promise<void> {
    this.saveState(this.stateKey, this.state);
  }

  public async _loadState(): Promise<void> {
    const savedState = await this.loadState(this.stateKey);
    if (savedState !== null) {
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

  public async publishSpentToken(tokenHash: string) {
    if (this.keys.publicKey && this.keys.secretKey) {
      await postToFeed(this.ndk, `spent:${tokenHash}`, this.keys, [
        ["t", tokenHash],
        ["p", this.keys.publicKey!]
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

  public async signAndCreateJWT(token: Token): Promise<string> {
    const dataToSign = await token.data_to_sign();
    const signature = await token.sign(dataToSign, this.keys);
    return await token.toJWT(bytesToHex(signature));
  }

  public async validateTXInputs(
    tx: any,
    witnessData?: string[],
    providedHTLCSecret?: string,
  ): Promise<[any, string | null, number | null, string | undefined]> {
    const inputs = tx.ins;
    for (const input of inputs) {
      const token = await new Token().restore(input);
      const tokenHash = await token.create_token_hash();
      if (this.state.spentTokens.has(tokenHash)) {
        return [null, "Token is already spent", 409, JSON.stringify({spent: tokenHash,issuer: token.payload.iss})];
      }
      if (token.isExpired()) {
        return [null, "Token has expired", 400,""];
      }
      if (token.payload.P2PKlock) {
        const witness = witnessData?.[inputs.indexOf(input)];
        if (!witness) {
          return [null, "Witness for input not found", 400,""];
        }
        const isValid = verifySignature(
          hexToBytes(token.header.token_hash),
          hexToBytes(witness),
          token.payload.P2PKlock,
        );
        if (!isValid) {
          return [null, "Witness signature is not valid", 400,""];
        }
      }
      if (token.payload.timeLock && token.payload.timeLock > Date.now()) {
        return [null, "The TimeLock has not passed", 400,""];
      }
      if (token.payload.HTLC) {
        const htlc =
          typeof token.payload.HTLC === "string"
            ? JSON.parse(token.payload.HTLC)
            : token.payload.HTLC;
        const payload = {
          ...token.payload,
          HTLC: htlc,
          tokenID: token.payload.tokenID
        };
        const validation = await TokenValidator.validateTokenHTLC(
          { ...token, payload },
          providedHTLCSecret,
        );
        if (!validation.valid) {
          return [null, validation.error ?? null, 400,""];
        }
        if (!validation.canRedeem && !validation.canRefund) {
          return [null, "Token is locked and cannot be used", 400,""];
        }
      }
    }
    return [tx, null, null, undefined];
  }
}   