import { ForgeConfig } from './ForgeConfig';
import { ForgeState } from './ForgeState';
import { Token } from '@tat-protocol/token';
import { TokenType } from '@tat-protocol/types';
import { KeyPair } from '@tat-protocol/types';
import { NWPCServer, NWPCRequest, NWPCContext, NWPCResponseObject } from '@tat-protocol/nwpc';

import { signMessage, verifySignature } from '@tat-protocol/utils';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { StorageInterface } from '@tat-protocol/storage/lib/StorageInterface';
import { Storage } from '@tat-protocol/storage/lib/Storage';
import NDK from '@nostr-dev-kit/ndk';
import * as nodeCrypto from 'crypto';
import { EventEmitter } from 'events';


/**
 * Main Forge class that handles token minting and management
 */
export class Forge {
    private keys!: KeyPair; 
    private config: ForgeConfig;
    private state: ForgeState;
    private isInitialized: boolean;
    private storage: StorageInterface;
    private nwpcServer: NWPCServer;
    private ndk: NDK;
    /**
     * Create a new Forge instance
     * @param config - Configuration options for the forge
     */
    constructor(config: ForgeConfig) {
        this.ndk = new NDK();
        this.config = config;
        this.isInitialized = false;


        this.storage = new Storage(config?.storage || {});

        // Initialize empty state
        this.state = {
            owner: config.owner || '',
            version: 1,
            spentTokens: new Set(),
            pendingTxs: new Map(),
            totalSupply: 0,
            authorizedForgers: new Set(config.authorizedForgers || []),
            tokenUsage: new Map()
        };
        if (!this.state.owner) {
            throw new Error('Forge owner is required');
        }
        // Set keys from config if provided
        if (config.keys) {
            this.keys = config.keys;
        }

        this.nwpcServer = new NWPCServer({ keys: this.keys });
        // Initialize the forge
        this.initialize();
    }

    /**
     * Initialize the forge
     * @param forgeId - Optional ID for the forge
     */
    async initialize(): Promise<void> {
        //
        if (this.isInitialized) {
            return;
        }

        await this.initializeKeys();
        await this.loadState();
        await this.saveState();
        this.isInitialized = true;
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
        currentTime?: number
    ): Promise<boolean> {
        // Check if token is already spent (only if connected)
        if (this.state.spentTokens.has(tokenHash)) {
            throw new Error('Token has already been spent');
        }

        // Verify the signature
        const dataToSign = new TextEncoder().encode(tokenHash);
        const isValid = verifySignature(dataToSign, hexToBytes(signature), publicKey);
        if (!isValid) {
            throw new Error('Invalid token signature');
        }

        // If time window is provided, verify the time slot
        if (timeWindow && currentTime) {
            const currentSlot = Math.floor(currentTime / (timeWindow * 1000));
            const tokenSlot = parseInt(tokenHash.split(':')[1]);
            if (Math.abs(currentSlot - tokenSlot) > 1) { // Allow 1 slot drift
                throw new Error('Token time window expired');
            }
        }

        // If reader pubkey is provided, verify it matches
        if (readerPubkey) {
            const tokenReaderPubkey = tokenHash.split(':')[2];
            if (tokenReaderPubkey !== readerPubkey) {
                throw new Error('Token not valid for this reader');
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
            throw new Error('Forge must be initialized');
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
            throw new Error('Forge must be initialized');
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

    private async initializeKeys(forgeId?: number): Promise<void> {
        try {
            const forgeKeyId = 'forge-keys';
            const existingKeys = await this.storage.getItem(forgeKeyId);

            if (existingKeys) {
                const parsedKeys = JSON.parse(existingKeys);
                this.keys = {
                    secretKey: parsedKeys.secretKey,
                    publicKey: parsedKeys.publicKey
                };
            } else {
                const secretKey = bytesToHex(generateSecretKey());
                const publicKey = getPublicKey(hexToBytes(secretKey));
                const newKeys = {
                    secretKey: secretKey,
                    publicKey: publicKey
                };
                await this.storage.setItem(forgeKeyId, JSON.stringify(newKeys));
                this.keys = { secretKey, publicKey };
            }
        } catch (error: any) {
            throw new Error(`Key initialization failed: ${error.message}`);
        }
    }


    private async saveState(): Promise<void> {
        const serializableState = {
            ...this.state,
            spentTokens: Array.from(this.state.spentTokens),
            pendingTxs: Array.from(this.state.pendingTxs.entries()),
            tokenUsage: Array.from(this.state.tokenUsage.entries()),
            lastSavedAt: Date.now()
        };
        await this.storage.setItem('forge-state', JSON.stringify(serializableState));
    }

    private async loadState(): Promise<void> {
        const savedState = await this.storage.getItem('forge-state');
        if (savedState) {
            const parsedState = JSON.parse(savedState);
            this.state = {
                owner: parsedState.owner,
                version: parsedState.version || 1,
                spentTokens: new Set(parsedState.spentTokens || []),
                pendingTxs: new Map(parsedState.pendingTxs || []),
                totalSupply: parsedState.totalSupply || 0,
                lastAssetId: parsedState.lastAssetId,
                lastProcessedEvent: parsedState.lastProcessedEvent,
                lastSavedAt: parsedState.lastSavedAt,
                authorizedForgers: new Set(Array.isArray(parsedState.authorizedForgers) ? parsedState.authorizedForgers : []),
                tokenUsage: new Map(parsedState.tokenUsage || [])
            };
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
    private async handleTransfer(req: NWPCRequest, context: NWPCContext, res: NWPCResponseObject) {
        const [tokenJWT, recipient, amount] = req.params;
        const sender = context.sender;  // Get sender from context

        // Basic validation
        if (!tokenJWT || !recipient) {
            return await res.error(400, 'Missing required parameters: tokenJWT and recipient');
        }

        try {
            const token = await new Token().restore(tokenJWT);

            // Route to appropriate handler based on token type
            switch (token.getTokenType()) {
                case TokenType.FUNGIBLE:
                    return await this.handleFungibleTransfer(token, recipient, amount, res, sender);
                case TokenType.NON_FUNGIBLE:
                    return await this.handleNonFungibleTransfer(token, recipient, res);
                case TokenType.SEMI_FUNGIBLE:
                    return await this.handleSemiFungibleTransfer(token, recipient, amount, res, sender);
                default:
                    return await res.error(400, 'Invalid token type');
            }
        } catch (error: any) {
            return await res.error(500, error.message);
        }
    }

    private async handleFungibleTransfer(
        token: Token,
        recipient: string,
        amount: string | undefined,
        res: NWPCResponseObject,
        sender: string
    ) {
        // Validate amount
        if (amount === undefined) {
            return await res.error(400, 'Amount required for fungible token transfer');
        }
        const transferAmount = Number(amount);
        if (isNaN(transferAmount) || transferAmount <= 0) {
            return await res.error(400, 'Invalid amount: must be a positive number');
        }

        // Check token validity
        if (token.isExpired()) {
            return await res.error(400, 'Token has expired');
        }

        // Check if token is already spent
        const tokenHash = await token.create_token_hash();
        if (this.state.spentTokens.has(tokenHash)) {
            return await res.error(400, 'Token has already been spent');
        }

        // Verify sufficient funds
        const tokenAmount = token.payload.amount || 0;
        if (transferAmount > tokenAmount) {
            return await res.error(400, 'Insufficient token amount for transfer');
        }

        // Create new token for recipient
        const newToken = new Token();
        await newToken.build({
            token_type: TokenType.FUNGIBLE,
            payload: Token.createPayload({
                iss: this.keys.publicKey!,
                amount: transferAmount,
                P2PKlock: recipient,
                timeLock: token.payload.timeLock,
                data_uri: token.payload.data_uri
            })
        });

        // Handle change if needed
        if (transferAmount < tokenAmount) {
            const changeToken = new Token();
            await changeToken.build({
                token_type: TokenType.FUNGIBLE,
                payload: Token.createPayload({
                    iss: this.keys.publicKey!,
                    amount: tokenAmount - transferAmount,
                    P2PKlock: token.payload.P2PKlock,
                    timeLock: token.payload.timeLock,
                    data_uri: token.payload.data_uri
                })
            });

            const [newTokenJWT, changeTokenJWT] = await Promise.all([
                this.signAndCreateJWT(newToken),
                this.signAndCreateJWT(changeToken)
            ]);

            this.state.spentTokens.add(tokenHash);
            await this.saveState();

            await res.send({
                token: newTokenJWT
            }, recipient);

            return await res.send({
                token: changeTokenJWT,
            }, sender);
        }

        // Full transfer
        const newTokenJWT = await this.signAndCreateJWT(newToken);
        this.state.spentTokens.add(tokenHash);
        await this.saveState();

        return await res.send({ token: newTokenJWT }, recipient);
    }

    private async handleNonFungibleTransfer(
        token: Token,
        recipient: string,
        res: NWPCResponseObject
    ) {
        // Validate NFT properties
        if (!token.payload.tokenID) {
            return await res.error(400, 'Non-fungible token must have a tokenID');
        }

        // Check token validity
        if (token.isExpired()) {
            return await res.error(400, 'Token has expired');
        }

        // Check if token is already spent
        const tokenHash = await token.create_token_hash();
        if (this.state.spentTokens.has(tokenHash)) {
            return await res.error(400, 'Token has already been spent');
        }

        // Create new token for recipient
        const newToken = new Token();
        await newToken.build({
            token_type: TokenType.NON_FUNGIBLE,
            payload: Token.createPayload({
                iss: this.keys.publicKey!,
                tokenID: token.payload.tokenID,
                P2PKlock: recipient,
                timeLock: token.payload.timeLock,
                data_uri: token.payload.data_uri
            })
        });

        const newTokenJWT = await this.signAndCreateJWT(newToken);
        this.state.spentTokens.add(tokenHash);
        await this.saveState();

        return await res.send({ token: newTokenJWT }, recipient);
    }

    private async handleSemiFungibleTransfer(
        token: Token,
        recipient: string,
        amount: string | undefined,
        res: NWPCResponseObject,
        sender: string
    ) {
        // Validate SFT properties
        if (!token.payload.tokenID) {
            return await res.error(400, 'Semi-fungible token must have a tokenID');
        }

        // Validate amount
        if (amount === undefined) {
            return await res.error(400, 'Amount required for semi-fungible token transfer');
        }
        const transferAmount = Number(amount);
        if (isNaN(transferAmount) || transferAmount <= 0) {
            return await res.error(400, 'Invalid amount: must be a positive number');
        }

        // Check token validity
        if (token.isExpired()) {
            return await res.error(400, 'Token has expired');
        }

        // Check if token is already spent
        const tokenHash = await token.create_token_hash();
        if (this.state.spentTokens.has(tokenHash)) {
            return await res.error(400, 'Token has already been spent');
        }

        // Verify sufficient quantity
        const tokenAmount = token.payload.amount || 0;
        if (transferAmount > tokenAmount) {
            return await res.error(400, 'Insufficient token quantity for transfer');
        }

        // Create new token for recipient
        const newToken = new Token();
        await newToken.build({
            token_type: TokenType.SEMI_FUNGIBLE,
            payload: Token.createPayload({
                iss: this.keys.publicKey!,
                tokenID: token.payload.tokenID,
                amount: transferAmount,
                P2PKlock: recipient,
                timeLock: token.payload.timeLock,
                data_uri: token.payload.data_uri
            })
        });

        // Handle change if needed
        if (transferAmount < tokenAmount) {
            const changeToken = new Token();
            await changeToken.build({
                token_type: TokenType.SEMI_FUNGIBLE,
                payload: Token.createPayload({
                    iss: this.keys.publicKey!,
                    tokenID: token.payload.tokenID,
                    amount: tokenAmount - transferAmount,
                    P2PKlock: token.payload.P2PKlock,
                    timeLock: token.payload.timeLock,
                    data_uri: token.payload.data_uri
                })
            });

            const [newTokenJWT, changeTokenJWT] = await Promise.all([
                this.signAndCreateJWT(newToken),
                this.signAndCreateJWT(changeToken)
            ]);

            this.state.spentTokens.add(tokenHash);
            await this.saveState();
            // Send token to recipient, but send change back to original owner
            await res.send({
                token: newTokenJWT
            }, recipient);

            return await res.send({
                token: changeTokenJWT,
            }, sender);
        }

        // Full transfer
        const newTokenJWT = await this.signAndCreateJWT(newToken);
        this.state.spentTokens.add(tokenHash);
        await this.saveState();

        return await res.send({ token: newTokenJWT }, recipient);
    }

    // Helper method to sign and create JWT
    private async signAndCreateJWT(token: Token): Promise<string> {
        const dataToSign = await token.data_to_sign();
        const signature = await token.sign(dataToSign, this.keys);
        return await token.toJWT(bytesToHex(signature));
    }

    /**
     * Verifies a token's access rules and owner signature
     * @param tokenJWT - The token JWT
     * @param requiredAccess - The required access rules to verify against
     * @param ownerPubkey - Optional owner's public key to verify against
     * @returns true if the token has the required access and valid owner signature
     */
    async verifyAccess(
        tokenJWT: string,
        requiredAccess: { [key: string]: any },
        ownerPubkey?: string
    ): Promise<boolean> {
        const token = await new Token().restore(tokenJWT);



        // Verify the token signature
        if (!await this.verifyToken(
            token.header.token_hash!,
            token.signature,
            token.payload.iss
        )) {
            return false;
        }

        // Get token's access rules
        const tokenAccess = token.getAccessRules();
        if (!tokenAccess) {
            return false;
        }

        // Verify each required access rule
        for (const [key, value] of Object.entries(requiredAccess)) {
            if (tokenAccess[key] === undefined) {
                return false;
            }

            // Handle different types of access rules
            if (Array.isArray(value)) {
                // For array rules (e.g., allowed models)
                if (!Array.isArray(tokenAccess[key]) ||
                    !value.every(v => tokenAccess[key].includes(v))) {
                    return false;
                }
            } else if (typeof value === 'object' && value !== null) {
                // For object rules (e.g., nested access control)
                if (typeof tokenAccess[key] !== 'object' ||
                    !this.verifyAccessRules(tokenAccess[key], value)) {
                    return false;
                }
            } else {
                // For simple value rules (e.g., usage limits)
                if (tokenAccess[key] !== value) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Helper method to verify nested access rules
     */
    private verifyAccessRules(tokenRules: any, requiredRules: any): boolean {
        for (const [key, value] of Object.entries(requiredRules)) {
            if (tokenRules[key] === undefined) {
                return false;
            }

            if (typeof value === 'object' && value !== null) {
                if (typeof tokenRules[key] !== 'object' ||
                    !this.verifyAccessRules(tokenRules[key], value)) {
                    return false;
                }
            } else if (tokenRules[key] !== value) {
                return false;
            }
        }
        return true;
    }


} 