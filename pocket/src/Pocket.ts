import { NWPCHandler, NWPCConfig, NWPCPeer, NWPCState } from "@tat-protocol/nwpc";
import { Token } from "@tat-protocol/token";
import { DebugLogger, Unwrap } from "@tat-protocol/utils";
import { StorageInterface, Storage } from "@tat-protocol/storage";
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { KeyPair } from '@tat-protocol/hdkeys';
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { SingleUseKey } from "@tat-protocol/hdkeys";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { HDKey } from "@tat-protocol/hdkeys";

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

export interface PocketConfig extends NWPCConfig {
    ndk?: unknown;
    relays?: string[];
    storage?: StorageInterface;
    storageType?: 'node' | 'browser';
    keys: KeyPair;
    keyID?: string;
    requestHandlers?: Map<string, NWPCHandler>;
}

export interface PocketState extends NWPCState {
    favorites: string[];
    hdMasterKey: HDKeys;
    singleUseKeys: Map<string, SingleUseKey>; //[pubkey, singleUseKey], Hold the singleUseKey for each pubkey
    tokens: Map<string, Map<string | undefined, string>>; //[issuerPubkey, tokenHash, tokenJWT], Hold the tokenJWT for each tokenHash
    balances: Map<string, Map<string, number>>;         //[issuerPubkey,setID, balance]. Hold the balance for each issuer
    tokenIndex: Map<string, Map<number, string[] | undefined>>; //[issuerPubkey, identifier(denomination), [tokenhash]], Hold the tokenhash for each denomination
    tatIndex: Map<string, Map<string, string | undefined>>; //[issuerPubkey, identifier(tokenID, tokenID:derivative-tokenId), tokenhash], Hold the tokenhash for each tokenID
    connected: boolean;
    activeSubscriptions: Map<string, any>;
}

export interface HDKeys {
    mnemonic: string;
}

const Debug = DebugLogger.getInstance();

export class Pocket extends NWPCPeer {
    private idKey!: KeyPair;
    protected state!: PocketState;
    protected isInitialized!: boolean;
    private hdKey!: HDKey;
    protected stateKey!: string;

    // =============================
    // 1. Initialization & State Management
    // =============================
    private constructor(config: PocketConfig) {
        super(config);
        this.config = config || {};
        this.isInitialized = false;
        this.idKey = config?.keys || { secretKey: '', publicKey: '' };
        this.storage = new Storage(config?.storage);
        this.handleEvent = this.handleEvent.bind(this);
    }

    /**
     * Async initialization for Pocket instance. Loads idKey if needed and initializes the NWPC client.
     */
    public async init(): Promise<void> {
        if (this.config?.keyID) {
            await this.loadIdKey(this.config.keyID);
        } else if (this.config?.keys && this.config.keys.secretKey && this.config.keys.publicKey) {
            this.idKey = this.config.keys;
        } else {
            // Generate new keypair
            const secretKey = bytesToHex(generateSecretKey());
            const publicKey = getPublicKey(hexToBytes(secretKey));
            this.idKey = { secretKey, publicKey };
            this.saveIdKey();
        }
        await super.init();
        this.stateKey = `pocket-state-${this.idKey.publicKey}`;
        await this.loadPocketState();
        this.isInitialized = true;
    }

    static async create(config: PocketConfig): Promise<Pocket> {
        const pocket = new Pocket(config);
        await pocket.init();
        return pocket;
    }

    private async saveIdKey(): Promise<void> {
        if (!this.idKey) {
            throw new Error('No idKey to save');
        }
        await this.storage.setItem(`pocket-idkey-${this.idKey.publicKey}`, JSON.stringify(this.idKey));
    }

    private async loadIdKey(pubkey: string): Promise<void> {
        const idKeyStr = await this.storage.getItem(`pocket-idkey-${pubkey}`);
        if (idKeyStr) {
            this.idKey = JSON.parse(idKeyStr);
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
            console.log("Pocket: loadPocketState", this.stateKey, state);
            if (state === null) {
                const mnemonic = HDKey.generateMnemonic();
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
            const seed = await HDKey.mnemonicToSeed(this.state.hdMasterKey.mnemonic);
            this.hdKey = HDKey.fromMasterSeed(seed);
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
        const tokenHash = token.header.token_hash;
        const issuerTokens = this.state.tokens.get(issuer);
        if (issuerTokens && issuerTokens.has(tokenHash)) {
            console.log(`Duplicate token received (hash: ${tokenHash}), ignoring.`);
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
            const setID = token.payload.ext?.setID ? token.payload.ext.setID : "-";
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
            pubkey = this.idKey.publicKey;
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
        console.log("Pocket: toKey", toKey);
        if (toKey === this.idKey.publicKey) {
            keys = this.idKey;
        }
        else if (toKey) {
            const singleUseKey = this.state.singleUseKeys.get(toKey);
            if (singleUseKey) {
                keys = singleUseKey;
            } else {
                keys = await this.deriveSingleUseKey(toKey);
            }
        }
        try {
            const unwrapped = await Unwrap(event.content, keys, event.pubkey);
            if (!unwrapped) {
                console.log("NWPCPeer: Failed to unwrap event:", event.id);
                return;
            }
            const message = JSON.parse(unwrapped.content);
            if (message.result?.token) {
                await this.storeToken(message.result.token);
            }
        }
        catch (error) {
            console.error("Pocket: handleEvent error", error);
        }
        await this.savePocketState();
    }

    // =============================
    // 5. Utility/Public Methods
    // =============================
    public getState(): PocketState {
        return this.state;
    }
}