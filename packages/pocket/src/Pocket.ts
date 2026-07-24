import {
  NWPCHandler,
  NWPCConfig,
  NWPCPeer,
  NWPCState,
  NWPCContext,
  NWPCMessageData,
  NWPC_SPEC_ERRORS,
} from "@tat-protocol/nwpc";
import { Token } from "@tat-protocol/token";
import { DebugLogger, Unwrap, UnwrapWithSigner } from "@tat-protocol/utils";
import { StorageInterface, BrowserStore, NodeStore } from "@tat-protocol/storage";
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { KeyPair } from '@tat-protocol/hdkeys';
import { Transaction } from "./Transaction.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { NDKEvent, NDKSubscription } from "@nostr-dev-kit/ndk";
import { HDKey } from "@tat-protocol/hdkeys";
import { validateMnemonic } from '@scure/bip39';
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english';
import type { Signer } from "@tat-protocol/types";
// import { KeySigner } from "@tat-protocol/signers";

export type token_hash = string;
export type issuerId = string;

/**
 * Interface for a single-use keypair
 */
export interface SingleUseKeyPair {
    secretKey?: string;
    publicKey: string;
    index?: number;
    path?: string;
    createdAt: number;
    relatedTxIds?: string[];
    used?: boolean;
}

/**
 * Configuration for Pocket instances.
 *
 * Supports two key management approaches:
 * 1. `signer` - A Signer interface for abstracted key management (recommended for browser)
 * 2. `keys` - Direct KeyPair for backwards compatibility and server-side use
 *
 * If both are provided, `signer` takes precedence.
 * If neither is provided, new keys will be generated automatically.
 */
export interface PocketConfig extends NWPCConfig {
    ndk?: unknown;
    relays?: string[];
    storage?: StorageInterface;
    storageType?: 'node' | 'browser';
    /** Signer interface for abstracted key management (recommended) */
    signer?: Signer;
    /** Direct key pair for backwards compatibility */
    keys?: KeyPair;
    keyID?: string;
    requestHandlers?: Map<string, NWPCHandler>;
    /** Allow storing sensitive state in browser storage without encryption */
    allowInsecureStorage?: boolean;
}

export interface PocketState extends NWPCState {
    favorites: string[];
    hdMasterKey: HDKeys;
    singleUseKeys: Map<string, SingleUseKeyPair>; //[pubkey, singleUseKey], Hold the singleUseKey for each pubkey
    /** HD derivation counter — always >= singleUseKeys.size. Persisted to avoid index collisions after key deletion. */
    singleUseKeyNextIndex: number;
    tokens: Map<string, Map<string, string>>; //[issuerPubkey, tokenHash, tokenJWT], Hold the tokenJWT for each tokenHash
    balances: Map<string, Map<string, number>>;         //[issuerPubkey,setID, balance]. Hold the balance for each issuer
    tokenIndex: Map<string, Map<number, string[]>>; //[issuerPubkey, identifier(denomination), [tokenhash]], Hold the tokenhash for each denomination
    tatIndex: Map<string, Map<string, string>>; //[issuerPubkey, identifier(tokenID, tokenID:derivative-tokenId), tokenhash], Hold the tokenhash for each tokenID
    connected: boolean;
    activeSubscriptions: Map<string, unknown>;
}

export interface HDKeys {
    mnemonic: string;
}

const Debug = DebugLogger.getInstance();
const SINGLE_USE_KEY_DERIVATION_BASE_PATH = "m/7'/23'/11'/16'/0";

/**
 * Transaction data structure
 */
interface TransactionData {
  ins?: (string | { token: string })[];
  outs?: unknown[];
  witnessData?: string[];
  [key: string]: unknown;
}

export class Pocket extends NWPCPeer {
    declare protected state: PocketState;
    protected isInitialized!: boolean;
    private hdKey!: HDKey;
    /** Optional callback fired whenever a token is stored or deleted. */
    public onTokenChange?: () => void;
    protected stateKey: string = '';
    private subscribedIssuers: Set<string> = new Set();
    private spentFeedSubscriptions: Map<string, NDKSubscription> = new Map();

    // =============================
    // 1. Initialization & State Management
    // =============================
    private constructor(config: PocketConfig) {
        // Resolve storage before super() so NWPCBase always receives a concrete
        // StorageInterface. storageType:'browser' is a convenience shorthand that
        // must be materialised here — the constructor body runs too late.
        const storage = config?.storage
            ?? (config?.storageType === 'browser'
                ? (() => {
                    if (!config.allowInsecureStorage) {
                        throw new Error('Browser storage requires allowInsecureStorage to persist sensitive state.');
                    }
                    return new BrowserStore();
                })()
                : new NodeStore());
        super({ ...config, storage });
        this.config = config || {};
        this.isInitialized = false;
        this.keys = config?.keys || { secretKey: '', publicKey: '' };
        this.storage = storage;

        this.handleEvent = this.handleEvent.bind(this);
    }

    /**
     * Async initialization for Pocket instance. Loads idKey if needed and initializes the NWPC client.
     */
    public async init(): Promise<void> {
        // Handle key initialization based on what was provided
        if (this.config?.signer) {
            // Signer provided - get public key from signer
            // Keys will be empty but we use signer for all operations
            const signerPubkey = await this.config.signer.getPublicKey();
            this.keys = { secretKey: '', publicKey: signerPubkey };
        } else if (this.config?.keyID) {
            await this.loadIdKey(this.config.keyID);
        } else if (this.config?.keys && this.config.keys.secretKey && this.config.keys.publicKey) {
            this.keys = this.config.keys;
        } else {
            // Generate new keypair
            const secretKey = bytesToHex(generateSecretKey());
            const publicKey = getPublicKey(hexToBytes(secretKey));
            this.keys = { secretKey, publicKey };
            this.saveIdKey();
        }

        // Resolve publicKey now (same logic as NWPCBase.init) so we can build
        // stateKey and load persisted tokens BEFORE subscribing to relays.
        // This prevents EOSE handlers from saving empty state over loaded tokens.
        if (this.config?.signer) {
            this.publicKey = await this.config.signer.getPublicKey();
        } else if (this.keys?.publicKey) {
            this.publicKey = this.keys.publicKey;
        }

        // Load persisted state BEFORE connecting / subscribing.
        this.stateKey = `pocket-state-${this.publicKey}`;
        await this.loadPocketState();

        // NOW connect and subscribe — state is fully restored, so any EOSE or
        // replayed events will serialize against the correct (loaded) state.
        await super.init();
        this.isInitialized = true;
    }

    /**
     * Creates and initializes a new Pocket instance.
     *
     * This is the primary factory method for creating a Pocket. It handles async initialization
     * including loading or generating keys, setting up storage, and establishing connections.
     *
     * @param config - Configuration object containing keys, storage, relays, and other settings
     * @returns A fully initialized Pocket instance ready to manage tokens
     * @throws {Error} If storage is not provided in config
     *
     * @example
     * ```typescript
     * const pocket = await Pocket.create({
     *   keys: myKeyPair,
     *   storage: new NodeStorage(),
     *   relays: ['wss://relay.example.com']
     * });
     * ```
     *
     * @see PocketConfig for configuration options
     */
    static async create(config: PocketConfig): Promise<Pocket> {
        const pocket = new Pocket(config);
        await pocket.init();
        return pocket;
    }

    private async saveIdKey(): Promise<void> {
        if (!this.keys) {
            throw new Error('No idKey to save');
        }
        await this.storage.setItem(`pocket-idkey-${this.keys.publicKey}`, JSON.stringify(this.keys));
    }

    private async loadIdKey(pubkey: string): Promise<void> {
        const idKeyStr = await this.storage.getItem(`pocket-idkey-${pubkey}`);
        if (idKeyStr) {
            this.keys = JSON.parse(idKeyStr);
        } else {
            throw new Error('No idKey to load');
        }
    }

    private async savePocketState(): Promise<void> {
        if (!this.stateKey) return; // Guard: don't save before stateKey is resolved
        await this.queueSaveState(this.stateKey, this.state);
    }

    async loadPocketState(): Promise<void> {
        try {
            const state = await this.loadState(this.stateKey);
            if (state === null) {
                const mnemonic = HDKey.generateMnemonic(128);
                Debug.log("loadPocketState: generated new mnemonic", 'Pocket');
                this.state = {
                    ...this.state,
                    favorites: [],
                    hdMasterKey: {
                        mnemonic
                    },
                    singleUseKeys: new Map(),
                    singleUseKeyNextIndex: 0,
                    tokens: new Map(),
                    tokenIndex: new Map(),
                    tatIndex: new Map(),
                    balances: new Map(),
                };
                const seed = await HDKey.mnemonicToSeed(this.state.hdMasterKey.mnemonic);
                this.hdKey = HDKey.fromMasterSeed(seed);
                await this.savePocketState();
                return; // No saved state exists
            }
            this.state = {
                ...this.state,
                ...state
            };
            if (!validateMnemonic(this.state.hdMasterKey.mnemonic, englishWordlist)) {
                throw new Error("Invalid mnemonic in pocket state");
            }
            const seed = await HDKey.mnemonicToSeed(this.state.hdMasterKey.mnemonic);
            this.hdKey = HDKey.fromMasterSeed(seed);
            // Backward compat: ensure derivation counter is always monotonic and safe.
            const highestKnownIndex = this.getHighestKnownSingleUseKeyIndex();
            const minNextIndex = Math.max(this.state.singleUseKeys.size, highestKnownIndex + 1, 0);
            if (typeof this.state.singleUseKeyNextIndex !== 'number') {
                this.state.singleUseKeyNextIndex = minNextIndex;
            } else {
                this.state.singleUseKeyNextIndex = Math.max(this.state.singleUseKeyNextIndex, minNextIndex);
            }
            await this.rebuildIndexesAndBalances();

            // Subscribe to all single-use key pubkeys after loading state
            for (const pubkey of this.state.singleUseKeys.keys()) {
                await this.subscribe(pubkey);
            }

            for (const issuer of this.state.tokens.keys()) {
                await this.subscribeToIssuerSpent(issuer);
            }
        } catch (error) {
            throw new Error(`Failed to load pocket state: ${error}`);
        }
    }

    // =============================
    // 2. Key Management
    // =============================
    private buildSingleUseKeyPath(index: number): string {
        return `${SINGLE_USE_KEY_DERIVATION_BASE_PATH}/${index}`;
    }

    private parseIndexFromPath(path?: string): number | undefined {
        if (!path) return undefined;
        const m = path.match(/\/(\d+)$/);
        if (!m) return undefined;
        const parsed = Number(m[1]);
        return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
    }

    private deriveSingleUseKeyAtIndex(index: number): KeyPair & { index: number; path: string } {
        const path = this.buildSingleUseKeyPath(index);
        const hdKey: HDKey = this.hdKey.derive(path);
        if (!hdKey.privateKey) {
            throw new Error(`Could not derive private key at index ${index}`);
        }
        const keyPair: KeyPair & { index: number; path: string } = {
            secretKey: hdKey.privateKey,
            publicKey: hdKey.publicKey,
            index,
            path,
        };
        if (keyPair.publicKey && keyPair.publicKey.length === 66) {
            const uncompressedKey = getPublicKey(hexToBytes(keyPair.secretKey));
            keyPair.publicKey = uncompressedKey;
        }
        return keyPair;
    }

    private getHighestKnownSingleUseKeyIndex(): number {
        let highest = -1;
        for (const key of this.state.singleUseKeys.values()) {
            if (typeof key.index === 'number' && key.index >= 0) {
                highest = Math.max(highest, key.index);
                continue;
            }
            const parsed = this.parseIndexFromPath(key.path);
            if (typeof parsed === 'number') {
                highest = Math.max(highest, parsed);
            }
        }
        return highest;
    }

    private async findOrRecoverSingleUseKeyByPubkey(pubkey: string): Promise<SingleUseKeyPair | null> {
        const existing = this.state.singleUseKeys.get(pubkey);
        if (existing?.secretKey) {
            let changed = false;
            if (typeof existing.index !== 'number') {
                const parsed = this.parseIndexFromPath(existing.path);
                if (typeof parsed === 'number') {
                    existing.index = parsed;
                    changed = true;
                }
            }
            if (typeof existing.index === 'number' && !existing.path) {
                existing.path = this.buildSingleUseKeyPath(existing.index);
                changed = true;
            }
            if (changed) {
                this.state.singleUseKeys.set(pubkey, existing);
                await this.savePocketState();
            }
            return existing;
        }

        if (existing && typeof existing.index === 'number') {
            const derived = this.deriveSingleUseKeyAtIndex(existing.index);
            if (derived.publicKey === pubkey) {
                const recovered: SingleUseKeyPair = {
                    ...existing,
                    publicKey: derived.publicKey,
                    secretKey: derived.secretKey,
                    index: derived.index,
                    path: derived.path,
                    createdAt: existing.createdAt || Date.now(),
                };
                this.state.singleUseKeys.set(pubkey, recovered);
                await this.savePocketState();
                return recovered;
            }
        }

        const maxIndexExclusive = Math.max(this.state.singleUseKeyNextIndex ?? 0, this.state.singleUseKeys.size);
        for (let idx = 0; idx < maxIndexExclusive; idx++) {
            const derived = this.deriveSingleUseKeyAtIndex(idx);
            if (derived.publicKey !== pubkey) continue;
            const recovered: SingleUseKeyPair = {
                publicKey: derived.publicKey,
                secretKey: derived.secretKey,
                index: derived.index,
                path: derived.path,
                createdAt: existing?.createdAt || Date.now(),
                used: existing?.used,
                relatedTxIds: existing?.relatedTxIds,
            };
            this.state.singleUseKeys.set(pubkey, recovered);
            await this.savePocketState();
            return recovered;
        }
        return null;
    }

    private async deriveSingleUseKey(): Promise<SingleUseKeyPair> {
        const index = this.state.singleUseKeyNextIndex++;
        const keyPair = this.deriveSingleUseKeyAtIndex(index);
        const singleUseKey: SingleUseKeyPair = {
            ...keyPair,
            createdAt: Date.now(),
            used: false,
        };

        Debug.log("deriveSingleUseKey subscribe:" + keyPair.publicKey, 'Pocket');
        const handler = async (event: NDKEvent) => {
            try {
                Debug.log("sendRequestWithSingleUseKey response", 'Pocket');
                await this.handleEvent(event);

                // Stop listening for new events to this key (token received, job done).
                // Do NOT delete the key from singleUseKeys here — the private key is still
                // needed to sign witness data when the received token is spent later.
                await this.unsubscribe(keyPair.publicKey);
                Debug.log("unsubscribe from single-use key" + keyPair.publicKey, 'Pocket');
            } catch (e) {
                // Ignore invalid responses
                Debug.log("sendRequestWithSingleUseKey error" + e, 'Pocket');
            }

        };
        Debug.log("subscribe to single-use key" + keyPair.publicKey, 'Pocket');
        // Subscribe to the single-use key immediately
        await this.subscribe(keyPair.publicKey, handler);
        await this.addSingleUseKey(singleUseKey.publicKey, singleUseKey);
        return singleUseKey;
    }

    addSingleUseKey = async (pubkey: string, key: SingleUseKeyPair) => {
        if (typeof key.index === 'number' && !key.path) {
            key.path = this.buildSingleUseKeyPath(key.index);
        } else if (typeof key.index !== 'number') {
            const parsed = this.parseIndexFromPath(key.path);
            if (typeof parsed === 'number') {
                key.index = parsed;
                key.path = key.path || this.buildSingleUseKeyPath(parsed);
            }
        }
        if (!this.state.singleUseKeys.has(pubkey)) {
            this.state.singleUseKeys.set(pubkey, key);
            Debug.log(`Key with pubkey ${pubkey} added`, 'Pocket');
        } else {
            Debug.log(`Key with pubkey ${pubkey} already used`, 'Pocket');
        }
        const minNextIndex = Math.max(this.state.singleUseKeys.size, this.getHighestKnownSingleUseKeyIndex() + 1);
        this.state.singleUseKeyNextIndex = Math.max(this.state.singleUseKeyNextIndex ?? 0, minNextIndex);
        await this.savePocketState();
    };

    removeSingleUseKey = async (pubkey: string) => {
        if (this.state.singleUseKeys.has(pubkey)) {
            this.state.singleUseKeys.delete(pubkey);
            Debug.log(`Key with pubkey ${pubkey} removed`, 'Pocket');
        } else {
            Debug.log(`Key with pubkey ${pubkey} does not exist`, 'Pocket');
        }
        await this.savePocketState();
    };

    // =============================
    // 3. Token Management
    // =============================
    private async storeToken(tokenJWT: string) {
        const token = await new Token().restore(tokenJWT);
        // Verify integrity before trusting or indexing this token. A malicious
        // sender can deliver a token whose header hash mismatches its payload,
        // whose signature is forged, or whose amount is inflated; storing it
        // unverified poisons balances and lets an attacker-chosen hash key
        // shadow a real token. The forge re-checks on spend, but the wallet
        // must not display or act on unverified value.
        if (!(await token.verifyTokenHash())) {
            Debug.log('Rejecting received token: hash does not match payload', 'Pocket');
            return;
        }
        if (!(await token.verifyTokenSignature())) {
            Debug.log('Rejecting received token: invalid issuer signature', 'Pocket');
            return;
        }
        const issuer = token.payload.iss;
        // Subscribe to spent events for this issuer if not already
        await this.subscribeToIssuerSpent(issuer);
        // Key by the verified (recomputed) hash, never the claimed header value.
        const tokenHash = token.header.token_hash;
        const issuerTokens = this.state.tokens.get(issuer);
        if (issuerTokens && issuerTokens.has(tokenHash)) {
            Debug.log(`Duplicate token received (hash: ${tokenHash}), ignoring.`, 'Pocket');
            return;
        }
        if (issuerTokens) {
            issuerTokens.set(tokenHash, tokenJWT);
        } else {
            this.state.tokens.set(issuer, new Map([[tokenHash, tokenJWT]]));
        }
        await this.reindexIssuerState(issuer);
        await this.savePocketState();
        this.onTokenChange?.();
    }

    /**
     * Rebuild all issuer-specific derived state (indexes + balances) from source-of-truth tokens.
     * This prevents drift when events arrive out of order or when state is recovered from disk.
     */
    private async rebuildIndexesAndBalances() {
        const issuers = new Set<string>([
            ...this.state.tokens.keys(),
            ...this.state.tokenIndex.keys(),
            ...this.state.tatIndex.keys(),
            ...this.state.balances.keys(),
        ]);

        for (const issuer of issuers) {
            await this.reindexIssuerState(issuer);
        }
    }

    /**
     * Rebuild a single issuer's tokenIndex/tatIndex/balances from state.tokens[issuer].
     * state.tokens is treated as the only source of truth.
     */
    private async reindexIssuerState(issuer: string) {
        const issuerTokens = this.state.tokens.get(issuer);
        if (!issuerTokens || issuerTokens.size === 0) {
            this.state.tokens.delete(issuer);
            this.state.tokenIndex.delete(issuer);
            this.state.tatIndex.delete(issuer);
            this.state.balances.delete(issuer);
            return;
        }

        const canonicalTokens = new Map<string, string>();
        const tokenIndex = new Map<number, string[]>();
        const tatIndex = new Map<string, string>();
        const balances = new Map<string, number>();

        for (const tokenJWT of issuerTokens.values()) {
            try {
                const token = await new Token().restore(String(tokenJWT));
                if (token.payload.iss !== issuer) {
                    continue;
                }

                const tokenHash = token.header.token_hash;
                canonicalTokens.set(tokenHash, tokenJWT);

                const tokenID = token.payload.tokenID;
                if (tokenID !== undefined && tokenID !== null) {
                    tatIndex.set(String(tokenID), tokenHash);
                    continue;
                }

                const amount = Number(token.payload.amount);
                if (!Number.isFinite(amount) || amount <= 0) {
                    continue;
                }
                const denomination = amount;
                const setID = (token.payload.ext?.setID as string) || "-";
                const hashes = tokenIndex.get(denomination) || [];
                hashes.push(tokenHash);
                tokenIndex.set(denomination, hashes);
                balances.set(setID, (balances.get(setID) || 0) + amount);
            } catch {
                // Skip malformed/unrestorable tokens during reconciliation.
            }
        }

        if (canonicalTokens.size > 0) {
            this.state.tokens.set(issuer, canonicalTokens);
        } else {
            this.state.tokens.delete(issuer);
        }

        if (tokenIndex.size > 0) {
            this.state.tokenIndex.set(issuer, tokenIndex);
        } else {
            this.state.tokenIndex.delete(issuer);
        }

        if (tatIndex.size > 0) {
            this.state.tatIndex.set(issuer, tatIndex);
        } else {
            this.state.tatIndex.delete(issuer);
        }

        if (balances.size > 0) {
            this.state.balances.set(issuer, balances);
        } else {
            this.state.balances.delete(issuer);
        }
    }

    // =============================
    // 4. Event Handling & Subscriptions
    // =============================
    public async subscribe(
        pubkey: string,
        handler?: (event: NDKEvent) => Promise<void>,
        since?: number,
    ): Promise<any> {
        if (!pubkey) {
            pubkey = this.keys.publicKey;
        }
        const existing = this.getSubscription(pubkey);
        if (existing) {
            await this.unsubscribe(pubkey);
        }
        if (handler) {
            return super.subscribe(pubkey, handler, since);
        }
        else {
            return super.subscribe(pubkey, this.handleEvent.bind(this), since);
        }
    }

    protected async handleEvent(event: NDKEvent): Promise<void> {
        // Dedup check before the expensive decrypt/unwrap.
        if (this.isEventProcessed(event.id)) {
            Debug.log("duplicate event detected (early)" + event.id, 'Pocket');
            return;
        }

        const toKey = event.tags.find(tag => tag[0] === 'p')?.[1];
        let keys: KeyPair = { secretKey: '', publicKey: '' };
        let signerToUse: Signer | undefined = undefined;
        Debug.log("toKey" + event.tags, 'Pocket');

        // Determine which key/signer to use for unwrapping
        const mainPubkey = this.publicKey || this.keys.publicKey;
        if (toKey === mainPubkey) {
            // Use main signer if available, otherwise use main keys
            if (this.signer) {
                signerToUse = this.signer;
            } else {
                keys = this.keys;
            }
        }
        else if (toKey) {
            const singleUseKey = this.state.singleUseKeys.get(toKey);
            if (singleUseKey?.secretKey) {
                keys = { secretKey: singleUseKey.secretKey, publicKey: singleUseKey.publicKey };
            } else {
                const recovered = await this.findOrRecoverSingleUseKeyByPubkey(toKey);
                if (recovered?.secretKey) {
                    keys = { secretKey: recovered.secretKey, publicKey: recovered.publicKey };
                } else {
                    Debug.log(`Missing single-use key for pubkey ${toKey}`, 'Pocket');
                    return;
                }
            }
        }
        try {
            // Use signer-based unwrap if signer is available, otherwise fall back to keys
            let unwrapped;
            if (signerToUse) {
                unwrapped = await UnwrapWithSigner(event.content, signerToUse, event.pubkey);
            } else {
                unwrapped = await Unwrap(event.content, keys, event.pubkey);
            }
            if (!unwrapped) {
                Debug.log("Failed to unwrap event:" + event.id, 'Pocket');
                return;
            }

            if (!unwrapped.verifiedSender) {
                Debug.log("Original Event is not valid:" + event.id, 'Pocket');
                return;
            }

            const message = JSON.parse(unwrapped.content);

            const context: NWPCContext = {
                event,
                poster: event.pubkey,
                sender: unwrapped.sender,
                recipient: mainPubkey as string,
            };

            this.markEventProcessed(event.id);

            // Handle embedded token — store it but don't skip response resolution.
            // A response can contain a token AND be the reply to a pending request().
            if (message.result?.token) {
                Debug.log("received token" + message.result.token, 'Pocket');
                await this.storeToken(message.result.token);
            }

            // Handle embedded changeToken (repay response)
            if (message.result?.changeToken) {
                Debug.log("received changeToken" + message.result.changeToken, 'Pocket');
                await this.storeToken(message.result.changeToken);
            }

            // Delete spent token from state
            if (message.result?.spent) {
                Debug.log("received spent token" + message.result, 'Pocket');
                const tokenHash = message.result.spent;
                const tokenJWT = this.state.tokens.get(message.result.issuer)?.get(tokenHash);
                if (tokenJWT) {
                    await this.deleteToken(tokenJWT);
                }
                await this.savePocketState();
            }

            // Always resolve a pending request() — even when a token was embedded.
            // Previously this was in an `else` branch, so token responses never resolved
            // the caller, causing 15s timeouts whenever the server sent token + metadata.
            if (this.responseHandlers.has(message.id)) {
                if (this.hooks.beforeResponse) {
                    const shouldContinue = await this.hooks.beforeResponse(message, context);
                    if (!shouldContinue) return;
                }

                Debug.log("Found response handler for message ID:" + message.id, 'Pocket');
                const handler = this.responseHandlers.get(message.id);
                if (handler) {
                    clearTimeout(handler.timeoutId);
                    this.responseHandlers.delete(message.id);
                    handler.resolve(message);
                    Debug.log("handleEvent message" + message, 'Pocket');
                    if (message.error?.code == NWPC_SPEC_ERRORS.TOKEN_SPENT.code) {
                        Debug.log("handleEvent error" + message.error, 'Pocket');
                        let spentMeta: { spent?: string; issuer?: string } | undefined;
                        const params = message.error?.params;
                        if (typeof params === "string" && params.trim()) {
                            try {
                                spentMeta = JSON.parse(params) as { spent?: string; issuer?: string };
                            } catch {
                                // Ignore malformed params and fall back to legacy fields.
                            }
                        }
                        if (!spentMeta) {
                            const result = message.result as { spent?: string; issuer?: string } | undefined;
                            spentMeta = result;
                        }
                        const tokenHash = spentMeta?.spent;
                        const issuer = spentMeta?.issuer;
                        const tokenJWT = tokenHash && issuer
                            ? this.state.tokens.get(issuer)?.get(tokenHash)
                            : undefined;
                        if (tokenJWT) {
                            await this.deleteToken(tokenJWT);
                        }
                    }
                    if (this.hooks.afterResponse) {
                        await this.hooks.afterResponse(message, context);
                    }
                }
            } else {
                Debug.log("handleEvent secondary message (no handler)" + message.id, 'Pocket');
            }
        }
        catch (error) {
            Debug.error("handleEvent error" + error, 'Pocket');
        }
        await this.savePocketState();
    }

    // =============================
    // 5. Utility/Public Methods
    // =============================
    /**
     * Retrieves the complete internal state of the pocket.
     *
     * The state includes all tokens, balances, keys, favorites, and indices. This method
     * is useful for debugging, state inspection, or implementing custom serialization.
     * Note that the state contains sensitive information including private keys.
     *
     * @returns The complete pocket state object
     *
     * @example
     * ```typescript
     * const state = pocket.getState();
     * console.log('Total issuers:', state.tokens.size);
     * console.log('Single-use keys:', state.singleUseKeys.size);
     * ```
     *
     * @see PocketState for the complete state structure
     */
    public getState(): PocketState {
        return this.state;
    }

    // ── Recovery APIs ──────────────────────────────────────────────────────────

    /**
     * Returns a snapshot of all data needed to reconstruct this wallet from scratch.
     * Contains sensitive key material — encrypt before storing.
     */
    public exportRecoverySnapshot(): {
        mnemonic: string;
        tokens: Array<{ issuer: string; jwt: string }>;
        singleUseKeys: Array<{
            publicKey: string;
            secretKey?: string;
            index?: number;
            path?: string;
            createdAt: number;
            used?: boolean;
        }>;
        singleUseKeyNextIndex: number;
        favorites: string[];
    } {
        const tokens: Array<{ issuer: string; jwt: string }> = [];
        for (const [issuer, issuerTokens] of this.state.tokens) {
            for (const [, jwt] of issuerTokens) {
                tokens.push({ issuer, jwt });
            }
        }

        const singleUseKeys: Array<{
            publicKey: string;
            secretKey?: string;
            index?: number;
            path?: string;
            createdAt: number;
            used?: boolean;
        }> = [];
        for (const [, key] of this.state.singleUseKeys) {
            singleUseKeys.push({
                publicKey: key.publicKey,
                secretKey: key.secretKey,
                index: key.index,
                path: key.path,
                createdAt: key.createdAt,
                used: key.used,
            });
        }

        return {
            mnemonic: this.state.hdMasterKey?.mnemonic ?? '',
            tokens,
            singleUseKeys,
            singleUseKeyNextIndex: this.state.singleUseKeyNextIndex ?? singleUseKeys.length,
            favorites: this.state.favorites ?? [],
        };
    }

    /**
     * Import an array of token JWTs into the wallet (e.g. from a backup restore).
     * Skips duplicates silently. Returns counts for each outcome.
     */
    public async importTokens(
        tokens: Array<{ issuer: string; jwt: string }>
    ): Promise<{ imported: number; failed: number; duplicates: number }> {
        let imported = 0, failed = 0, duplicates = 0;
        for (const { jwt } of tokens) {
            try {
                const tokenObj = await new Token().restore(jwt);
                const issuer = tokenObj.payload.iss;
                const tokenHash = tokenObj.header.token_hash;
                const existing = this.state.tokens.get(issuer);
                if (existing?.has(tokenHash)) {
                    duplicates++;
                    continue;
                }
                await this.storeToken(jwt);
                imported++;
            } catch {
                failed++;
            }
        }
        return { imported, failed, duplicates };
    }

    /**
     * Restore key material from a backup snapshot. Must be called BEFORE importTokens().
     * Restores the HD mnemonic, single-use keys, and favorites.
     */
    public async restoreKeyMaterial(snapshot: {
        mnemonic: string;
        singleUseKeys?: Array<{
            publicKey: string;
            secretKey?: string;
            index?: number;
            path?: string;
            createdAt: number;
            used?: boolean;
        }>;
        singleUseKeyNextIndex?: number;
        favorites?: string[];
    }): Promise<void> {
        // Restore mnemonic + re-derive master HD key
        this.state.hdMasterKey = { mnemonic: snapshot.mnemonic };
        const seed = await HDKey.mnemonicToSeed(snapshot.mnemonic);
        this.hdKey = HDKey.fromMasterSeed(seed);

        // Restore single-use keys
        let highestKnownIndex = this.getHighestKnownSingleUseKeyIndex();
        if (snapshot.singleUseKeys?.length) {
            for (const key of snapshot.singleUseKeys) {
                const index = typeof key.index === 'number' && key.index >= 0
                    ? key.index
                    : this.parseIndexFromPath(key.path);
                const path = typeof index === 'number'
                    ? (key.path || this.buildSingleUseKeyPath(index))
                    : key.path;
                const normalizedKey: SingleUseKeyPair = {
                    ...key,
                    index,
                    path,
                };
                if (typeof index === 'number') {
                    highestKnownIndex = Math.max(highestKnownIndex, index);
                }
                if (!this.state.singleUseKeys.has(key.publicKey)) {
                    this.state.singleUseKeys.set(key.publicKey, normalizedKey);
                    // Subscribe so incoming tokens addressed to this key are received
                    await this.subscribe(key.publicKey);
                } else {
                    const existing = this.state.singleUseKeys.get(key.publicKey)!;
                    this.state.singleUseKeys.set(key.publicKey, {
                        ...existing,
                        ...normalizedKey,
                    });
                }
            }
        }

        // Restore HD derivation counter — must be >= actual key count to avoid collisions
        const minNextIndex = Math.max(this.state.singleUseKeys.size, highestKnownIndex + 1);
        this.state.singleUseKeyNextIndex = Math.max(
            snapshot.singleUseKeyNextIndex ?? 0,
            minNextIndex
        );

        // Restore favorites
        if (snapshot.favorites?.length) {
            this.state.favorites = snapshot.favorites;
        }

        await this.savePocketState();
    }

    /**
     * Retrieves a specific token by its hash.
     *
     * Each token has a unique hash derived from its payload. This method returns the
     * raw JWT string of the token, which can be used for transfers or verification.
     *
     * @param issuer - The public key of the token issuer (forge)
     * @param tokenHash - The unique hash identifier of the token
     * @returns The token as a JWT string, or undefined if not found
     *
     * @example
     * ```typescript
     * // Retrieve a specific token
     * const tokenJWT = pocket.getToken('issuerPubkey', 'token-hash-abc123');
     * if (tokenJWT) {
     *   const token = await new Token().restore(tokenJWT);
     *   console.log('Token amount:', token.payload.amount);
     * }
     * ```
     */
    public getToken(issuer: string, tokenHash: string) {
        return this.state.tokens.get(issuer)?.get(tokenHash);
    }

    public getTokenIndex(issuer: string, denomination: number) {
        return this.state.tokenIndex.get(issuer)?.get(denomination);
    }

    /**
     * Retrieves the hash of a Transferable Access Token (TAT) by its tokenID.
     *
     * TATs are indexed by their unique tokenID for easy lookup. This method returns
     * the token hash, which can then be used with getToken() to retrieve the full token.
     *
     * @param issuer - The public key of the token issuer (forge)
     * @param tokenID - The unique identifier of the TAT
     * @returns The token hash, or undefined if the TAT is not in this pocket
     *
     * @example
     * ```typescript
     * // Check if we own a specific TAT
     * const tokenHash = pocket.getTAT('issuerPubkey', 'ticket-12345');
     * if (tokenHash) {
     *   const tokenJWT = pocket.getToken('issuerPubkey', tokenHash);
     *   console.log('We own this TAT');
     * }
     * ```
     */
    public getTAT(issuer: string, tokenID: string) {
        return this.state.tatIndex.get(issuer)?.get(tokenID);
    }

    /**
     * Retrieves the current balance for a specific issuer and token set.
     *
     * Balances are tracked separately for each issuer and setID. The setID allows
     * issuers to create multiple independent token sets (e.g., different currencies,
     * denominations, or token series). Use "-" as the setID for the default token set.
     *
     * @param issuer - The public key of the token issuer (forge)
     * @param setID - The token set identifier. Use "-" for default set
     * @returns The current balance, or undefined if no tokens exist for this issuer/setID
     *
     * @example
     * ```typescript
     * // Check balance for default set
     * const balance = pocket.getBalance('issuerPubkey', '-');
     * console.log('Balance:', balance);
     *
     * // Check balance for specific token set
     * const premiumBalance = pocket.getBalance('issuerPubkey', 'premium-tokens');
     * ```
     */
    public getBalance(issuer: string, setID: string) {
        setID = setID || "-";
        return this.state.balances.get(issuer)?.get(setID);
    }

    /**
     * Recompute derived indexes/balances from stored tokens.
     * Useful as an explicit repair/sync call before rendering balances.
     */
    public async reconcileBalances(issuer?: string): Promise<void> {
        if (issuer) {
            await this.reindexIssuerState(issuer);
        } else {
            await this.rebuildIndexesAndBalances();
        }
        await this.savePocketState();
    }

    // =============================
    // 6. Transaction Functions
    // =============================

    /**
     * Helper to build witness data for P2PK tokens
     */
    private async buildWitnessData(inputs: Token[]): Promise<string[]> {
        const witnessData: string[] = [];
        const mainPubkey = this.publicKey || this.keys.publicKey;
        const missingLockKeys = new Set<string>();
        for (const token of inputs) {
            if (token.payload.P2PKlock) {
                const dataToSign = hexToBytes(token.header.token_hash);
                const lockKey = token.payload.P2PKlock;

                if (lockKey === mainPubkey) {
                    // Main key — use signer if available (avoids empty secretKey issue)
                    if (this.signer) {
                        const sig = await this.signer.sign(dataToSign);
                        witnessData.push(sig);
                    } else if (this.keys.secretKey) {
                        const sig = await token.sign(dataToSign, this.keys);
                        witnessData.push(bytesToHex(sig));
                    } else {
                        missingLockKeys.add(lockKey);
                        witnessData.push("");
                    }
                } else {
                    // Single-use key: recover deterministically from mnemonic if cache is missing.
                    const singleUseKey = await this.findOrRecoverSingleUseKeyByPubkey(lockKey);
                    if (singleUseKey?.secretKey) {
                        const sig = await token.sign(dataToSign, {
                            publicKey: singleUseKey.publicKey,
                            secretKey: singleUseKey.secretKey,
                        });
                        witnessData.push(bytesToHex(sig));
                    } else {
                        missingLockKeys.add(lockKey);
                        witnessData.push("");
                    }
                }
            } else {
                witnessData.push("");
            }
        }
        if (missingLockKeys.size > 0) {
            throw new Error(`Missing witness key for lock pubkeys: ${Array.from(missingLockKeys).join(",")}`);
        }
        return witnessData;
    }

    /**
     * Create and build a fungible token transfer transaction.
     * @param issuer The issuer of the token
     * @param to Recipient address
     * @param amount Amount to transfer
     * @param changeKey Address to send change to (optional)
     * @returns The built transaction structure
     */
    public async createFungibleTransferTx(issuer: string, to: string, amount: number, changeKey?: string) {
        // Always use a new single-use key for change outputs
        const singleUseKey = await this.deriveSingleUseKey();
        // Save the new key to state (deriveSingleUseKey already does this)
        const tx = new Transaction(
            'transfer',
            this.state,
            [],
            changeKey || singleUseKey.publicKey // Use the new single-use key for change
        );
        tx.to(issuer, to, amount);
        return tx.build();
    }

    /**
     * Create and build a TAT transfer transaction.
     * @param issuer The issuer of the TAT
     * @param to Recipient address
     * @param tokenID The TAT token ID
     * @returns The built transaction structure
     */
    private createTATTransferTx(issuer: string, to: string, tokenID: string) {
        Debug.log("createTATTransferTx" + issuer + to + tokenID, 'Pocket');
        const tx = new Transaction(
            'transferTAT',
            this.state
        );
        return tx.transferTAT(issuer, to, tokenID);
    }


    /**
     * Transfers a Transferable Access Token (TAT) to a recipient.
     *
     * TATs are non-fungible tokens identified by a unique tokenID. Unlike fungible tokens,
     * each TAT is unique and indivisible. This method transfers ownership of the TAT from
     * this pocket to the recipient's public key.
     *
     * @param issuer - The public key of the token issuer (forge)
     * @param to - The recipient's public key
     * @param tokenID - The unique identifier of the TAT to transfer
     * @returns Response from the issuer's forge after processing the transaction
     * @throws {Error} If the TAT doesn't exist, is already spent, or is locked
     *
     * @example
     * ```typescript
     * // Transfer a TAT (e.g., a ticket, membership, or access pass)
     * const response = await pocket.sendTAT(
     *   'issuerPubkey',
     *   'recipientPubkey',
     *   'unique-token-id-123'
     * );
     * ```
     *
     * @see getTAT to verify TAT ownership before transfer
     */
    public async sendTAT(issuer: string, to: string, tokenID: string) {
        const [method, tx] = this.createTATTransferTx(issuer, to, tokenID);
        Debug.log("sendTAT" + tx, 'Pocket');
        return this.sendTx(method, issuer, tx);
    }

    /**
     * Transfers fungible tokens from this pocket to a recipient.
     *
     * This method creates a transaction that combines input tokens to reach the desired amount,
     * sends them to the recipient, and returns any change to a new single-use key. The transaction
     * is signed with the appropriate witness data and sent to the issuer's forge for validation.
     *
     * @param issuer - The public key of the token issuer (forge)
     * @param to - The recipient's public key
     * @param amount - The amount to transfer (must be positive)
     * @param changeKey - Optional public key for change output. If not provided, a new single-use key is generated
     * @returns Response from the issuer's forge after processing the transaction
     * @throws {Error} If insufficient balance or if tokens are locked/spent
     *
     * @example
     * ```typescript
     * // Transfer 100 tokens to a recipient
     * const response = await pocket.transfer(
     *   'issuerPubkey',
     *   'recipientPubkey',
     *   100
     * );
     *
     * // Transfer with specific change address
     * const response = await pocket.transfer(
     *   'issuerPubkey',
     *   'recipientPubkey',
     *   50,
     *   'myChangePubkey'
     * );
     * ```
     *
     * @see getBalance to check available balance before transfer
     */
    public async transfer(issuer: string, to: string, amount: number, changeKey?: string) {
        const [method, tx] = await this.createFungibleTransferTx(issuer, to, amount, changeKey);
        Debug.log("transfer" + tx, 'Pocket');
        return this.sendTx(method, issuer, tx);
    }

    /**
     * Send a transaction to the network.
     * @param method The method to send
     * @param issuer The issuer of the transaction
     * @param tx The transaction to send
     * @returns The response from the network
     */
    public async sendTx(
        method: string,
        issuer: string,
        tx: TransactionData,
        timeoutMs: number = 60000
    ) {
        // Restore tokens from tx.inputs or tx.ins
        const inputs: Token[] = [];
        Debug.log("sendTx" + method + tx, 'Pocket');
        if (tx.ins) {
            for (const input of tx.ins) {
                // Support both { token: jwt } and raw jwt
                const jwt = typeof input === 'string' ? input : input.token;
                const token = await new Token().restore(jwt);
                Debug.log("sendTx token" + token, 'Pocket');
                inputs.push(token);
            }
        }
        // Build witness data if needed
        const witnessData = await this.buildWitnessData(inputs);
        // Attach witnessData to tx if any are present
        if (witnessData.some(w => w)) {
            tx.witnessData = witnessData;
        }

        Debug.log("sendTx finalTx" + tx, 'Pocket');
        return this.request(method, tx, issuer, undefined, timeoutMs);
    }

    /**
     * Generates a new single-use receiving address for enhanced privacy.
     *
     * Each address is derived from the wallet's HD key path and is intended for one-time use.
     * Using unique addresses for each transaction improves privacy by preventing address reuse.
     * The key is automatically saved to the pocket's state and will be monitored for incoming tokens.
     *
     * @returns The public key of the newly generated single-use address
     *
     * @example
     * ```typescript
     * // Generate a new address to receive tokens
     * const receiveAddress = await pocket.getNewReceiveAddress();
     * console.log('Send tokens to:', receiveAddress);
     *
     * // The pocket automatically monitors this address
     * // Tokens sent to it will appear in your balance
     * ```
     *
     * @see transfer to send tokens to a specific address
     */
    public async getNewReceiveAddress(): Promise<string> {
        const singleUseKey = await this.deriveSingleUseKey();
        // The key is already saved to state in deriveSingleUseKey
        return singleUseKey.publicKey;
    }


    /**
     * Send a request to the forge using a new single-use key as the sender,
     * subscribe for the response, and clean up after.
     * @param method - The method to call on the forge
     * @param tx - The transaction or payload to send
     * @param forgePubkey - The forge's public key
     * @param responseTimeoutMs - How long to wait for a response (default 10s)
     * @returns The parsed response from the forge
     */
    public async sendRequestWithSingleUseKey(
        method: string,
        tx: unknown,
        forgePubkey: string,
        responseTimeoutMs: number = 10000
    ): Promise<unknown> {
        // 1. Generate a new single-use key
        const senderKeys = await this.deriveSingleUseKey();
        if (!senderKeys.secretKey) {
            throw new Error("Derived single-use key is missing secretKey");
        }
        const senderKeyPair: KeyPair = {
            publicKey: senderKeys.publicKey,
            secretKey: senderKeys.secretKey,
        };

        // 2. Subscribe for the response
        let response: unknown = null;
        let responseReceived = false;
        const handler = async (event: NDKEvent) => {
            if (event.pubkey === forgePubkey) {
                try {
                    // Unwrap/decrypt/verify as needed
                    const unwrapped = await Unwrap(event.content, senderKeyPair, forgePubkey);
                    if (unwrapped) {
                        response = JSON.parse(unwrapped.content);
                        responseReceived = true;
                    }




                } catch (e) {
                    // Ignore invalid responses
                }
            }
        };
        await this.subscribe(senderKeys.publicKey, handler);

        // 3. Send the request using the single-use key as sender
        await this.request(method, tx as Record<string, unknown>, forgePubkey, senderKeyPair);

        // 4. Wait for response or timeout
        const start = Date.now();
        while (!responseReceived && Date.now() - start < responseTimeoutMs) {
            await new Promise(res => setTimeout(res, 100));
        }

        // 5. Unsubscribe and clean up
        await this.unsubscribe(senderKeys.publicKey);
        // Optionally: await this.markKeyAsUsed(senderKeys.publicKey);

        if (!responseReceived) {
            throw new Error('No response received from forge (timeout)');
        }
        return response;
    }

    async deleteToken(tokenJWT: string) {
        const token = await new Token().restore(String(tokenJWT));
        const issuer = token.payload.iss;
        const tokenHash = token.header.token_hash;

        // Remove from tokens
        const issuerTokens = this.state.tokens.get(issuer);
        if (issuerTokens) {
            issuerTokens.delete(tokenHash);
        }
        await this.reindexIssuerState(issuer);

        // Save state after deletion
        await this.savePocketState();
        this.onTokenChange?.();
    }

    // Subscribe to spent events for a given issuer
    private async subscribeToIssuerSpent(issuerPubkey: string) {
        if (this.subscribedIssuers.has(issuerPubkey)) return;
        this.subscribedIssuers.add(issuerPubkey);
        // Issuers publish spent markers as kind 1 feed notes ("spent:<tokenHash>").
        // Subscribe directly to issuer feed events so pockets can reconcile spent
        // tokens even if they were spent on another device.
        const filter = {
            kinds: [1],
            authors: [issuerPubkey],
            "#p": [issuerPubkey],
            since: Math.floor(Date.now() / 1000) - 10 * 60,
        };
        const subscription = this.ndk.subscribe(filter, { closeOnEose: false });
        subscription.on("event", async (event: NDKEvent) => {
            await this.handleIssuerSpentEvent(event, issuerPubkey);
        });
        this.spentFeedSubscriptions.set(issuerPubkey, subscription);
    }

    // Handle spent events from issuer
    private async handleIssuerSpentEvent(event: NDKEvent, issuerHint?: string) {
        try {
            const content = (event.content || "").trim();
            let spentMeta: { spent?: string; issuer?: string } | undefined;

            if (content.startsWith("spent:")) {
                spentMeta = {
                    spent: content.slice("spent:".length).trim(),
                    issuer: issuerHint || event.pubkey,
                };
            } else {
                try {
                    const parsed = JSON.parse(content) as NWPCMessageData | { spent?: string; issuer?: string };
                    if ((parsed as NWPCMessageData)?.result) {
                        const result = (parsed as NWPCMessageData).result as { spent?: string; issuer?: string } | undefined;
                        spentMeta = result;
                    } else {
                        spentMeta = parsed as { spent?: string; issuer?: string };
                    }
                } catch {
                    const tokenHashFromTag = event.tags.find((tag) => tag[0] === "t")?.[1];
                    if (tokenHashFromTag) {
                        spentMeta = {
                            spent: tokenHashFromTag,
                            issuer: issuerHint || event.pubkey,
                        };
                    } else {
                        Debug.warn("handleIssuerSpentEvent received unknown content, ignoring:" + event.content, 'Pocket');
                        return;
                    }
                }
            }

            const tokenHash = spentMeta?.spent;
            const issuer = spentMeta?.issuer || issuerHint || event.pubkey;
            if (tokenHash && issuer) {
                const tokenJWT = this.state.tokens.get(issuer)?.get(tokenHash);
                if (tokenJWT) {
                    await this.deleteToken(tokenJWT);
                }
                Debug.log(`Token spent event processed for issuer ${issuer}, tokenHash ${tokenHash}`, 'Pocket');
            }
        } catch (error) {
            Debug.error("handleIssuerSpentEvent error" + error, 'Pocket');
        }
    }
}
