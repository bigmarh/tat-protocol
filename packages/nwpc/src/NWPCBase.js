import NDK from "@nostr-dev-kit/ndk";
import { defaultConfig } from "@tat-protocol/config";
import { NWPCRouter } from "./NWPCRouter";
import { HandlerEngine } from "./HandlerEngine";
import { deserializeData, serializeData, Wrap, WrapWithSigner, DebugLogger, } from "@tat-protocol/utils";
import { v4 as uuidv4 } from "uuid";
import { LRUCache } from "lru-cache";
import { BloomFilter } from "@tat-protocol/utils";
const Debug = DebugLogger.getInstance();
/**
 * Base class for NWPC (Nostr Wrapped Protocol Communication).
 *
 * NWPCBase provides the foundation for building decentralized communication
 * protocols on top of Nostr. It handles:
 * - Encrypted message wrapping/unwrapping
 * - Event subscription and routing
 * - State persistence with deduplication
 * - Request/response handling via hooks
 *
 * Both clients (NWPCPeer) and servers (NWPCServer) extend this class.
 *
 * @example
 * ```typescript
 * class MyClient extends NWPCBase {
 *   protected async handleEvent(event: NDKEvent) {
 *     // Process incoming events
 *   }
 * }
 * ```
 */
export class NWPCBase {
    ndk;
    router;
    engine;
    storage;
    /** Signer interface for abstracted key management */
    signer;
    /** Direct keys for backwards compatibility (used if signer not provided) */
    keys;
    /** Cached public key (resolved from signer on init) */
    publicKey;
    config;
    requestHandlers;
    hooks;
    state;
    stateKey;
    connected = false;
    activeSubscriptions = new Map();
    deduplication = true; // Enable deduplication for event processing
    // Hybrid LRU + Bloom filter for processed events
    processedEventLRU;
    processedEventBloom;
    static BLOOM_EXPECTED_ITEMS = 15000;
    static BLOOM_ERROR_RATE = 0.01;
    static LRU_SIZE = 1000;
    // Save queue lock to serialize state saves
    saveLock = Promise.resolve();
    /**
     * Initializes the NWPC instance.
     *
     * This method must be called after construction. It connects to relays,
     * loads saved state, and sets up initial subscriptions. Safe to call
     * multiple times (idempotent).
     *
     * @example
     * ```typescript
     * const client = new MyClient(config);
     * await client.init();
     * // Client is now ready to send/receive messages
     * ```
     */
    async init() {
        // Load state from storage if available
        // Connect and subscribe after state is loaded
        Debug.log("init", "NWPCBase");
        Debug.log("Storage initialized", "NWPCBase");
        // Resolve public key from signer or keys
        if (this.signer) {
            this.publicKey = await this.signer.getPublicKey();
        }
        else if (this.keys?.publicKey) {
            this.publicKey = this.keys.publicKey;
        }
        await this.connect();
        if (this.publicKey) {
            await this.subscribe(this.publicKey, this.handleEvent.bind(this));
        }
    }
    async queueSaveState(key, state) {
        this.saveLock = this.saveLock.then(() => this.saveState(key, state));
        return this.saveLock;
    }
    constructor(config) {
        this.config = config;
        // Store signer if provided (takes precedence over keys)
        this.signer = config.signer;
        // Keep keys for backwards compatibility
        this.keys = config.keys || { secretKey: "", publicKey: "" };
        this.ndk = new NDK({
            explicitRelayUrls: config.relays || defaultConfig.relays,
        });
        this.requestHandlers = config.requestHandlers || new Map();
        // Use provided storage directly if present, otherwise throw
        Debug.log("constructor: config.storage" + config.storage, "NWPCBase");
        if (config.storage) {
            this.storage = config.storage;
        }
        else {
            throw new Error("A StorageInterface implementation must be provided for NWPCBase.");
        }
        this.hooks = config.hooks || {};
        this.state = {
            relays: new Set(),
            // processedEventIds: new Set(), // No longer used for runtime checks
        };
        this.router = new NWPCRouter(this.requestHandlers);
        this.engine = new HandlerEngine();
        // Initialize LRU cache and Bloom filter
        this.processedEventLRU = new LRUCache({ max: NWPCBase.LRU_SIZE });
        this.processedEventBloom = new BloomFilter(NWPCBase.BLOOM_EXPECTED_ITEMS, NWPCBase.BLOOM_ERROR_RATE);
    }
    async connect() {
        if (this.connected) {
            Debug.log("already connected" + this.state.relays, "NWPCBase");
            return this;
        }
        await this.ndk.connect();
        this.connected = true;
        Debug.log("connected" + this.ndk.pool.connectedRelays().map((relay) => relay.url), "NWPCBase");
        const relays = this.ndk.pool.connectedRelays().map((relay) => relay.url);
        this.state.relays = new Set([...this.state.relays, ...relays]);
        return this;
    }
    async disconnect() {
        Debug.log("disconnect", "NWPCBase");
        if (!this.connected) {
            return;
        }
        this.connected = false;
    }
    use(method, ...handlers) {
        return this.router.use(method, ...handlers);
    }
    getActiveSubscriptions() {
        return this.activeSubscriptions ?? new Map();
    }
    getSubscription(pubkey) {
        return this.activeSubscriptions?.get(pubkey);
    }
    // Hybrid duplicate detection
    isEventProcessed(eventId) {
        if (this.deduplication) {
            if (this.processedEventLRU.has(eventId))
                return true;
            if (this.processedEventBloom.contains(eventId))
                return true;
        }
        return false;
    }
    markEventProcessed(eventId) {
        if (this.deduplication) {
            this.processedEventLRU.set(eventId, true);
            this.processedEventBloom.add(eventId);
        }
    }
    /**
     * Subscribes to encrypted messages for a specific public key.
     *
     * Creates a Nostr subscription filtered to kind 1059 (gift-wrapped) events
     * tagged with the specified public key. The handler is called for each
     * matching event. Automatically prevents duplicate event processing.
     *
     * @param pubkey - The public key to subscribe to (typically the recipient)
     * @param handler - Async function to handle incoming events
     * @returns The NDK subscription object
     *
     * @example
     * ```typescript
     * await nwpc.subscribe('myPubkey', async (event) => {
     *   const unwrapped = await Unwrap(event.content, keys, event.pubkey);
     *   console.log('Received message:', unwrapped.content);
     * });
     * ```
     */
    async subscribe(pubkey, handler) {
        // Prevent duplicate subscriptions: Unsubscribe if already subscribed
        const existing = this.getSubscription(pubkey);
        if (existing) {
            await this.unsubscribe(pubkey);
        }
        const filter = {
            kinds: [1059],
            "#p": [pubkey],
            since: Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60,
        };
        const subscription = this.ndk.subscribe(filter, {
            closeOnEose: false,
        });
        // Set up event handlers before creating subscription
        const eventHandler = async (event) => {
            if (this.deduplication && this.isEventProcessed(event.id)) {
                Debug.log(`\nSkipping already processed event: ${event.id}`, "NWPCBase");
                return;
            }
            Debug.log(`\n=========================== Received event on subscription : ${event.id} ============\n\n`, "NWPCBase");
            await handler(event);
            this.markEventProcessed(event.id);
            // Use the save queue to serialize state saves
            await this.queueSaveState(this.stateKey, this.state);
        };
        const eoseHandler = async () => {
            Debug.log("\n=========================== EOSE received ===========================\n", "NWPCBase");
            // Use the save queue to serialize state saves
            await this.queueSaveState(this.stateKey, this.state);
        };
        subscription.on("event", eventHandler);
        subscription.on("eose", eoseHandler);
        this.activeSubscriptions?.set(pubkey, subscription);
        return subscription;
    }
    async unsubscribe(pubkey) {
        const sub = this.getSubscription(pubkey);
        sub?.stop();
        return this.activeSubscriptions?.delete(pubkey) ?? false;
    }
    // Helper to serialize NWPCState safely
    serializeState(state) {
        return {
            ...state,
            relays: Array.from(state.relays || []),
            // processedEventIds: Array.from(state.processedEventIds || []),
            processedEventBloom: JSON.parse(this.processedEventBloom.serialize()),
        };
    }
    /**
     * Saves the current state to persistent storage.
     *
     * Serializes the state including the Bloom filter for processed events and
     * writes it to storage. State saves are queued to prevent race conditions.
     *
     * @param key - The storage key to use
     * @param state - The state object to save
     *
     * @example
     * ```typescript
     * await nwpc.saveState('my-state-key', this.state);
     * ```
     */
    async saveState(key, state) {
        // Persist the Bloom filter in state
        state.processedEventBloom = JSON.parse(this.processedEventBloom.serialize());
        const serializedState = serializeData(state);
        key = key || "nwpc-bbb-love";
        await this.storage.setItem(key, serializedState);
        return;
    }
    /**
     * Loads state from persistent storage.
     *
     * Retrieves and deserializes saved state, including the Bloom filter for
     * processed events. Handles migration from older state formats that used
     * a Set instead of a Bloom filter.
     *
     * @param key - The storage key to load from
     * @returns The loaded state, or null if no state exists
     *
     * @example
     * ```typescript
     * const state = await nwpc.loadState('my-state-key');
     * if (state) {
     *   this.state = state;
     * }
     * ```
     */
    async loadState(key) {
        const stateString = await this.storage.getItem(key);
        const state = stateString ? deserializeData(stateString) : null;
        if (state) {
            // Migration: If processedEventIds exists, add to Bloom filter
            if (state.processedEventIds && Array.isArray(state.processedEventIds)) {
                for (const eventId of state.processedEventIds) {
                    this.processedEventBloom.add(eventId);
                }
                // Remove the old set to save space
                delete state.processedEventIds;
                // Save the migrated state
                state.processedEventBloom = this.processedEventBloom.serialize();
                await this.saveState(key, state);
            }
            if (state.processedEventBloom) {
                this.processedEventBloom = BloomFilter.deserialize(JSON.stringify(state.processedEventBloom));
            }
        }
        return state;
    }
    async sendResponse(response, recipientPubkey) {
        if (!this.signer && !this.keys) {
            throw new Error("Signer or keys not initialized");
        }
        let wrappedEvent;
        if (this.signer) {
            wrappedEvent = await WrapWithSigner(this.ndk, JSON.stringify(response), this.signer, recipientPubkey);
        }
        else {
            wrappedEvent = await Wrap(this.ndk, JSON.stringify(response), this.keys, recipientPubkey);
        }
        await wrappedEvent.publish();
    }
    async broadcastResponse(response, recipients) {
        await Promise.all(recipients.map((pubkey) => this.sendResponse(response, pubkey)));
    }
    createRequest(method, params) {
        return {
            id: uuidv4(),
            method,
            params: JSON.stringify(params),
            timestamp: Date.now(),
        };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiTldQQ0Jhc2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJOV1BDQmFzZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLEdBQWtDLE1BQU0sb0JBQW9CLENBQUM7QUFHcEUsT0FBTyxFQUFFLGFBQWEsRUFBRSxNQUFNLG9DQUFvQyxDQUFDO0FBQ25FLE9BQU8sRUFBRSxVQUFVLEVBQUUsTUFBTSxjQUFjLENBQUM7QUFDMUMsT0FBTyxFQUFFLGFBQWEsRUFBRSxNQUFNLGlCQUFpQixDQUFDO0FBU2hELE9BQU8sRUFDTCxlQUFlLEVBQ2YsYUFBYSxFQUNiLElBQUksRUFDSixjQUFjLEVBQ2QsV0FBVyxHQUNaLE1BQU0scUJBQXFCLENBQUM7QUFHN0IsT0FBTyxFQUFFLEVBQUUsSUFBSSxNQUFNLEVBQUUsTUFBTSxNQUFNLENBQUM7QUFDcEMsT0FBTyxFQUFFLFFBQVEsRUFBRSxNQUFNLFdBQVcsQ0FBQztBQUNyQyxPQUFPLEVBQUUsV0FBVyxFQUFFLE1BQU0scUJBQXFCLENBQUM7QUFHbEQsTUFBTSxLQUFLLEdBQUcsV0FBVyxDQUFDLFdBQVcsRUFBRSxDQUFDO0FBRXhDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW9CRztBQUNILE1BQU0sT0FBZ0IsUUFBUTtJQUNyQixHQUFHLENBQU07SUFDVCxNQUFNLENBQWE7SUFDaEIsTUFBTSxDQUFnQjtJQUN0QixPQUFPLENBQW1CO0lBQ3BDLHFEQUFxRDtJQUMzQyxNQUFNLENBQVU7SUFDMUIsNEVBQTRFO0lBQ2xFLElBQUksQ0FBVTtJQUN4Qix1REFBdUQ7SUFDN0MsU0FBUyxDQUFVO0lBQ25CLE1BQU0sQ0FBYTtJQUNuQixlQUFlLENBQXlCO0lBQ3hDLEtBQUssQ0FBcUI7SUFDMUIsS0FBSyxDQUFZO0lBQ2pCLFFBQVEsQ0FBVTtJQUNsQixTQUFTLEdBQVksS0FBSyxDQUFDO0lBQzNCLG1CQUFtQixHQUFpQyxJQUFJLEdBQUcsRUFBRSxDQUFDO0lBQ2hFLGFBQWEsR0FBWSxJQUFJLENBQUMs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Q0FBQyxJQUFJLEVBQ1QsZUFBZSxDQUNoQixDQUFDO1FBQ0osQ0FBQztRQUVELE1BQU0sWUFBWSxDQUFDLE9BQU8sRUFBRSxDQUFDO0lBQy9CLENBQUM7SUFFTSxLQUFLLENBQUMsaUJBQWlCLENBQzVCLFFBQXNCLEVBQ3RCLFVBQW9CO1FBRXBCLE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FDZixVQUFVLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLFFBQVEsRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUNoRSxDQUFDO0lBQ0osQ0FBQztJQUVTLGFBQWEsQ0FDckIsTUFBYyxFQUNkLE1BQStCO1FBRS9CLE9BQU87WUFDTCxFQUFFLEVBQUUsTUFBTSxFQUFFO1lBQ1osTUFBTTtZQUNOLE1BQU0sRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQztZQUM5QixTQUFTLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtTQUN0QixDQUFDO0lBQ0osQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBOREssIHsgTkRLRXZlbnQsIE5ES1N1YnNjcmlwdGlvbiB9IGZyb20gXCJAbm9zdHItZGV2LWtpdC9uZGtcIjtcbmltcG9ydCB7IFN0b3JhZ2VJbnRlcmZhY2UgfSBmcm9tIFwiQHRhdC1wcm90b2NvbC9zdG9yYWdlXCI7XG5pbXBvcnQgeyBLZXlQYWlyIH0gZnJvbSBcIkB0YXQtcHJvdG9jb2wvaGRrZXlzXCI7XG5pbXBvcnQgeyBkZWZhdWx0Q29uZmlnIH0gZnJvbSBcIkB0YXQtcHJvdG9jb2wvY29uZmlnL2RlZmF1bHRDb25maWdcIjtcbmltcG9ydCB7IE5XUENSb3V0ZXIgfSBmcm9tIFwiLi9OV1BDUm91dGVyXCI7XG5pbXBvcnQgeyBIYW5kbGVyRW5naW5lIH0gZnJvbSBcIi4vSGFuZGxlckVuZ2luZVwiO1xuaW1wb3J0IHtcbiAgTldQQ0NvbmZpZyxcbiAgTldQQ1JlcXVlc3QsXG4gIE5XUENSZXNwb25zZSxcbiAgTldQQ1JvdXRlLFxuICBOV1BDSGFuZGxlcixcbiAgTWVzc2FnZUhvb2tPcHRpb25zLFxufSBmcm9tIFwiLi9OV1BDUmVzcG9uc2VUeXBlc1wiO1xuaW1wb3J0IHtcbiAgZGVzZXJpYWxpemVEYXRhLFxuICBzZXJpYWxpemVEYXRhLFxuICBXcmFwLFxuICBXcmFwV2l0aFNpZ25lcixcbiAgRGVidWdMb2dnZXIsXG59IGZyb20gXCJAdGF0LXByb3RvY29sL3V0aWxzXCI7XG5pbXBvcnQgeyBJTldQQ0Jhc2UgfSBmcm9tIFwiLi9OV1BDQmFzZUludGVyZmFjZVwiO1xuaW1wb3J0IHsgTldQQ1N0YXRlLCBTZXJpYWxpemFibGVEYXRhIH0gZnJvbSBcIi4vTldQQ1N0YXRlXCI7XG5pbXBvcnQgeyB2NCBhcyB1dWlkdjQgfSBmcm9tIFwidXVpZFwiO1xuaW1wb3J0IHsgTFJVQ2FjaGUgfSBmcm9tIFwibHJ1LWNhY2hlXCI7XG5pbXBvcnQgeyBCbG9vbUZpbHRlciB9IGZyb20gXCJAdGF0LXByb3RvY29sL3V0aWxzXCI7XG5pbXBvcnQgdHlwZSB7IFNpZ25lciB9IGZyb20gXCJAdGF0LXByb3RvY29sL3R5cGVzXCI7XG5cbmNvbnN0IERlYnVnID0gRGVidWdMb2dnZXIuZ2V0SW5zdGFuY2UoKTtcblxuLyoqXG4gKiBCYXNlIGNsYXNzIGZvciBOV1BDIChOb3N0ciBXcmFwcGVkIFByb3RvY29sIENvbW11bmljYXRpb24pLlxuICpcbiAqIE5XUENCYXNlIHByb3ZpZGVzIHRoZSBmb3VuZGF0aW9uIGZvciBidWlsZGluZyBkZWNlbnRyYWxpemVkIGNvbW11bmljYXRpb25cbiAqIHByb3RvY29scyBvbiB0b3Agb2YgTm9zdHIuIEl0IGhhbmRsZXM6XG4gKiAtIEVuY3J5cHRlZCBtZXNzYWdlIHdyYXBwaW5nL3Vud3JhcHBpbmdcbiAqIC0gRXZlbnQgc3Vic2NyaXB0aW9uIGFuZCByb3V0aW5nXG4gKiAtIFN0YXRlIHBlcnNpc3RlbmNlIHdpdGggZGVkdXBsaWNhdGlvblxuICogLSBSZXF1ZXN0L3Jlc3BvbnNlIGhhbmRsaW5nIHZpYSBob29rc1xuICpcbiAqIEJvdGggY2xpZW50cyAoTldQQ1BlZXIpIGFuZCBzZXJ2ZXJzIChOV1BDU2VydmVyKSBleHRlbmQgdGhpcyBjbGFzcy5cbiAqXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogY2xhc3MgTXlDbGllbnQgZXh0ZW5kcyBOV1BDQmFzZSB7XG4gKiAgIHByb3RlY3RlZCBhc3luYyBoYW5kbGVFdmVudChldmVudDogTkRLRXZlbnQpIHtcbiAqICAgICAvLyBQcm9jZXNzIGluY29taW5nIGV2ZW50c1xuICogICB9XG4gKiB9XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGFic3RyYWN0IGNsYXNzIE5XUENCYXNlIGltcGxlbWVudHMgSU5XUENCYXNlIHtcbiAgcHVibGljIG5kazogTkRLO1xuICBwdWJsaWMgcm91dGVyOiBOV1BDUm91dGVyO1xuICBwcm90ZWN0ZWQgZW5naW5lOiBIYW5kbGVyRW5naW5lO1xuICBwcm90ZWN0ZWQgc3RvcmFnZTogU3RvcmFnZUludGVyZmFjZTtcbiAgLyoqIFNpZ25lciBpbnRlcmZhY2UgZm9yIGFic3RyYWN0ZWQga2V5IG1hbmFnZW1lbnQgKi9cbiAgcHJvdGVjdGVkIHNpZ25lcj86IFNpZ25lcjtcbiAgLyoqIERpcmVjdCBrZXlzIGZvciBiYWNrd2FyZHMgY29tcGF0aWJpbGl0eSAodXNlZCBpZiBzaWduZXIgbm90IHByb3ZpZGVkKSAqL1xuICBwcm90ZWN0ZWQga2V5czogS2V5UGFpcjtcbiAgLyoqIENhY2hlZCBwdWJsaWMga2V5IChyZXNvbHZlZCBmcm9tIHNpZ25lciBvbiBpbml0KSAqL1xuICBwcm90ZWN0ZWQgcHVibGljS2V5Pzogc3RyaW5nO1xuICBwcm90ZWN0ZWQgY29uZmlnOiBOV1BDQ29uZmlnO1xuICBwcm90ZWN0ZWQgcmVxdWVzdEhhbmRsZXJzOiBNYXA8c3RyaW5nLCBOV1BDUm91dGU+O1xuICBwcm90ZWN0ZWQgaG9va3M6IE1lc3NhZ2VIb29rT3B0aW9ucztcbiAgcHJvdGVjdGVkIHN0YXRlOiBOV1BDU3RhdGU7XG4gIHByb3RlY3RlZCBzdGF0ZUtleSE6IHN0cmluZztcbiAgcHJvdGVjdGVkIGNvbm5lY3RlZDogYm9vbGVhbiA9IGZhbHNlO1xuICBwcm90ZWN0ZWQgYWN0aXZlU3Vic2NyaXB0aW9uczogTWFwPHN0cmluZywgTkRLU3Vic2NyaXB0aW9uPiA9IG5ldyBNYXAoKTtcbiAgcHJpdmF0ZSBkZWR1cGxpY2F0aW9uOiBib29sZWFuID0gdHJ1ZTsgLy8gRW5hYmxlIGRlZHVwbGljYXRpb24gZm9yIGV2ZW50IHByb2Nlc3NpbmdcblxuICAvLyBIeWJyaWQgTFJVICsgQmxvb20gZmlsdGVyIGZvciBwcm9jZXNzZWQgZXZlbnRzXG4gIHByaXZhdGUgcHJvY2Vzc2VkRXZlbnRMUlU6IExSVUNhY2hlPHN0cmluZywgdHJ1ZT47XG4gIHByaXZhdGUgcHJvY2Vzc2VkRXZlbnRCbG9vbTogQmxvb21GaWx0ZXI7XG4gIHByaXZhdGUgc3RhdGljIEJMT09NX0VYUEVDVEVEX0lURU1TID0gMTUwMDA7XG4gIHByaXZhdGUgc3RhdGljIEJMT09NX0VSUk9SX1JBVEUgPSAwLjAxO1xuICBwcml2YXRlIHN0YXRpYyBMUlVfU0laRSA9IDEwMDA7XG5cbiAgLy8gU2F2ZSBxdWV1ZSBsb2NrIHRvIHNlcmlhbGl6ZSBzdGF0ZSBzYXZlc1xuICBwcml2YXRlIHNhdmVMb2NrOiBQcm9taXNlPHZvaWQ+ID0gUHJvbWlzZS5yZXNvbHZlKCk7XG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemVzIHRoZSBOV1BDIGluc3RhbmNlLlxuICAgKlxuICAgKiBUaGlzIG1ldGhvZCBtdXN0IGJlIGNhbGxlZCBhZnRlciBjb25zdHJ1Y3Rpb24uIEl0IGNvbm5lY3RzIHRvIHJlbGF5cyxcbiAgICogbG9hZHMgc2F2ZWQgc3RhdGUsIGFuZCBzZXRzIHVwIGluaXRpYWwgc3Vic2NyaXB0aW9ucy4gU2FmZSB0byBjYWxsXG4gICAqIG11bHRpcGxlIHRpbWVzIChpZGVtcG90ZW50KS5cbiAgICpcbiAgICogQGV4YW1wbGVcbiAgICogYGBgdHlwZXNjcmlwdFxuICAgKiBjb25zdCBjbGllbnQgPSBuZXcgTXlDbGllbnQoY29uZmlnKTtcbiAgICogYXdhaXQgY2xpZW50LmluaXQoKTtcbiAgICogLy8gQ2xpZW50IGlzIG5vdyByZWFkeSB0byBzZW5kL3JlY2VpdmUgbWVzc2FnZXNcbiAgICogYGBgXG4gICAqL1xuICBwdWJsaWMgYXN5bmMgaW5pdCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBMb2FkIHN0YXRlIGZyb20gc3RvcmFnZSBpZiBhdmFpbGFibGVcbiAgICAvLyBDb25uZWN0IGFuZCBzdWJzY3JpYmUgYWZ0ZXIgc3RhdGUgaXMgbG9hZGVkXG4gICAgRGVidWcubG9nKFwiaW5pdFwiLCBcIk5XUENCYXNlXCIpO1xuICAgIERlYnVnLmxvZyhcIlN0b3JhZ2UgaW5pdGlhbGl6ZWRcIiwgXCJOV1BDQmFzZVwiKTtcblxuICAgIC8vIFJlc29sdmUgcHVibGljIGtleSBmcm9tIHNpZ25lciBvciBrZXlzXG4gICAgaWYgKHRoaXMuc2lnbmVyKSB7XG4gICAgICB0aGlzLnB1YmxpY0tleSA9IGF3YWl0IHRoaXMuc2lnbmVyLmdldFB1YmxpY0tleSgpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5rZXlzPy5wdWJsaWNLZXkpIHtcbiAgICAgIHRoaXMucHVibGljS2V5ID0gdGhpcy5rZXlzLnB1YmxpY0tleTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmNvbm5lY3QoKTtcbiAgICBpZiAodGhpcy5wdWJsaWNLZXkpIHtcbiAgICAgIGF3YWl0IHRoaXMuc3Vic2NyaWJlKFxuICAgICAgICB0aGlzLnB1YmxpY0tleSxcbiAgICAgICAgdGhpcy5oYW5kbGVFdmVudC5iaW5kKHRoaXMpLFxuICAgICAgKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHF1ZXVlU2F2ZVN0YXRlKGtleTogc3RyaW5nLCBzdGF0ZTogTldQQ1N0YXRlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5zYXZlTG9jayA9IHRoaXMuc2F2ZUxvY2sudGhlbigoKSA9PiB0aGlzLnNhdmVTdGF0ZShrZXksIHN0YXRlKSk7XG4gICAgcmV0dXJuIHRoaXMuc2F2ZUxvY2s7XG4gIH1cblxuICBjb25zdHJ1Y3Rvcihjb25maWc6IE5XUENDb25maWcpIHtcbiAgICB0aGlzLmNvbmZpZyA9IGNvbmZpZztcbiAgICAvLyBTdG9yZSBzaWduZXIgaWYgcHJvdmlkZWQgKHRha2VzIHByZWNlZGVuY2Ugb3ZlciBrZXlzKVxuICAgIHRoaXMuc2lnbmVyID0gY29uZmlnLnNpZ25lcjtcbiAgICAvLyBLZWVwIGtleXMgZm9yIGJhY2t3YXJkcyBjb21wYXRpYmlsaXR5XG4gICAgdGhpcy5rZXlzID0gY29uZmlnLmtleXMgfHwgeyBzZWNyZXRLZXk6IFwiXCIsIHB1YmxpY0tleTogXCJcIiB9O1xuICAgIHRoaXMubmRrID0gbmV3IE5ESyh7XG4gICAgICBleHBsaWNpdFJlbGF5VXJsczogY29uZmlnLnJlbGF5cyB8fCBkZWZhdWx0Q29uZmlnLnJlbGF5cyxcbiAgICB9KTtcblxuICAgIHRoaXMucmVxdWVzdEhhbmRsZXJzID0gY29uZmlnLnJlcXVlc3RIYW5kbGVycyB8fCBuZXcgTWFwKCk7XG4gICAgLy8gVXNlIHByb3ZpZGVkIHN0b3JhZ2UgZGlyZWN0bHkgaWYgcHJlc2VudCwgb3RoZXJ3aXNlIHRocm93XG4gICAgRGVidWcubG9nKFwiY29uc3RydWN0b3I6IGNvbmZpZy5zdG9yYWdlXCIgKyBjb25maWcuc3RvcmFnZSwgXCJOV1BDQmFzZVwiKTtcbiAgICBpZiAoY29uZmlnLnN0b3JhZ2UpIHtcbiAgICAgIHRoaXMuc3RvcmFnZSA9IGNvbmZpZy5zdG9yYWdlO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiQSBTdG9yYWdlSW50ZXJmYWNlIGltcGxlbWVudGF0aW9uIG11c3QgYmUgcHJvdmlkZWQgZm9yIE5XUENCYXNlLlwiLFxuICAgICAgKTtcbiAgICB9XG4gICAgdGhpcy5ob29rcyA9IGNvbmZpZy5ob29rcyB8fCB7fTtcbiAgICB0aGlzLnN0YXRlID0ge1xuICAgICAgcmVsYXlzOiBuZXcgU2V0KCksXG4gICAgICAvLyBwcm9jZXNzZWRFdmVudElkczogbmV3IFNldCgpLCAvLyBObyBsb25nZXIgdXNlZCBmb3IgcnVudGltZSBjaGVja3NcbiAgICB9O1xuICAgIHRoaXMucm91dGVyID0gbmV3IE5XUENSb3V0ZXIodGhpcy5yZXF1ZXN0SGFuZGxlcnMpO1xuICAgIHRoaXMuZW5naW5lID0gbmV3IEhhbmRsZXJFbmdpbmUoKTtcbiAgICAvLyBJbml0aWFsaXplIExSVSBjYWNoZSBhbmQgQmxvb20gZmlsdGVyXG4gICAgdGhpcy5wcm9jZXNzZWRFdmVudExSVSA9IG5ldyBMUlVDYWNoZSh7IG1heDogTldQQ0Jhc2UuTFJVX1NJWkUgfSk7XG4gICAgdGhpcy5wcm9jZXNzZWRFdmVudEJsb29tID0gbmV3IEJsb29tRmlsdGVyKFxuICAgICAgTldQQ0Jhc2UuQkxPT01fRVhQRUNURURfSVRFTVMsXG4gICAgICBOV1BDQmFzZS5CTE9PTV9FUlJPUl9SQVRFLFxuICAgICk7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgY29ubmVjdCgpOiBQcm9taXNlPE5XUENCYXNlPiB7XG4gICAgaWYgKHRoaXMuY29ubmVjdGVkKSB7XG4gICAgICBEZWJ1Zy5sb2coXCJhbHJlYWR5IGNvbm5lY3RlZFwiICsgdGhpcy5zdGF0ZS5yZWxheXMsIFwiTldQQ0Jhc2VcIik7XG4gICAgICByZXR1cm4gdGhpcztcbiAgICB9XG4gICAgYXdhaXQgdGhpcy5uZGsuY29ubmVjdCgpO1xuXG4gICAgdGhpcy5jb25uZWN0ZWQgPSB0cnVlO1xuICAgIERlYnVnLmxvZyhcbiAgICAgIFwiY29ubmVjdGVkXCIgKyB0aGlzLm5kay5wb29sLmNvbm5lY3RlZFJlbGF5cygpLm1hcCgocmVsYXkpID0+IHJlbGF5LnVybCksXG4gICAgICBcIk5XUENCYXNlXCIsXG4gICAgKTtcbiAgICBjb25zdCByZWxheXMgPSB0aGlzLm5kay5wb29sLmNvbm5lY3RlZFJlbGF5cygpLm1hcCgocmVsYXkpID0+IHJlbGF5LnVybCk7XG4gICAgdGhpcy5zdGF0ZS5yZWxheXMgPSBuZXcgU2V0KFsuLi50aGlzLnN0YXRlLnJlbGF5cywgLi4ucmVsYXlzXSk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgZGlzY29ubmVjdCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBEZWJ1Zy5sb2coXCJkaXNjb25uZWN0XCIsIFwiTldQQ0Jhc2VcIik7XG4gICAgaWYgKCF0aGlzLmNvbm5lY3RlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMuY29ubmVjdGVkID0gZmFsc2U7XG4gIH1cblxuICBwdWJsaWMgdXNlKG1ldGhvZDogc3RyaW5nLCAuLi5oYW5kbGVyczogTldQQ0hhbmRsZXJbXSk6IHZvaWQge1xuICAgIHJldHVybiB0aGlzLnJvdXRlci51c2UobWV0aG9kLCAuLi5oYW5kbGVycyk7XG4gIH1cblxuICBwdWJsaWMgZ2V0QWN0aXZlU3Vic2NyaXB0aW9ucygpOiBNYXA8c3RyaW5nLCBhbnk+IHtcbiAgICByZXR1cm4gdGhpcy5hY3RpdmVTdWJzY3JpcHRpb25zID8/IG5ldyBNYXAoKTtcbiAgfVxuXG4gIHB1YmxpYyBnZXRTdWJzY3JpcHRpb24ocHVia2V5OiBzdHJpbmcpOiBOREtTdWJzY3JpcHRpb24gfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLmFjdGl2ZVN1YnNjcmlwdGlvbnM/LmdldChwdWJrZXkpO1xuICB9XG5cbiAgLy8gSHlicmlkIGR1cGxpY2F0ZSBkZXRlY3Rpb25cbiAgcHVibGljIGlzRXZlbnRQcm9jZXNzZWQoZXZlbnRJZDogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgaWYgKHRoaXMuZGVkdXBsaWNhdGlvbikge1xuICAgICAgaWYgKHRoaXMucHJvY2Vzc2VkRXZlbnRMUlUuaGFzKGV2ZW50SWQpKSByZXR1cm4gdHJ1ZTtcbiAgICAgIGlmICh0aGlzLnByb2Nlc3NlZEV2ZW50Qmxvb20uY29udGFpbnMoZXZlbnRJZCkpIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBwdWJsaWMgbWFya0V2ZW50UHJvY2Vzc2VkKGV2ZW50SWQ6IHN0cmluZykge1xuICAgIGlmICh0aGlzLmRlZHVwbGljYXRpb24pIHtcbiAgICAgIHRoaXMucHJvY2Vzc2VkRXZlbnRMUlUuc2V0KGV2ZW50SWQsIHRydWUpO1xuICAgICAgdGhpcy5wcm9jZXNzZWRFdmVudEJsb29tLmFkZChldmVudElkKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU3Vic2NyaWJlcyB0byBlbmNyeXB0ZWQgbWVzc2FnZXMgZm9yIGEgc3BlY2lmaWMgcHVibGljIGtleS5cbiAgICpcbiAgICogQ3JlYXRlcyBhIE5vc3RyIHN1YnNjcmlwdGlvbiBmaWx0ZXJlZCB0byBraW5kIDEwNTkgKGdpZnQtd3JhcHBlZCkgZXZlbnRzXG4gICAqIHRhZ2dlZCB3aXRoIHRoZSBzcGVjaWZpZWQgcHVibGljIGtleS4gVGhlIGhhbmRsZXIgaXMgY2FsbGVkIGZvciBlYWNoXG4gICAqIG1hdGNoaW5nIGV2ZW50LiBBdXRvbWF0aWNhbGx5IHByZXZlbnRzIGR1cGxpY2F0ZSBldmVudCBwcm9jZXNzaW5nLlxuICAgKlxuICAgKiBAcGFyYW0gcHVia2V5IC0gVGhlIHB1YmxpYyBrZXkgdG8gc3Vic2NyaWJlIHRvICh0eXBpY2FsbHkgdGhlIHJlY2lwaWVudClcbiAgICogQHBhcmFtIGhhbmRsZXIgLSBBc3luYyBmdW5jdGlvbiB0byBoYW5kbGUgaW5jb21pbmcgZXZlbnRzXG4gICAqIEByZXR1cm5zIFRoZSBOREsgc3Vic2NyaXB0aW9uIG9iamVjdFxuICAgKlxuICAgKiBAZXhhbXBsZVxuICAgKiBgYGB0eXBlc2NyaXB0XG4gICAqIGF3YWl0IG53cGMuc3Vic2NyaWJlKCdteVB1YmtleScsIGFzeW5jIChldmVudCkgPT4ge1xuICAgKiAgIGNvbnN0IHVud3JhcHBlZCA9IGF3YWl0IFVud3JhcChldmVudC5jb250ZW50LCBrZXlzLCBldmVudC5wdWJrZXkpO1xuICAgKiAgIGNvbnNvbGUubG9nKCdSZWNlaXZlZCBtZXNzYWdlOicsIHVud3JhcHBlZC5jb250ZW50KTtcbiAgICogfSk7XG4gICAqIGBgYFxuICAgKi9cbiAgcHVibGljIGFzeW5jIHN1YnNjcmliZShcbiAgICBwdWJrZXk6IHN0cmluZyxcbiAgICBoYW5kbGVyOiAoZXZlbnQ6IE5ES0V2ZW50KSA9PiBQcm9taXNlPHZvaWQ+LFxuICApOiBQcm9taXNlPE5ES1N1YnNjcmlwdGlvbj4ge1xuICAgIC8vIFByZXZlbnQgZHVwbGljYXRlIHN1YnNjcmlwdGlvbnM6IFVuc3Vic2NyaWJlIGlmIGFscmVhZHkgc3Vic2NyaWJlZFxuICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5nZXRTdWJzY3JpcHRpb24ocHVia2V5KTtcbiAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgIGF3YWl0IHRoaXMudW5zdWJzY3JpYmUocHVia2V5KTtcbiAgICB9XG5cbiAgICBjb25zdCBmaWx0ZXIgPSB7XG4gICAgICBraW5kczogWzEwNTldLFxuICAgICAgXCIjcFwiOiBbcHVia2V5XSxcbiAgICAgIHNpbmNlOiBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKSAtIDMgKiAyNCAqIDYwICogNjAsXG4gICAgfTtcblxuICAgIGNvbnN0IHN1YnNjcmlwdGlvbiA9IHRoaXMubmRrLnN1YnNjcmliZShmaWx0ZXIsIHtcbiAgICAgIGNsb3NlT25Fb3NlOiBmYWxzZSxcbiAgICB9KTtcblxuICAgIC8vIFNldCB1cCBldmVudCBoYW5kbGVycyBiZWZvcmUgY3JlYXRpbmcgc3Vic2NyaXB0aW9uXG4gICAgY29uc3QgZXZlbnRIYW5kbGVyID0gYXN5bmMgKGV2ZW50OiBOREtFdmVudCkgPT4ge1xuICAgICAgaWYgKHRoaXMuZGVkdXBsaWNhdGlvbiAmJiB0aGlzLmlzRXZlbnRQcm9jZXNzZWQoZXZlbnQuaWQpKSB7XG4gICAgICAgIERlYnVnLmxvZyhcbiAgICAgICAgICBgXFxuU2tpcHBpbmcgYWxyZWFkeSBwcm9jZXNzZWQgZXZlbnQ6ICR7ZXZlbnQuaWR9YCxcbiAgICAgICAgICBcIk5XUENCYXNlXCIsXG4gICAgICAgICk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIERlYnVnLmxvZyhcbiAgICAgICAgYFxcbj09PT09PT09PT09PT09PT09PT09PT09PT09PSBSZWNlaXZlZCBldmVudCBvbiBzdWJzY3JpcHRpb24gOiAke2V2ZW50LmlkfSA9PT09PT09PT09PT1cXG5cXG5gLFxuICAgICAgICBcIk5XUENCYXNlXCIsXG4gICAgICApO1xuICAgICAgYXdhaXQgaGFuZGxlcihldmVudCk7XG4gICAgICB0aGlzLm1hcmtFdmVudFByb2Nlc3NlZChldmVudC5pZCk7XG4gICAgICAvLyBVc2UgdGhlIHNhdmUgcXVldWUgdG8gc2VyaWFsaXplIHN0YXRlIHNhdmVzXG4gICAgICBhd2FpdCB0aGlzLnF1ZXVlU2F2ZVN0YXRlKHRoaXMuc3RhdGVLZXksIHRoaXMuc3RhdGUpO1xuICAgIH07XG5cbiAgICBjb25zdCBlb3NlSGFuZGxlciA9IGFzeW5jICgpID0+IHtcbiAgICAgIERlYnVnLmxvZyhcbiAgICAgICAgXCJcXG49PT09PT09PT09PT09PT09PT09PT09PT09PT0gRU9TRSByZWNlaXZlZCA9PT09PT09PT09PT09PT09PT09PT09PT09PT1cXG5cIixcbiAgICAgICAgXCJOV1BDQmFzZVwiLFxuICAgICAgKTtcbiAgICAgIC8vIFVzZSB0aGUgc2F2ZSBxdWV1ZSB0byBzZXJpYWxpemUgc3RhdGUgc2F2ZXNcbiAgICAgIGF3YWl0IHRoaXMucXVldWVTYXZlU3RhdGUodGhpcy5zdGF0ZUtleSwgdGhpcy5zdGF0ZSk7XG4gICAgfTtcblxuICAgIHN1YnNjcmlwdGlvbi5vbihcImV2ZW50XCIsIGV2ZW50SGFuZGxlcik7XG4gICAgc3Vic2NyaXB0aW9uLm9uKFwiZW9zZVwiLCBlb3NlSGFuZGxlcik7XG4gICAgdGhpcy5hY3RpdmVTdWJzY3JpcHRpb25zPy5zZXQocHVia2V5LCBzdWJzY3JpcHRpb24pO1xuICAgIHJldHVybiBzdWJzY3JpcHRpb247XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgdW5zdWJzY3JpYmUocHVia2V5OiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCBzdWIgPSB0aGlzLmdldFN1YnNjcmlwdGlvbihwdWJrZXkpO1xuICAgIHN1Yj8uc3RvcCgpO1xuICAgIHJldHVybiB0aGlzLmFjdGl2ZVN1YnNjcmlwdGlvbnM/LmRlbGV0ZShwdWJrZXkpID8/IGZhbHNlO1xuICB9XG5cbiAgLy8gSGVscGVyIHRvIHNlcmlhbGl6ZSBOV1BDU3RhdGUgc2FmZWx5XG4gIHByb3RlY3RlZCBzZXJpYWxpemVTdGF0ZShzdGF0ZTogTldQQ1N0YXRlKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xuICAgIHJldHVybiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHJlbGF5czogQXJyYXkuZnJvbShzdGF0ZS5yZWxheXMgfHwgW10pLFxuICAgICAgLy8gcHJvY2Vzc2VkRXZlbnRJZHM6IEFycmF5LmZyb20oc3RhdGUucHJvY2Vzc2VkRXZlbnRJZHMgfHwgW10pLFxuICAgICAgcHJvY2Vzc2VkRXZlbnRCbG9vbTogSlNPTi5wYXJzZSh0aGlzLnByb2Nlc3NlZEV2ZW50Qmxvb20uc2VyaWFsaXplKCkpIGFzIFNlcmlhbGl6YWJsZURhdGEsXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTYXZlcyB0aGUgY3VycmVudCBzdGF0ZSB0byBwZXJzaXN0ZW50IHN0b3JhZ2UuXG4gICAqXG4gICAqIFNlcmlhbGl6ZXMgdGhlIHN0YXRlIGluY2x1ZGluZyB0aGUgQmxvb20gZmlsdGVyIGZvciBwcm9jZXNzZWQgZXZlbnRzIGFuZFxuICAgKiB3cml0ZXMgaXQgdG8gc3RvcmFnZS4gU3RhdGUgc2F2ZXMgYXJlIHF1ZXVlZCB0byBwcmV2ZW50IHJhY2UgY29uZGl0aW9ucy5cbiAgICpcbiAgICogQHBhcmFtIGtleSAtIFRoZSBzdG9yYWdlIGtleSB0byB1c2VcbiAgICogQHBhcmFtIHN0YXRlIC0gVGhlIHN0YXRlIG9iamVjdCB0byBzYXZlXG4gICAqXG4gICAqIEBleGFtcGxlXG4gICAqIGBgYHR5cGVzY3JpcHRcbiAgICogYXdhaXQgbndwYy5zYXZlU3RhdGUoJ215LXN0YXRlLWtleScsIHRoaXMuc3RhdGUpO1xuICAgKiBgYGBcbiAgICovXG4gIHB1YmxpYyBhc3luYyBzYXZlU3RhdGUoa2V5OiBzdHJpbmcsIHN0YXRlOiBOV1BDU3RhdGUpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBQZXJzaXN0IHRoZSBCbG9vbSBmaWx0ZXIgaW4gc3RhdGVcbiAgICBzdGF0ZS5wcm9jZXNzZWRFdmVudEJsb29tID0gSlNPTi5wYXJzZSh0aGlzLnByb2Nlc3NlZEV2ZW50Qmxvb20uc2VyaWFsaXplKCkpIGFzIFNlcmlhbGl6YWJsZURhdGE7XG4gICAgY29uc3Qgc2VyaWFsaXplZFN0YXRlID0gc2VyaWFsaXplRGF0YShzdGF0ZSk7XG4gICAga2V5ID0ga2V5IHx8IFwibndwYy1iYmItbG92ZVwiO1xuICAgIGF3YWl0IHRoaXMuc3RvcmFnZS5zZXRJdGVtKGtleSwgc2VyaWFsaXplZFN0YXRlKTtcbiAgICByZXR1cm47XG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgc3RhdGUgZnJvbSBwZXJzaXN0ZW50IHN0b3JhZ2UuXG4gICAqXG4gICAqIFJldHJpZXZlcyBhbmQgZGVzZXJpYWxpemVzIHNhdmVkIHN0YXRlLCBpbmNsdWRpbmcgdGhlIEJsb29tIGZpbHRlciBmb3JcbiAgICogcHJvY2Vzc2VkIGV2ZW50cy4gSGFuZGxlcyBtaWdyYXRpb24gZnJvbSBvbGRlciBzdGF0ZSBmb3JtYXRzIHRoYXQgdXNlZFxuICAgKiBhIFNldCBpbnN0ZWFkIG9mIGEgQmxvb20gZmlsdGVyLlxuICAgKlxuICAgKiBAcGFyYW0ga2V5IC0gVGhlIHN0b3JhZ2Uga2V5IHRvIGxvYWQgZnJvbVxuICAgKiBAcmV0dXJucyBUaGUgbG9hZGVkIHN0YXRlLCBvciBudWxsIGlmIG5vIHN0YXRlIGV4aXN0c1xuICAgKlxuICAgKiBAZXhhbXBsZVxuICAgKiBgYGB0eXBlc2NyaXB0XG4gICAqIGNvbnN0IHN0YXRlID0gYXdhaXQgbndwYy5sb2FkU3RhdGUoJ215LXN0YXRlLWtleScpO1xuICAgKiBpZiAoc3RhdGUpIHtcbiAgICogICB0aGlzLnN0YXRlID0gc3RhdGU7XG4gICAqIH1cbiAgICogYGBgXG4gICAqL1xuICBwdWJsaWMgYXN5bmMgbG9hZFN0YXRlKGtleTogc3RyaW5nKTogUHJvbWlzZTxOV1BDU3RhdGUgfCBudWxsPiB7XG4gICAgY29uc3Qgc3RhdGVTdHJpbmcgPSBhd2FpdCB0aGlzLnN0b3JhZ2UuZ2V0SXRlbShrZXkpO1xuICAgIGNvbnN0IHN0YXRlID0gc3RhdGVTdHJpbmcgPyBkZXNlcmlhbGl6ZURhdGEoc3RhdGVTdHJpbmcpIDogbnVsbDtcbiAgICBpZiAoc3RhdGUpIHtcbiAgICAgIC8vIE1pZ3JhdGlvbjogSWYgcHJvY2Vzc2VkRXZlbnRJZHMgZXhpc3RzLCBhZGQgdG8gQmxvb20gZmlsdGVyXG4gICAgICBpZiAoc3RhdGUucHJvY2Vzc2VkRXZlbnRJZHMgJiYgQXJyYXkuaXNBcnJheShzdGF0ZS5wcm9jZXNzZWRFdmVudElkcykpIHtcbiAgICAgICAgZm9yIChjb25zdCBldmVudElkIG9mIHN0YXRlLnByb2Nlc3NlZEV2ZW50SWRzKSB7XG4gICAgICAgICAgdGhpcy5wcm9jZXNzZWRFdmVudEJsb29tLmFkZChldmVudElkKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBSZW1vdmUgdGhlIG9sZCBzZXQgdG8gc2F2ZSBzcGFjZVxuICAgICAgICBkZWxldGUgc3RhdGUucHJvY2Vzc2VkRXZlbnRJZHM7XG4gICAgICAgIC8vIFNhdmUgdGhlIG1pZ3JhdGVkIHN0YXRlXG4gICAgICAgIHN0YXRlLnByb2Nlc3NlZEV2ZW50Qmxvb20gPSB0aGlzLnByb2Nlc3NlZEV2ZW50Qmxvb20uc2VyaWFsaXplKCk7XG4gICAgICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKGtleSwgc3RhdGUpO1xuICAgICAgfVxuICAgICAgaWYgKHN0YXRlLnByb2Nlc3NlZEV2ZW50Qmxvb20pIHtcbiAgICAgICAgdGhpcy5wcm9jZXNzZWRFdmVudEJsb29tID0gQmxvb21GaWx0ZXIuZGVzZXJpYWxpemUoXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkoc3RhdGUucHJvY2Vzc2VkRXZlbnRCbG9vbSksXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBzdGF0ZTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBzZW5kUmVzcG9uc2UoXG4gICAgcmVzcG9uc2U6IE5XUENSZXNwb25zZSxcbiAgICByZWNpcGllbnRQdWJrZXk6IHN0cmluZyxcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLnNpZ25lciAmJiAhdGhpcy5rZXlzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTaWduZXIgb3Iga2V5cyBub3QgaW5pdGlhbGl6ZWRcIik7XG4gICAgfVxuXG4gICAgbGV0IHdyYXBwZWRFdmVudDtcbiAgICBpZiAodGhpcy5zaWduZXIpIHtcbiAgICAgIHdyYXBwZWRFdmVudCA9IGF3YWl0IFdyYXBXaXRoU2lnbmVyKFxuICAgICAgICB0aGlzLm5kayxcbiAgICAgICAgSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpLFxuICAgICAgICB0aGlzLnNpZ25lcixcbiAgICAgICAgcmVjaXBpZW50UHVia2V5LFxuICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgd3JhcHBlZEV2ZW50ID0gYXdhaXQgV3JhcChcbiAgICAgICAgdGhpcy5uZGssXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKSxcbiAgICAgICAgdGhpcy5rZXlzLFxuICAgICAgICByZWNpcGllbnRQdWJrZXksXG4gICAgICApO1xuICAgIH1cblxuICAgIGF3YWl0IHdyYXBwZWRFdmVudC5wdWJsaXNoKCk7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgYnJvYWRjYXN0UmVzcG9uc2UoXG4gICAgcmVzcG9uc2U6IE5XUENSZXNwb25zZSxcbiAgICByZWNpcGllbnRzOiBzdHJpbmdbXSxcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICByZWNpcGllbnRzLm1hcCgocHVia2V5KSA9PiB0aGlzLnNlbmRSZXNwb25zZShyZXNwb25zZSwgcHVia2V5KSksXG4gICAgKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBjcmVhdGVSZXF1ZXN0KFxuICAgIG1ldGhvZDogc3RyaW5nLFxuICAgIHBhcmFtczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gICk6IE5XUENSZXF1ZXN0IHtcbiAgICByZXR1cm4ge1xuICAgICAgaWQ6IHV1aWR2NCgpLFxuICAgICAgbWV0aG9kLFxuICAgICAgcGFyYW1zOiBKU09OLnN0cmluZ2lmeShwYXJhbXMpLFxuICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgIH07XG4gIH1cblxuICBwcm90ZWN0ZWQgYWJzdHJhY3QgaGFuZGxlRXZlbnQoZXZlbnQ6IE5ES0V2ZW50KTogUHJvbWlzZTx2b2lkPjtcbn1cbiJdfQ==
