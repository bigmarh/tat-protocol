import { ForgeConfig } from "./ForgeConfig.js";
import { ForgeState } from "./ForgeState.js";
import { Token } from "@tat-protocol/token";
import { TokenValidator } from "@tat-protocol/token";
import {
  NWPCServer,
  NWPCRequest,
  NWPCContext,
  NWPCResponseObject,
  NWPCResponse,
  NWPC_SPEC_ERRORS,
} from "@tat-protocol/nwpc";
import {
  signMessage,
  verifySignature,
  spendAuthDigest,
  postToFeed,
  DebugLogger,
  KIND_TOKEN_SPENT,
  LEGACY_KIND_TOKEN_SPENT,
  TAG_TOKEN_HASH,
} from "@tat-protocol/utils";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import {
  StorageInterface,
  SpentSetStore,
  DEFAULT_KEYSET_ID,
} from "@tat-protocol/storage";
import { NDKEvent, type NostrEvent as NostrEventRaw } from "@nostr-dev-kit/ndk";

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

  // Serializes the spent-set critical section (transfer/burn). The spent-check,
  // output signing, spent-mark, and persist steps are separated by awaits, so
  // without this two concurrent transfers of the same input could both pass the
  // check before either marks it spent — a double-spend.
  private spendLock: Promise<unknown> = Promise.resolve();

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
    // Minting is privileged: only the forge owner or an explicitly authorized
    // forger may create new tokens. `transfer`/`burn` stay open because they are
    // gated per-input by P2PK-witness / issuer checks in validateTXInputs.
    this.use(
      "forge",
      this.onlyAuthorized.bind(this),
      this.forgeToken.bind(this),
    );
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
    return res.error(
      NWPC_SPEC_ERRORS.UNAUTHORIZED.code,
      NWPC_SPEC_ERRORS.UNAUTHORIZED.message,
    );
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
    return res.error(
      NWPC_SPEC_ERRORS.UNAUTHORIZED.code,
      NWPC_SPEC_ERRORS.UNAUTHORIZED.message,
    );
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
    try {
      // Resolve keys, set the state key, and load persisted state (spent-set
      // and replay bloom) BEFORE super.init() connects and subscribes.
      // Relays replay up to the subscription's `since` window on connect; if we
      // subscribed first, those replayed transfers would be validated against
      // an empty spent-set and re-minted (double-spend on restart).
      if (!this.isInitialized) {
        // If signer is provided, get public key from it
        if (this.signer) {
          const signerPubkey = await this.signer.getPublicKey();
          this.keys = { secretKey: "", publicKey: signerPubkey };
          this.stateKey = `forge-state-${signerPubkey}`;
        } else {
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
        }
        await this._loadState();
        this.isInitialized = true;
      }

      // Connect + subscribe only now that spent-set and replay state are loaded.
      await super.init();
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
    if (await this.isTokenSpent(tokenHash)) {
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
    // Await the write: the spent-set must be durable before the transfer
    // response releases newly signed tokens, otherwise a crash after the
    // response leaves the spent input replayable on restart.
    await this.saveState(this.stateKey, this.state);
  }

  /**
   * Runs a spent-set-mutating operation (transfer/burn) under a per-forge lock
   * so that check-then-mark sequences cannot interleave across concurrent
   * requests. Callbacks are chained regardless of prior success/failure, and a
   * failing callback never poisons the lock for the next caller.
   */
  /**
   * Move any spent hashes sitting in blob state into the configured store.
   *
   * A forge that has been running accumulated its spent set in the state blob.
   * Pointing it at a store without carrying those across would present every
   * previously spent token as unspent — every one of them replayable, which is
   * a mint of free money rather than a migration inconvenience. So this runs on
   * every load, is idempotent (`tryMarkSpent` on a hash already present is a
   * no-op returning false), and clears the blob copy only once the store has
   * accepted the hashes.
   *
   * No-op when no store is configured, which is what keeps existing forges on
   * exactly their current behaviour.
   */
  protected async importBlobSpentSet(): Promise<void> {
    const store = this.spentSet;
    if (!store) return;
    const pending = Array.from(this.state.spentTokens ?? []);
    if (pending.length === 0) return;

    let imported = 0;
    for (const tokenHash of pending) {
      // Skip anything malformed rather than aborting the whole import: one bad
      // entry must not strand every other spent hash outside the store.
      try {
        if (await store.tryMarkSpent(this.spentKeysetId, tokenHash)) imported++;
      } catch (err) {
        Debug.error(
          `importBlobSpentSet: skipping unusable spent hash ${tokenHash}: ${err}`,
          "ForgeBase",
        );
      }
    }

    // Only now drop the blob copy — if the process dies mid-import the blob is
    // still authoritative and the next start redoes it.
    this.state.spentTokens = new Set();
    await this._saveState();
    Debug.log(
      `importBlobSpentSet: moved ${imported} spent hash(es) out of blob state into the spent-set store`,
      "ForgeBase",
    );
  }

  /** The spent set, when one is configured. See ForgeConfig.spentSetStore. */
  protected get spentSet(): SpentSetStore | undefined {
    return this.config.spentSetStore;
  }

  protected get spentKeysetId(): string {
    return this.config.spentKeysetId ?? DEFAULT_KEYSET_ID;
  }

  /**
   * Has this token hash already been spent?
   *
   * Every read of the spent set goes through here so there is exactly one place
   * that knows whether the store or the legacy blob is authoritative.
   */
  protected async isTokenSpent(tokenHash: string): Promise<boolean> {
    if (this.spentSet) {
      return await this.spentSet.isSpent(this.spentKeysetId, tokenHash);
    }
    return this.state.spentTokens.has(tokenHash);
  }

  /**
   * Batch form of {@link isTokenSpent}, for the verify RPC.
   */
  protected async getTokenSpentStates(
    tokenHashes: string[],
  ): Promise<Record<string, boolean>> {
    if (this.spentSet) {
      return await this.spentSet.getStates(this.spentKeysetId, tokenHashes);
    }
    const out: Record<string, boolean> = {};
    for (const hash of tokenHashes) {
      out[hash] = this.state.spentTokens.has(hash);
    }
    return out;
  }

  /**
   * Record a token hash as spent.
   *
   * @returns `true` if this call marked it, `false` if it was already spent.
   *
   * With a store this is a single atomic test-and-insert that is durable before
   * it resolves, and it does NOT touch blob state — which is what removes the
   * O(N^2) write amplification, since the blob write was the quadratic term
   * rather than the Set insert.
   *
   * Without a store this keeps the original behaviour exactly: add to the
   * in-memory Set and re-serialise the whole state blob.
   */
  protected async markTokenSpent(tokenHash: string): Promise<boolean> {
    if (this.spentSet) {
      return await this.spentSet.tryMarkSpent(this.spentKeysetId, tokenHash);
    }
    if (this.state.spentTokens.has(tokenHash)) return false;
    this.state.spentTokens.add(tokenHash);
    // Await the write: the spent-set must be durable before the transfer
    // response releases newly signed tokens, otherwise a crash after the
    // response leaves the spent input replayable on restart.
    await this._saveState();
    return true;
  }

  protected async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.spendLock.then(fn, fn);
    // Advance the lock even if fn rejects, swallowing the settled value so the
    // chain itself never becomes a rejected promise (which would reject the
    // next caller). The real result/rejection is still returned to this caller.
    this.spendLock = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
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
      await this.importBlobSpentSet();
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
    // Mark spent first so subsequent validation sees it immediately, and so the
    // record is durable before the caller's response releases newly signed
    // tokens. With a store this is one atomic O(1) write and touches no blob.
    const newlyMarked = await this.markTokenSpent(tokenHash);
    if (!newlyMarked) {
      // Callers check isTokenSpent under runExclusive before getting here, so a
      // false means the store's uniqueness constraint caught an interleaving
      // the in-process lock did not — which is exactly what it is for, and
      // worth surfacing rather than swallowing. The notice is still published:
      // it is idempotent, and a holder reconciling is better off seeing it.
      Debug.warn(
        `publishSpentToken: ${tokenHash} was already spent — the store rejected a duplicate mark`,
        "ForgeBase",
      );
    }

    // Fire-and-forget relay publication — don't block the transfer response.
    // Pockets subscribe to these "spent:<hash>" notices to reconcile spent
    // tokens across devices, so every forge flavor must publish them.
    const forgePubkey = this.getPublicKey();
    if (!forgePubkey) {
      Debug.error("publishSpentToken skipped: no forge pubkey", "ForgeBase");
      return;
    }

    // The hash rides in the multi-letter `token` tag, never in `t`. `t` is the
    // NIP-01 hashtag tag: relays index it globally, so publishing token hashes
    // there wrote every spend into the public hashtag index of every relay the
    // note reached — a transaction-graph leak, and tag abuse that relays
    // rate-limit or ban for. Nothing consumes the old `t` tag (pockets filter
    // on kind + author and read the hash from content), so it is simply gone.
    const tags: string[][] = [
      ["p", forgePubkey],
      [TAG_TOKEN_HASH, tokenHash],
    ];
    const content = `spent:${tokenHash}`;

    const kinds: number[] = [KIND_TOKEN_SPENT];
    // Transition: also emit the legacy kind-1 note so pockets on an older SDK,
    // which subscribe only to kind 1, keep reconciling. Set
    // `publishLegacySpentNotes: false` once holders have updated.
    if (this.config.publishLegacySpentNotes !== false) {
      kinds.push(LEGACY_KIND_TOKEN_SPENT);
    }

    const publishOne = (kind: number) => {
      if (this.signer) {
        // Signer-based forge: keys.secretKey is intentionally empty, so sign
        // the note through the signer instead of skipping publication.
        this.signer
          .signEvent({
            kind,
            content,
            tags,
            created_at: Math.floor(Date.now() / 1000),
          })
          .then(async (signed) => {
            const ev = new NDKEvent(this.ndk, signed as NostrEventRaw);
            await ev.publish();
          })
          .catch((err) =>
            Debug.error("publishSpentToken relay error: " + err, "ForgeBase"),
          );
      } else if (this.keys.publicKey && this.keys.secretKey) {
        postToFeed(this.ndk, content, this.keys, tags, kind).catch((err) =>
          Debug.error("publishSpentToken relay error: " + err, "ForgeBase"),
        );
      } else {
        Debug.error(
          "publishSpentToken skipped: no signer or secret key available",
          "ForgeBase",
        );
      }
    };

    for (const kind of kinds) {
      publishOne(kind);
    }
  }

  public async handleBurn(
    req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ) {
    // Share the spent-set lock with transfers: a burn and a transfer of the
    // same token must not both mark it spent from an unspent starting state.
    return await this.runExclusive(async () => {
      let parsed: { token?: string };
      try {
        parsed = JSON.parse(req.params);
      } catch (error) {
        return await res.error(
          NWPC_SPEC_ERRORS.PARSE_ERROR.code,
          NWPC_SPEC_ERRORS.PARSE_ERROR.message,
        );
      }
      const { token } = parsed;
      if (!token) {
        return await res.error(
          NWPC_SPEC_ERRORS.TOKEN_REQUIRED.code,
          NWPC_SPEC_ERRORS.TOKEN_REQUIRED.message,
        );
      }
      try {
        const restoredToken = await new Token().restore(token);

        // Verify token integrity before accepting burn
        if (!(await restoredToken.verifyTokenHash())) {
          return await res.error(
            NWPC_SPEC_ERRORS.TOKEN_INVALID.code,
            "Token hash does not match payload",
          );
        }
        if (!(await restoredToken.verifyTokenSignature())) {
          return await res.error(
            NWPC_SPEC_ERRORS.TOKEN_INVALID.code,
            "Invalid token signature",
          );
        }

        const tokenHash = restoredToken.header.token_hash;
        if (await this.isTokenSpent(tokenHash)) {
          return await res.error(
            NWPC_SPEC_ERRORS.TOKEN_SPENT.code,
            NWPC_SPEC_ERRORS.TOKEN_SPENT.message,
          );
        }
        await this.publishSpentToken(tokenHash);
        return await res.send({ success: true }, context.sender);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Unknown error occurred";
        return await res.error(NWPC_SPEC_ERRORS.INTERNAL_ERROR.code, message);
      }
    });
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
      return await res.error(
        NWPC_SPEC_ERRORS.PARSE_ERROR.code,
        NWPC_SPEC_ERRORS.PARSE_ERROR.message,
      );
    }
    const tokenHashes = parsed.token_hashes;
    if (!Array.isArray(tokenHashes) || tokenHashes.length === 0) {
      return await res.error(
        NWPC_SPEC_ERRORS.INVALID_PARAMS.code,
        "token_hashes is required",
      );
    }
    for (const hash of tokenHashes) {
      if (typeof hash !== "string") {
        return await res.error(
          NWPC_SPEC_ERRORS.INVALID_PARAMS.code,
          "token_hashes must be strings",
        );
      }
    }
    // One batch read rather than a lookup per hash: a store may answer the
    // whole set in a single round trip, and this endpoint is asked about many
    // hashes at a time.
    const spent = await this.getTokenSpentStates(tokenHashes);
    const valid: Record<string, boolean> = {};
    for (const hash of tokenHashes) {
      valid[hash] = !spent[hash];
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
      return [
        null,
        "Transaction inputs are required",
        NWPC_SPEC_ERRORS.INVALID_PARAMS.code,
        "",
      ];
    }
    // Reject transactions that list the same input token more than once.
    // Without this, `validateFungibleTransfer` sums each duplicate as
    // additional value and the spent-set (idempotent Set.add) never notices,
    // so a single request could mint value out of thin air.
    const seenInputHashes = new Set<string>();
    for (const input of inputs) {
      const token = await new Token().restore(input);
      const dedupHash = await token.create_token_hash();
      if (seenInputHashes.has(dedupHash)) {
        return [
          null,
          "Duplicate input token in transaction",
          NWPC_SPEC_ERRORS.INVALID_PARAMS.code,
          "",
        ];
      }
      seenInputHashes.add(dedupHash);

      // Verify token integrity before accepting as input
      if (!(await token.verifyTokenHash())) {
        return [
          null,
          "Token hash does not match payload",
          NWPC_SPEC_ERRORS.TOKEN_INVALID.code,
          "",
        ];
      }
      if (!(await token.verifyTokenSignature())) {
        return [
          null,
          "Invalid token signature",
          NWPC_SPEC_ERRORS.TOKEN_INVALID.code,
          "",
        ];
      }

      // Enforce single-issuer transfer inputs. A forge must only accept
      // tokens it originally issued.
      if (token.payload.iss !== this.keys.publicKey) {
        return [
          null,
          "Input token issuer mismatch",
          NWPC_SPEC_ERRORS.UNAUTHORIZED.code,
          "",
        ];
      }

      const tokenHash = token.header.token_hash;
      if (await this.isTokenSpent(tokenHash)) {
        return [
          null,
          "Token is already spent",
          NWPC_SPEC_ERRORS.TOKEN_SPENT.code,
          JSON.stringify({ spent: tokenHash, issuer: token.payload.iss }),
        ];
      }
      if (token.isExpired()) {
        return [
          null,
          "Token has expired",
          NWPC_SPEC_ERRORS.TOKEN_EXPIRED.code,
          "",
        ];
      }
      if (token.payload.P2PKlock) {
        const witness = witnessData?.[inputs.indexOf(input)];
        if (!witness) {
          return [
            null,
            "Witness for input not found",
            NWPC_SPEC_ERRORS.INVALID_PARAMS.code,
            "",
          ];
        }
        // The witness must be signed over a digest bound to THIS transfer's
        // outputs, not the bare (public, static) token hash. Otherwise a witness
        // seen on the wire could be replayed to redirect the same input to a
        // different recipient. See spendAuthDigest / audit finding C6.
        const witnessBytes = hexToBytes(witness);
        const witnessMessage = spendAuthDigest(
          token.header.token_hash,
          tx.outs ?? [],
        );
        let isValid = verifySignature(
          witnessMessage,
          witnessBytes,
          token.payload.P2PKlock,
        );
        // Transition (C6): unless disabled, also accept the legacy witness
        // signed over the bare token hash so wallets on an older SDK keep
        // working. Flip `allowLegacyWitness: false` once all wallets are updated
        // to fully close the replay vector.
        if (!isValid && this.config.allowLegacyWitness !== false) {
          const legacyValid = verifySignature(
            hexToBytes(token.header.token_hash),
            witnessBytes,
            token.payload.P2PKlock,
          );
          if (legacyValid) {
            Debug.log(
              "Accepted a LEGACY (unbound) P2PK witness — a wallet still needs updating for C6",
              "ForgeBase",
            );
            isValid = true;
          }
        }
        if (!isValid) {
          return [
            null,
            "Witness signature is not valid",
            NWPC_SPEC_ERRORS.UNAUTHORIZED.code,
            "",
          ];
        }
      }
      // `timeLock` is a Unix timestamp in SECONDS (spec §3.3); compare against
      // seconds, not Date.now() milliseconds. Spendable once now >= timeLock,
      // so reject while now < timeLock.
      if (
        token.payload.timeLock &&
        Math.floor(Date.now() / 1000) < token.payload.timeLock
      ) {
        return [
          null,
          "The TimeLock has not passed",
          NWPC_SPEC_ERRORS.INVALID_REQUEST.code,
          "",
        ];
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
          return [
            null,
            validation.error ?? null,
            NWPC_SPEC_ERRORS.INVALID_REQUEST.code,
            "",
          ];
        }
        if (providedHTLCSecret) {
          if (!validation.canRedeem) {
            return [
              null,
              "HTLC cannot be redeemed with provided secret",
              NWPC_SPEC_ERRORS.INVALID_REQUEST.code,
              "",
            ];
          }
        } else {
          if (!validation.canRefund) {
            return [
              null,
              "HTLC secret required to redeem before expiry",
              NWPC_SPEC_ERRORS.INVALID_REQUEST.code,
              "",
            ];
          }
        }
      }
    }
    return [tx, null, null, undefined];
  }
}
