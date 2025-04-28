import NDK, { NDKEvent, NDKSubscription } from "@nostr-dev-kit/ndk";
import { Storage, StorageInterface } from "@tat-protocol/storage";
import { KeyPair } from "@tat-protocol/types";

import { NWPCRouter } from "./NWPCRouter";
import { HandlerEngine } from "./HandlerEngine";
import { NWPCConfig, NWPCContext, NWPCRequest, NWPCResponse, NWPCRoute, NWPCHandler, MessageHookOptions } from "./NWPCResponseTypes";
import { Wrap, Unwrap } from '@tat-protocol/utils';
import { INWPCBase } from './NWPCBaseInterface';

export abstract class NWPCBase implements INWPCBase {
    protected ndk: NDK;
    public router: NWPCRouter;
    protected engine: HandlerEngine;
    protected storage: StorageInterface;
    protected keys: KeyPair;
    protected config: NWPCConfig;
    protected requestHandlers: Map<string, NWPCRoute>;
    protected hooks: MessageHookOptions;
    protected state: {
        connected: boolean;
        activeSubscriptions: Map<string, any>;
    };

    constructor(config: NWPCConfig) {
        this.config = config;
        this.keys = config.keys;
        this.ndk = new NDK({ explicitRelayUrls: config.relays || [] ,netDebug: config.netDebug});
        this.requestHandlers = config.requestHandlers || new Map();
        this.storage = config.storage || new Storage();
        this.hooks = config.hooks || {};
        this.state = {
            connected: false,
            activeSubscriptions: new Map()
        };
        this.router = new NWPCRouter(this, this.requestHandlers);
        this.engine = new HandlerEngine(this);

        // Initialize subscriptions after all properties are set
        if (this.keys) {
            this.connect().then(() => {
                this.subscribe(this.keys.publicKey, this.handleEvent.bind(this));
            });
        } else {
            console.error('NWPCBase: Keys not initialized');
        }
    }

    
    public async connect(): Promise<void> {
        if (this.state.connected) {
            return;
        }

        try {
            await this.ndk.connect();
            this.state.connected = true;
        } catch (error) {
            throw new Error(`Failed to connect to relays: ${error}`);
        }
    }

    public async disconnect(): Promise<void> {
        if (!this.state.connected) {
            return;
        }

        this.state.connected = false;
    }

    public use(method: string, ...handlers: NWPCHandler[]): void {
        return this.router.use(method, ...handlers);
    }

    public getActiveSubscriptions(): Map<string, any> {
        return this.state.activeSubscriptions;
    }

    public getSubscription(pubkey: string): any {
        return this.state.activeSubscriptions.get(pubkey);
    }

    public async subscribe(pubkey: string, handler: (event: NDKEvent) => Promise<void>): Promise<NDKSubscription> {
        const filter = {
            kinds: [1059],
            '#p': [pubkey],
            since: Math.floor(Date.now() / 1000) - (3 * 24 * 60 * 60)
        };


        const subscription = this.ndk.subscribe(filter, {
            closeOnEose: false
        });

        // Set up event handlers before creating subscription
        const eventHandler = async (event: any) => {
            console.log(`\n=========================== NWPCBase: Received event on subscription : ${event.id} ============\n\n`,);
            await handler(event);
        };

        const eoseHandler = () => {
            console.log('\n=========================== NWPCBase: EOSE received ===========================\n');
        };

        subscription.on('event', eventHandler);
        subscription.on('eose', eoseHandler);
        this.state.activeSubscriptions.set(pubkey, subscription);
        return subscription;
    }

    public async unsubscribe(pubkey: string): Promise<boolean> {
        const subscription = this.getSubscription(pubkey);
        subscription.close();
        return this.state.activeSubscriptions.delete(pubkey);
    }

    public async saveState(): Promise<void> {
        await this.storage.setItem('nwpcState', JSON.stringify(this.state));
    }

    public async loadState(): Promise<void> {
        const state = await this.storage.getItem('nwpcState');
        if (state) {
            this.state = JSON.parse(state);
        }
    }

    public async sendResponse(response: NWPCResponse, recipientPubkey: string): Promise<void> {
        if (!this.keys) {
            throw new Error('Keys not initialized');
        }

        const wrappedEvent = await Wrap(
            this.ndk,
            JSON.stringify(response),
            this.keys,
            recipientPubkey
        );

        await wrappedEvent.publish();
    }

    public async broadcastResponse(response: NWPCResponse, recipients: string[]): Promise<void> {
        await Promise.all(recipients.map(pubkey => this.sendResponse(response, pubkey)));
    }

    protected abstract handleEvent(event: NDKEvent): Promise<void>;

    protected createRequest(method: string, params: any[]): NWPCRequest {
        return {
            id: Math.random().toString(36).substring(7),
            method,
            params,
            timestamp: Date.now()
        };
    }
} 