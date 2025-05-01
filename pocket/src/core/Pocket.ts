import { NWPCBase, NWPCContext, NWPCHandler, NWPCPeer, NWPCRequest, NWPCResponseObject, NWPCConfig } from "../../../nwpc";
import { Token } from "@tat-protocol/token";
import type { Header } from "@tat-protocol/token";
import { DebugLogger, Unwrap } from "@tat-protocol/utils";
import { StorageInterface, Storage } from "@tat-protocol/storage";
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { KeyPair } from '@tat-protocol/hdkeys';
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { SingleUseKey } from "@tat-protocol/hdkeys";
import { defaultConfig } from "@tat-protocol/config/defaultConfig";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { HDKey } from "@tat-protocol/hdkeys";

type pubkey = string;
type tokenString = string;
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
    requestHandlers?: Map<string, NWPCHandler>;
}

export interface PocketState {
    favorites: string[];
    hdMasterKey: HDKeys;
    singleUseKeys: Map<string, SingleUseKey>; //[pubkey, singleUseKey], Hold the singleUseKey for each pubkey
    tokens: Map<string, Map<string | undefined, string>>; //[issuerPubkey, tokenHash, tokenJWT], Hold the tokenJWT for each tokenHash
    balances: Map<string, Map<string, number>>;         //[issuerPubkey,setID, balance]. Hold the balance for each issuer
    tokenIndex: Map<string, Map<number, string[] | undefined>>; //[issuerPubkey, identifier(denomination), [tokenhash]], Hold the tokenhash for each denomination
    tatIndex: Map<string, Map<string, string | undefined>>; //[issuerPubkey, identifier(tokenID, tokenID:derivative-tokenId), tokenhash], Hold the tokenhash for each tokenID
}

export interface HDKeys {
    mnemonic: string;
}

const Debug = DebugLogger.getInstance();

export class Pocket extends NWPCBase {
    private idKey!: KeyPair;
    private Pocket!: PocketState;
    private isInitialized: boolean;
    private hdKey!: HDKey;
    private nwpcClient!: NWPCPeer;

    private constructor(config: PocketConfig) {

        super(config);

        this.config = config || {};
        this.isInitialized = false;
        this.idKey = config?.keys || { secretKey: '', publicKey: '' };


        // Initialize empty state
        this.Pocket = {
            favorites: [],
            hdMasterKey: {
                mnemonic: ''
            },
            singleUseKeys: new Map(),
            tokens: new Map<string, Map<string | undefined, string>>(),  //[issuerPubkey, tokenHash, tokenJWT]
            tokenIndex: new Map<string, Map<number, string[] | undefined>>(),  //[issuerPubkey, identifier(denomination), [tokenhash]]
            tatIndex: new Map<string, Map<string, string>>(),  //[issuerPubkey, identifier(tokenID, tokenID:derivative-tokenId), tokenhash]
            balances: new Map<string, Map<string, number>>() //[issuerPubkey, setID, balance]
        };

        // Initialize storage based on config
        this.storage = new Storage(config?.storage || {});

        // Bind handleEvent to this instance
        this.handleEvent = this.handleEvent.bind(this);
    }

    /**
     * Creates a new Pocket instance
     * @param config - Optional configuration for the Pocket
     * @returns A new Pocket instance
     */

    static async create(config: PocketConfig): Promise<Pocket> {
        const pocket = new Pocket(config);

        if (config.keys) {
            pocket.keys = config.keys;
        }

        // Initialize NWPC client
        await pocket.initialize();
        return pocket;
    }

    public async subscribe(
        pubkey: string,
        handler?: (event: NDKEvent) => Promise<void>
    ): Promise<any> {
        if (!pubkey) {
            pubkey = this.idKey.publicKey;
        }
        return super.subscribe(pubkey, this.handleEvent.bind(this));
    }

    protected async handleEvent(event: NDKEvent): Promise<void> {
        console.log("\n\nPocket: handleEvent", event.tags);
        const toKey = event.tags.find(tag => tag[0] === 'p')?.[1];
        let keys: KeyPair = { secretKey: '', publicKey: '' };
        if (toKey === this.idKey.publicKey) {
            keys = this.idKey;
        }
        else if (toKey) {
            const singleUseKey = this.Pocket.singleUseKeys.get(toKey);
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
                return this.storeToken(message.result.token);
            }
            console.log("\n\nPocket: handleEvent", message);
            console.log("Pocket: handleEvent called directly");
        }
        catch (error) {
            console.error("Pocket: handleEvent error", error);
        }
    }


    //Token Management
    private async storeToken(tokenJWT: string) {
        const token = await new Token().restore(tokenJWT);
        const issuer = token.payload.iss;
        const tokenHash = token.header.token_hash;
        if (token.payload.tokenID) {
            this.Pocket.tatIndex.set(issuer, new Map([[token.payload.tokenID, tokenHash]]));
        }
        else {
            const denomination = Number(token.payload.amount);
            const setID = token.payload.ext?.setID ? token.payload.ext.setID : "-";
            const tokenIndex = this.Pocket.tokenIndex.get(issuer);
            if (tokenIndex) {
                const tokenHashes = tokenIndex.get(denomination);
                if (tokenHashes) {
                    tokenHashes.push(String(tokenHash));
                } else {
                    tokenIndex.set(denomination, [String(tokenHash)]);
                }
            } else {
                this.Pocket.tokenIndex.set(issuer, new Map([[denomination, [String(tokenHash)]]]));
            }
            this.updateBalance(issuer, setID, Number(token.payload.amount));
        }

        this.Pocket.tokens.set(issuer, new Map([[tokenHash, tokenJWT]]));
        this.savePocketState();
    }

    private updateBalance(issuer: string, setID: string, amount: number) {
        if (this.Pocket.balances.has(issuer)) {
            const issuerBalances = this.Pocket.balances.get(issuer);
            if (issuerBalances?.has(setID)) {
                const currentAmount = issuerBalances.get(setID) || 0;
                issuerBalances?.set(setID, currentAmount + amount);
            } else {
                issuerBalances?.set(setID, amount); // Set initial amount if it doesn't exist
            }
        } else {
            // If the issuer doesn't exist, create a new inner Map
            this.Pocket.balances.set(issuer, new Map([[setID, amount]]));
        }
    }

    /**
    * Initializes the Pocket with a private key or generates a new one
    * @param privateKey - Optional private key to use for initialization
    * @throws Error if initialization fails
    */
    async initialize(privateKey?: string): Promise<KeyPair | void> {
        if (this.isInitialized) {
            return;
        }

        try {
            // If idKey is already set, save it
            if (this.idKey.secretKey && this.idKey.publicKey) {
                //TODO: check if the idKey is valid     
                await this.saveIdKey();
            }
            else {
                // Try to load existing idKey first
                try {
                    await this.loadIdKey();
                } catch (error) {
                    // Generate or use provided private key
                    const privKey = privateKey ? privateKey : bytesToHex(generateSecretKey());
                    const pubKey = getPublicKey(hexToBytes(privKey));

                    this.idKey = {
                        secretKey: privKey,
                        publicKey: pubKey
                    };

                    // If no existing idKey, save the new one
                    await this.saveIdKey();
                }
            }

            // Load existing state if available
            await this.loadPocketState();

            // Generate HD master key if not already set
            if (!this.Pocket.hdMasterKey.mnemonic) {
                const mnemonic = HDKey.generateMnemonic();
                const seed = await HDKey.mnemonicToSeed(mnemonic);
                this.hdKey = HDKey.fromMasterSeed(seed);

                this.Pocket.hdMasterKey = {
                    mnemonic: mnemonic,
                };
            }



            const defaultRequestHandlers = {
                'message': [async (req: NWPCRequest, context: NWPCContext, res: NWPCResponseObject) => {
                    console.log("message received");
                    //TODO: handle message, store it for later reading
                    return res.send({ success: true });
                }],
                'requestSignature': [async (req: NWPCRequest, context: NWPCContext, res: NWPCResponseObject) => {
                    console.log("requestSignature received");
                    return res.send({ success: true });
                }]
            };

            // Register Default NWPC handlers
            for (const [key, handler] of Object.entries(defaultRequestHandlers)) {
                this.use(key, ...handler);
            }

            await this.savePocketState();

            this.isInitialized = true;
            return this.idKey;
        }
        catch (error: any) {
            throw new Error(`Failed to initialize Pocket: ${error}`);
        }
    }

    private async saveIdKey(): Promise<void> {
        if (!this.idKey) {
            throw new Error('No idKey to save');
        }
        await this.storage.setItem(`pocket-idkey`, JSON.stringify(this.idKey));
    }

    private async loadIdKey(): Promise<void> {
        const idKeyStr = await this.storage.getItem(`pocket-idkey`);
        if (idKeyStr) {
            this.idKey = JSON.parse(idKeyStr);
        }
        else {
            throw new Error('No idKey to load');
        }
    }

    async loadPocketState(): Promise<void> {
        try {
            const stateStr = await this.storage.getItem(`pocket-state-${this.idKey.publicKey}`);
            if (!stateStr) {
                return; // No saved state exists
            }
            const state = JSON.parse(stateStr);
            this.Pocket = {
                favorites: state.favorites || [],
                hdMasterKey: state.hdMasterKey || { mnemonic: '' },
                singleUseKeys: new Map(Array.isArray(state.singleUseKeys) ? state.singleUseKeys : []),
                tokens: new Map(
                    Array.isArray(state.tokens)
                        ? state.tokens.map(([issuer, tokens]: [string, [string, string][]]) => [
                            issuer,
                            new Map(tokens)
                        ])
                        : []
                ),
                tokenIndex: new Map(
                    Array.isArray(state.tokenIndex)
                        ? state.tokenIndex.map(([issuer, tokens]: [string, [string, string][]]) => [
                            issuer,
                            new Map(tokens)
                        ])
                        : []
                ),
                tatIndex: new Map(
                    Array.isArray(state.tatIndex)
                        ? state.tatIndex.map(([issuer, tokens]: [string, [string, string][]]) => [
                            issuer,
                            new Map(tokens)
                        ])
                        : []
                ),
                balances: new Map(Array.isArray(state.balances) ? state.balances : [])
            };

            const seed = await HDKey.mnemonicToSeed(this.Pocket.hdMasterKey.mnemonic);
            this.hdKey = HDKey.fromMasterSeed(seed);

        } catch (error) {
            throw new Error(`Failed to load pocket state: ${error}`);
        }
    }

    private async savePocketState(): Promise<void> {
        const stateStr = JSON.stringify(this.Pocket);
        await this.storage.setItem(`pocket-state-${this.idKey.publicKey}`, stateStr);
    }

    // Key management
    private async deriveSingleUseKey(path?: string): Promise<SingleUseKeyPair> {
        // Generate a new key pair
        // Start from base path if not provided
        path = `m/7'/23'/11'/16'/0/${this.Pocket.singleUseKeys.size}`;

        // Create HDKey instance from master key
        const hdKey: HDKey = this.hdKey.derive(path);
        const keyPair: KeyPair = {
            secretKey: hdKey.privateKey, // hex string
            publicKey: hdKey.publicKey
        };

        // Convert compressed public key to uncompressed if needed  
        if (keyPair.publicKey && keyPair.publicKey.length === 66) { // Compressed public key is 33 bytes (66 hex chars)
            const uncompressedKey = getPublicKey(hexToBytes(keyPair.secretKey)); // true = uncompressed
            keyPair.publicKey = uncompressedKey;
        }
        // Create the single-use key object
        const singleUseKey: SingleUseKeyPair = {
            ...keyPair,
            createdAt: Date.now(),
            used: false,
        };

        // Add the key to the pocket's state    
        await this.addSingleUseKey(singleUseKey.publicKey, singleUseKey);

        return singleUseKey;
    }

    addSingleUseKey = async (pubkey: string, key: SingleUseKeyPair) => {
        // Check if the pubkey already exists in the map
        if (!this.Pocket.singleUseKeys.has(pubkey)) {
            // Add the pubkey with the associated object
            this.Pocket.singleUseKeys.set(pubkey, key);
            Debug.log(`Key with pubkey ${pubkey} added`, 'Pocket');
        } else {
            Debug.log(`Key with pubkey ${pubkey} already used`, 'Pocket');
        }
        await this.savePocketState();
    };

    removeSingleUseKey = async (pubkey: string) => {
        if (this.Pocket.singleUseKeys.has(pubkey)) {
            this.Pocket.singleUseKeys.delete(pubkey);
            Debug.log(`Key with pubkey ${pubkey} removed`, 'Pocket');
        } else {
            Debug.log(`Key with pubkey ${pubkey} does not exist`, 'Pocket');
        }
        await this.savePocketState();
    };
}