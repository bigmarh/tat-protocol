import { NWPCHandler, NWPCConfig, NWPCPeer, NWPCState, NWPCContext, NWPCMessageData } from "@tat-protocol/nwpc";
import { Token } from "@tat-protocol/token";
import { DebugLogger, Unwrap, UnwrapWithSigner } from "@tat-protocol/utils";
import { StorageInterface, BrowserStore, NodeStore } from "@tat-protocol/storage";
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { KeyPair } from '@tat-protocol/hdkeys';
import { Transaction } from "./Transaction";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { SingleUseKey } from "@tat-protocol/hdkeys";
import { NDKEvent } from "@nostr-dev-kit/ndk";
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
    secretKey: string;
    publicKey: string;
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
    singleUseKeys: Map<string, SingleUseKey>; //[pubkey, singleUseKey], Hold the singleUseKey for each pubkey
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
    protected stateKey: string = '';
    private subscribedIssuers: Set<string> = new Set();

    // =============================
    // 1. Initialization & State Management
    // =============================
    private constructor(config: PocketConfig) {
        super(config);
        this.config = config || {};
        this.isInitialized = false;
        this.keys = config?.keys || { secretKey: '', publicKey: '' };
        if (config?.storage) {
            this.storage = config.storage;
        } else if (config?.storageType === 'browser') {
            if (!config.allowInsecureStorage) {
                throw new Error('Browser storage requires allowInsecureStorage to persist sensitive state.');
            }
            this.storage = new BrowserStore();
        } else {
            this.storage = new NodeStore();
        }

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
        await super.init();
        this.state = { ...this.state } as PocketState;
        // Use publicKey which was set from either signer, loaded key, or generated key
        this.stateKey = `pocket-state-${this.publicKey || this.keys.publicKey}`;
        await this.loadPocketState();
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
        await this.saveState(this.stateKey, this.state);
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
                    tokens: new Map(),
                    tokenIndex: new Map(),
                    tatIndex: new Map(),
                    balances: new Map(),
                };
                const seed = await HDKey.mnemonicToSeed(this.state.hdMasterKey.mnemonic);
                this.hdKey = HDKey.fromMasterSeed(seed);
                this.savePocketState();
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
    private async deriveSingleUseKey(path?: string): Promise<SingleUseKeyPair> {
        path = `m/7'/23'/11'/16'/0/${this.state.singleUseKeys.size}`;
        const hdKey: HDKey = this.hdKey.derive(path);
        const keyPair: KeyPair = {
            secretKey: hdKey.privateKey,
            publicKey: hdKey.publicKey
        };
        if (keyPair.publicKey && keyPair.publicKey.length === 66) {
            const uncompressedKey = getPublicKey(hexToBytes(keyPair.secretKey));
            keyPair.publicKey = uncompressedKey;
        }
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

                //unsubscribe from the single-use key after use
                await this.unsubscribe(keyPair.publicKey);
                this.state.singleUseKeys.delete(keyPair.publicKey);
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
        if (!this.state.singleUseKeys.has(pubkey)) {
            this.state.singleUseKeys.set(pubkey, key);
            Debug.log(`Key with pubkey ${pubkey} added`, 'Pocket');
        } else {
            Debug.log(`Key with pubkey ${pubkey} already used`, 'Pocket');
        }
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
        const issuer = token.payload.iss;
        // Subscribe to spent events for this issuer if not already
        await this.subscribeToIssuerSpent(issuer);
        const tokenHash = token.header.token_hash;
        const issuerTokens = this.state.tokens.get(issuer);
        if (issuerTokens && issuerTokens.has(tokenHash)) {
            Debug.log(`Duplicate token received (hash: ${tokenHash}), ignoring.`, 'Pocket');
            return;
        }
        const tokenID = String(token.payload.tokenID);
        if (tokenID !== "undefined") {
            const tatIndex = this.state.tatIndex.get(issuer);
            if (tatIndex) {
                if (tatIndex.get(tokenID) !== tokenHash) {
                    tatIndex.set(tokenID, tokenHash);
                }
            } else {
                this.state.tatIndex.set(issuer, new Map([[tokenID, tokenHash]]));
            }
        }
        else {
            const denomination = Number(token.payload.amount);
            const setID = (token.payload.ext?.setID as string) || "-";
            const tokenIndex = this.state.tokenIndex.get(issuer);
            if (tokenIndex) {
                let tokenHashes = tokenIndex.get(denomination);
                if (tokenHashes) {
                    if (!tokenHashes.includes(String(tokenHash))) {
                        tokenHashes.push(String(tokenHash));
                        tokenIndex.set(denomination, tokenHashes);
                        this.updateBalance(issuer, setID, Number(token.payload.amount));
                    }
                } else {
                    tokenIndex.set(denomination, [String(tokenHash)]);
                    this.updateBalance(issuer, setID, Number(token.payload.amount));
                }
            } else {
                this.state.tokenIndex.set(issuer, new Map([[denomination, [String(tokenHash)]]]));
                this.updateBalance(issuer, setID, Number(token.payload.amount));
            }
        }
        if (issuerTokens) {
            issuerTokens.set(tokenHash, tokenJWT);
        } else {
            this.state.tokens.set(issuer, new Map([[tokenHash, tokenJWT]]));
        }
        return this.savePocketState();
    }

    private async updateBalance(issuer: string, setID: string, amount: number) {
        if (this.state.balances.has(issuer)) {
            const issuerBalances = this.state.balances.get(issuer);
            if (issuerBalances?.has(setID)) {
                const currentAmount = issuerBalances?.get(setID) || 0;
                issuerBalances?.set(setID, currentAmount + amount);
            } else {
                issuerBalances?.set(setID, amount);
            }
            await this.savePocketState();
        } else {
            this.state.balances.set(issuer, new Map([[setID, amount]]));
            await this.savePocketState();
        }
    }

    // =============================
    // 4. Event Handling & Subscriptions
    // =============================
    public async subscribe(
        pubkey: string,
        handler?: (event: NDKEvent) => Promise<void>
    ): Promise<any> {
        if (!pubkey) {
            pubkey = this.keys.publicKey;
        }
        const existing = this.getSubscription(pubkey);
        if (existing) {
            await this.unsubscribe(pubkey);
        }
        if (handler) {
            return super.subscribe(pubkey, handler);
        }
        else {
            return super.subscribe(pubkey, this.handleEvent.bind(this));
        }
    }

    protected async handleEvent(event: NDKEvent): Promise<void> {
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
            if (singleUseKey) {
                // Single-use keys always have secret key, create a KeySigner for them
                keys = singleUseKey;
            } else {
                keys = await this.deriveSingleUseKey(toKey);
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

            const eventId = event.id;
            if (this.isEventProcessed(eventId)) {
                Debug.log("duplicate event detected" + eventId, 'Pocket');
                return;
            }
            this.markEventProcessed(eventId);

            //
            if (message.result?.token) {
                Debug.log("received token" + message.result.token, 'Pocket');
                await this.storeToken(message.result.token);
            }
            //delete the token from the state if it is spent
            else if (message.result?.spent) {
                Debug.log("received spent token" + message.result, 'Pocket');
                //delete the token from the state
                const tokenHash = message.result.spent;
                const tokenJWT = this.state.tokens.get(message.result.issuer)?.get(tokenHash);

                if (tokenJWT) {
                    await this.deleteToken(tokenJWT);
                }

                await this.savePocketState();
            }
            else {

                if (this.responseHandlers.has(message.id)) {
                    if (this.hooks.beforeResponse) {
                        const shouldContinue = await this.hooks.beforeResponse(
                            message,
                            context,
                        );
                        if (!shouldContinue) return;
                    }

                    Debug.log(
                        "Found response handler for message ID:" + message.id,
                        'Pocket',
                    );
                    const handler = this.responseHandlers.get(message.id);
                    if (handler) {
                        clearTimeout(handler.timeoutId);
                        this.responseHandlers.delete(message.id);
                        handler.resolve(message);
                        Debug.log("handleEvent message" + message, 'Pocket');
                        if (message.error?.code == 409) {
                            Debug.log("handleEvent error" + message.error, 'Pocket');
                            //delete the token from the state
                            const tokenHash = message.result.spent;
                            const tokenJWT = this.state.tokens.get(message.result.issuer)?.get(tokenHash);
                            if (tokenJWT) {
                                await this.deleteToken(tokenJWT);
                            }
                        }
                        if (this.hooks.afterResponse) {
                            await this.hooks.afterResponse(message, context);
                        }
                    }
                }
                Debug.log("handleEvent messageID" + message.id, 'Pocket');
                Debug.log("handleEvent secondary message" + message, 'Pocket');
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

    // =============================
    // 6. Transaction Functions
    // =============================

    /**
     * Helper to build witness data for P2PK tokens
     */
    private async buildWitnessData(inputs: Token[]): Promise<string[]> {
        const witnessData: string[] = [];
        for (const token of inputs) {
            if (token.payload.P2PKlock) {
                let keyPair: KeyPair | undefined;
                // Use main key if matches, else look up in singleUseKeys
                if (token.payload.P2PKlock === this.keys.publicKey) {
                    keyPair = this.keys;
                } else {
                    const singleUseKey = this.state.singleUseKeys.get(token.payload.P2PKlock);
                    if (singleUseKey) {
                        keyPair = singleUseKey;
                    }
                }
                if (!keyPair) {
                    // Cannot sign, push empty string or throw error as needed
                    witnessData.push("");
                    continue;
                }
                const dataToSign = hexToBytes(token.header.token_hash);
                // Use the instance sign method
                const signature = await token.sign(dataToSign, keyPair);
                witnessData.push(bytesToHex(signature));
            } else {
                witnessData.push("");
            }
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
    private async createFungibleTransferTx(issuer: string, to: string, amount: number, changeKey?: string) {
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
    public async sendTx(method: string, issuer: string, tx: TransactionData) {
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
        return this.request(method, tx, issuer);
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

        // 2. Subscribe for the response
        let response: unknown = null;
        let responseReceived = false;
        const handler = async (event: NDKEvent) => {
            if (event.pubkey === forgePubkey) {
                try {
                    // Unwrap/decrypt/verify as needed
                    const unwrapped = await Unwrap(event.content, senderKeys, forgePubkey);
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
        await this.request(method, tx as Record<string, unknown>, forgePubkey, senderKeys);

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
        const denomination = Number(token.payload.amount);
        const setID = (token.payload.ext?.setID as string) || "-";
        const tokenHash = token.header.token_hash;

        // Remove from tokenIndex
        const tokenIndex = this.state.tokenIndex.get(issuer);
        if (tokenIndex) {
            tokenIndex.delete(denomination);
            // update the balance
            const balance = this.state.balances.get(issuer)?.get(setID);
            if (balance) {
                this.state.balances.get(issuer)?.set(setID, balance - denomination);
            }
        }

        // Remove from tatIndex
        const tatIndex = this.state.tatIndex.get(issuer);
        if (tatIndex) {
            tatIndex.delete(String(token.payload.tokenID));
        }

        // Remove from tokens
        const issuerTokens = this.state.tokens.get(issuer);
        if (issuerTokens) {
            issuerTokens.delete(tokenHash);
        }

        // Save state after deletion
        await this.savePocketState();
    }

    // Subscribe to spent events for a given issuer
    private async subscribeToIssuerSpent(issuerPubkey: string) {
        if (this.subscribedIssuers.has(issuerPubkey)) return;
        this.subscribedIssuers.add(issuerPubkey);
        // Subscribe to spent events (kind 1059, tag ["p", issuerPubkey])
        await this.subscribe(
            issuerPubkey,
            this.handleIssuerSpentEvent.bind(this)
        );
    }

    // Handle spent events from issuer
    private async handleIssuerSpentEvent(event: NDKEvent) {
        try {
            let message: NWPCMessageData;
            try {
                message = JSON.parse(event.content);
            } catch (e) {
                // Not JSON, ignore or handle as needed
                Debug.warn("handleIssuerSpentEvent received non-JSON content, ignoring:" + event.content, 'Pocket');
                return;
            }
            const result = message.result as { spent?: string; issuer?: string } | undefined;
            if (result?.spent && result?.issuer) {
                const tokenHash = result.spent;
                const issuer = result.issuer;
                const tokenJWT = this.state.tokens.get(issuer)?.get(tokenHash);
                if (tokenJWT) {
                    await this.deleteToken(tokenJWT);
                }
                await this.savePocketState();
                Debug.log(`Token spent event processed for issuer ${issuer}, tokenHash ${tokenHash}`, 'Pocket');
            }
        } catch (error) {
            Debug.error("handleIssuerSpentEvent error" + error, 'Pocket');
        }
    }
}
