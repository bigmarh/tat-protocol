import { NWPCContext, NWPCHandler, NWPCPeer, NWPCRequest, NWPCResponseObject } from "@tat-protocol/nwpc";
import { HDKey } from "@tat-protocol/hdkeys";
import { DebugLogger } from "@tat-protocol/utils";
import { StorageInterface, Storage } from "@tat-protocol/storage";
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { KeyPair } from '@tat-protocol/types';

import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { SingleUseKey } from "@tat-protocol/hdkeys";


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

export interface PocketConfig {
    ndk?: unknown;
    relays?: string[];
    storage?: StorageInterface;
    storageType?: 'node' | 'browser';
    requestHandlers?: Map<string, NWPCHandler>;
    keys?: KeyPair;
}

export interface PocketState {
    favorites: string[];
    hdMasterKey: HDKeys;
    singleUseKeys: Map<string, SingleUseKey>;
    tokens: Map<string, Map<string, string>>;
    balances: Map<string, number>;
}



export interface HDKeys {
    mnemonic: string;
}

const Debug = DebugLogger.getInstance();

export class Pocket {
    private idKey!: KeyPair;
    private Pocket!: PocketState;
    private mnemonic: string = '';
    private config: PocketConfig;
    private isInitialized: boolean;
    private storage: StorageInterface;
    private hdKey!: HDKey;
    private nwpcClient!: NWPCPeer;

    private constructor(config?: PocketConfig) {
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
            tokens: new Map(),
            balances: new Map()
        };
        // Initialize storage based on config
        this.storage = new Storage(config?.storage || {});

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

            // Initialize NWPC client
            this.nwpcClient = new NWPCPeer({
                keys: this.idKey,
                storage: this.storage
            });

            const defaultRequestHandlers = new Map<string, NWPCHandler>([
                ['message', async (req: NWPCRequest, context: NWPCContext, res: NWPCResponseObject) => {
                    console.log("message received");
                    //TODO: handle message, store it for later reading
                    return res.send({ success: true });
                }],
                ['requestSignature', async (req: NWPCRequest, context: NWPCContext, res: NWPCResponseObject) => {
                    console.log("requestSignature received");
                    return res.send({ success: true });
                }]
            ]);

            // Register Default NWPC handlers
            this.registerNWPCHandlers(defaultRequestHandlers);
            // Register additional request handlers if provided
            if (this.config?.requestHandlers) {
                this.registerNWPCHandlers(this.config.requestHandlers);
            }

            await this.savePocketState();
            this.isInitialized = true;
            return this.idKey;
        }
        catch (error: any) {
            throw new Error(`Failed to initialize Pocket: ${error}`);
        }
    }


    private registerNWPCHandlers(requestHandlers: Map<string, NWPCHandler[] | NWPCHandler>) {
        //TODO: check if the requestHandlers is a map   
        if (requestHandlers instanceof Map) {
            for (const [key, handler] of requestHandlers.entries()) {
                if (handler instanceof Array) { 
                    this.nwpcClient.use(key, ...handler);
                }
                else {
                    this.nwpcClient.use(key, handler);
                }
            }
        }
        else {
            throw new Error('Request handlers must be a map');
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
                singleUseKeys: new Map(state.singleUseKeys || []),
                tokens: new Map(
                    (state.tokens || []).map(([issuer, tokens]: [string, [string, string][]]) => [
                        issuer,
                        new Map(tokens)
                    ])
                ),
                balances: new Map(state.balances || [])
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