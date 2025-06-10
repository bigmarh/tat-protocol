import { NWPCHandler, NWPCConfig, NWPCPeer, NWPCState, NWPCContext } from "@tat-protocol/nwpc";
import { Token } from "@tat-protocol/token";
import { DebugLogger, Unwrap } from "@tat-protocol/utils";
import { StorageInterface } from "@tat-protocol/storage";
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { KeyPair } from '@tat-protocol/hdkeys';
import { Transaction } from "./Transaction";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { SingleUseKey } from "@tat-protocol/hdkeys";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { HDKey } from "@tat-protocol/hdkeys";
import { validateMnemonic } from '@scure/bip39';
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english';

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
    tokens: Map<string, Map<string, string>>; //[issuerPubkey, tokenHash, tokenJWT], Hold the tokenJWT for each tokenHash
    balances: Map<string, Map<string, number>>;         //[issuerPubkey,setID, balance]. Hold the balance for each issuer
    tokenIndex: Map<string, Map<number, string[]>>; //[issuerPubkey, identifier(denomination), [tokenhash]], Hold the tokenhash for each denomination
    tatIndex: Map<string, Map<string, string>>; //[issuerPubkey, identifier(tokenID, tokenID:derivative-tokenId), tokenhash], Hold the tokenhash for each tokenID
    connected: boolean;
    activeSubscriptions: Map<string, any>;
}

export interface HDKeys {
    mnemonic: string;
}

const Debug = DebugLogger.getInstance();

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
        if (!config?.storage) {
            this.storage = new Storage().create(config.storage);
        }

        this.handleEvent = this.handleEvent.bind(this);
    }

    /**
     * Async initialization for Pocket instance. Loads idKey if needed and initializes the NWPC client.
     */
    public async init(): Promise<void> {
        if (this.config?.keyID) {
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
        this.stateKey = `pocket-state-${this.keys.publicKey}`;
        await this.loadPocketState();
        this.isInitialized = true;
    }

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
                console.log("Pocket: loadPocketState: mnemonic", mnemonic);
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

        console.log("Pocket: deriveSingleUseKey subscribe:", keyPair.publicKey);
        const handler = async (event: NDKEvent) => {
            try {
                console.log("Pocket: sendRequestWithSingleUseKey response");
                await this.handleEvent(event);

                //unsubscribe from the single-use key after use
                await this.unsubscribe(keyPair.publicKey);
                this.state.singleUseKeys.delete(keyPair.publicKey);
                console.log("Pocket: unsubscribe from single-use key", keyPair.publicKey);
            } catch (e) {
                // Ignore invalid responses
                console.log("Pocket: sendRequestWithSingleUseKey error", e);
            }

        };
        console.log("Pocket: subscribe to single-use key", keyPair.publicKey);
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
        console.log("Pocket: toKey", event.tags);
        if (toKey === this.keys.publicKey) {
            keys = this.keys;
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
                console.log("Pocket: Failed to unwrap event:", event.id);
                return;
            }

            if (!unwrapped.verifiedSender) {
                console.log("Pocket:Original Event is not valid:", event.id);
                return;
            }

            const message = JSON.parse(unwrapped.content);

            const context: NWPCContext = {
                event,
                poster: event.pubkey,
                sender: unwrapped.sender,
                recipient: this.keys.publicKey as string,
            };

            const eventId = event.id;
            if (this.isEventProcessed(eventId)) {
                console.log("Pocket: duplicate event detected", eventId);
                return;
            }
            this.markEventProcessed(eventId);

            //
            if (message.result?.token) {
                console.log("Pocket: received token", message.result.token);
                await this.storeToken(message.result.token);
            }
            //delete the token from the state if it is spent
            else if (message.result?.spent) {
                console.log("Pocket: received spent token", message.result);
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

                    console.log(
                        "NWPCPeer: Found response handler for message ID:",
                        message.id,
                    );
                    const handler = this.responseHandlers.get(message.id);
                    if (handler) {
                        clearTimeout(handler.timeoutId);
                        this.responseHandlers.delete(message.id);
                        handler.resolve(message);
                        console.log("Pocket: handleEvent message", message);
                        if (message.error?.code == 409) {
                            console.log("Pocket: handleEvent error", message.error);
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
                console.log("Pocket: handleEvent messageID", message.id);
                console.log("Pocket: handleEvent secondary message", message);
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

    public getToken(issuer: string, tokenHash: string) {
        return this.state.tokens.get(issuer)?.get(tokenHash);
    }

    public getTokenIndex(issuer: string, denomination: number) {
        return this.state.tokenIndex.get(issuer)?.get(denomination);
    }

    public getTAT(issuer: string, tokenID: string) {
        return this.state.tatIndex.get(issuer)?.get(tokenID);
    }

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
        console.log("createTATTransferTx", issuer, to, tokenID);
        const tx = new Transaction(
            'transferTAT',
            this.state
        );
        return tx.transferTAT(issuer, to, tokenID);
    }


    /**
     * Send a TAT transfer transaction to the network.
     * @param issuer The issuer of the TAT
     * @param to Recipient address
     * @param tokenID The TAT token ID
     * @returns The response from the network
     */
    public async sendTAT(issuer: string, to: string, tokenID: string) {
        const [method, tx] = this.createTATTransferTx(issuer, to, tokenID);
        console.log("Pocket: sendTAT", tx);
        return this.sendTx(method, issuer, tx);
    }

    /**
     * Send a fungible transfer transaction to the network.
     * @param issuer The issuer of the token
     * @param to Recipient address
     * @param amount Amount to transfer
     * @param changeKey Address to send change to (optional)
     * @returns The response from the network
     */
    public async transfer(issuer: string, to: string, amount: number, changeKey?: string) {
        const [method, tx] = await this.createFungibleTransferTx(issuer, to, amount, changeKey);
        console.log("Pocket: transfer", tx);
        return this.sendTx(method, issuer, tx);
    }


    /**
     * Send a transaction to the network.
     * @param method The method to send
     * @param issuer The issuer of the transaction
     * @param tx The transaction to send
     * @returns The response from the network
     */
    public async sendTx(method: string, issuer: string, tx: any) {
        // Restore tokens from tx.inputs or tx.ins
        const inputs: Token[] = [];
        console.log("Pocket: sendTx", method, tx);
        if (tx.ins) {
            for (const input of tx.ins) {
                // Support both { token: jwt } and raw jwt

                const jwt = input.token || input;
                const token = await new Token().restore(jwt);
                console.log("Pocket: sendTx token", token);
                inputs.push(token);
            }
        }
        // Build witness data if needed
        const witnessData = await this.buildWitnessData(inputs);
        // Attach witnessData to tx if any are present
        if (witnessData.some(w => w)) {
            tx.witnessData = witnessData;
        }

        console.log("Pocket: sendTx finalTx", tx);
        return this.request(method, tx, issuer);
    }

    /**
     * Generate a new single-use key and return its public key.
     * The key is saved to state so you can later spend tokens sent to it.
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
        tx: any,
        forgePubkey: string,
        responseTimeoutMs: number = 10000
    ): Promise<any> {
        // 1. Generate a new single-use key
        const senderKeys = await this.deriveSingleUseKey();

        // 2. Subscribe for the response
        let response: any = null;
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
        await this.request(method, tx, forgePubkey, senderKeys);

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
        const setID = token.payload.ext?.setID ? token.payload.ext.setID : "-";
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
            let message: any;
            try {
                message = JSON.parse(event.content);
            } catch (e) {
                // Not JSON, ignore or handle as needed
                console.warn("Pocket: handleIssuerSpentEvent received non-JSON content, ignoring:", event.content);
                return;
            }
            if (message.result?.spent && message.result?.issuer) {
                const tokenHash = message.result.spent;
                const issuer = message.result.issuer;
                const tokenJWT = this.state.tokens.get(issuer)?.get(tokenHash);
                if (tokenJWT) {
                    await this.deleteToken(tokenJWT);
                }
                await this.savePocketState();
                console.log(`Pocket: Token spent event processed for issuer ${issuer}, tokenHash ${tokenHash}`);
            }
        } catch (error) {
            console.error("Pocket: handleIssuerSpentEvent error", error);
        }
    }
}