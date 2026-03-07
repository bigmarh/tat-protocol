import NDK, { NDKEvent, NDKSubscription } from "@nostr-dev-kit/ndk";
import { StorageInterface } from "@tat-protocol/storage";
import { KeyPair } from "@tat-protocol/hdkeys";
import { defaultConfig } from "@tat-protocol/config";
import { NWPCRouter } from "./NWPCRouter.js";
import { HandlerEngine } from "./HandlerEngine.js";
import {
  NWPCConfig,
  NWPCRequest,
  NWPCResponse,
  NWPCRoute,
  NWPCHandler,
  MessageHookOptions,
} from "./NWPCResponseTypes.js";
import {
  deserializeData,
  serializeData,
  Wrap,
  WrapWithSigner,
  DebugLogger,
} from "@tat-protocol/utils";
import { INWPCBase } from "./NWPCBaseInterface.js";
import { NWPCState, SerializableData } from "./NWPCState.js";
import { v4 as uuidv4 } from "uuid";
import { LRUCache } from "lru-cache";
import { BloomFilter } from "@tat-protocol/utils";
import type { Signer } from "@tat-protocol/types";

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
export abstract class NWPCBase implements INWPCBase {
  public ndk: NDK;
  public router: NWPCRouter;
  protected engine: HandlerEngine;
  protected storage: StorageInterface;
  /** Signer interface for abstracted key management */
  protected signer?: Signer;
  /** Direct keys for backwards compatibility (used if signer not provided) */
  protected keys: KeyPair;
  /** Cached public key (resolved from signer on init) */
  protected publicKey?: string;
  protected config: NWPCConfig;
  protected requestHandlers: Map<string, NWPCRoute>;
  protected hooks: MessageHookOptions;
  protected state: NWPCState;
  protected stateKey!: string;
  protected connected: boolean = false;
  protected activeSubscriptions: Map<string, NDKSubscription> = new Map();
  private deduplication: boolean = true; // Enable deduplication for event processing
  private _keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private _keepaliveTick = 0;

  // Hybrid LRU + Bloom filter for processed events
  private processedEventLRU: LRUCache<string, true>;
  private processedEventBloom: BloomFilter;
  private static BLOOM_EXPECTED_ITEMS = 15000;
  private static BLOOM_ERROR_RATE = 0.01;
  private static LRU_SIZE = 1000;

  // Save queue lock to serialize state saves
  private saveLock: Promise<void> = Promise.resolve();

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
  public async init(): Promise<void> {
    // Load state from storage if available
    // Connect and subscribe after state is loaded
    Debug.log("init", "NWPCBase");
    Debug.log("Storage initialized", "NWPCBase");

    // Resolve public key from signer or keys
    if (this.signer) {
      this.publicKey = await this.signer.getPublicKey();
    } else if (this.keys?.publicKey) {
      this.publicKey = this.keys.publicKey;
    }

    await this.connect();
    if (this.publicKey) {
      await this.subscribe(this.publicKey, this.handleEvent.bind(this));
    }
  }

  protected async queueSaveState(key: string, state: NWPCState): Promise<void> {
    this.saveLock = this.saveLock
      .catch(() => {})
      .then(() =>
        this.saveState(key, state).catch((err) => {
          console.error("[NWPCBase] saveState failed:", err);
        }),
      );
    return this.saveLock;
  }

  constructor(config: NWPCConfig) {
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
    } else {
      throw new Error(
        "A StorageInterface implementation must be provided for NWPCBase.",
      );
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
    this.processedEventBloom = new BloomFilter(
      NWPCBase.BLOOM_EXPECTED_ITEMS,
      NWPCBase.BLOOM_ERROR_RATE,
    );
  }

  public async connect(): Promise<NWPCBase> {
    if (this.connected) {
      Debug.log("already connected" + this.state.relays, "NWPCBase");
      return this;
    }
    // Pass a timeout so connect() proceeds as soon as the first relay is
    // up rather than blocking until every relay in the pool has connected.
    // NDK's default (no timeout) uses Promise.race with a never-resolving
    // promise, effectively waiting for ALL relays — up to ~2s with remote relays.
    await this.ndk.connect(1500);

    this.connected = true;
    Debug.log(
      "connected" + this.ndk.pool.connectedRelays().map((relay) => relay.url),
      "NWPCBase",
    );
    const relays = this.ndk.pool.connectedRelays().map((relay) => relay.url);
    this.state.relays = new Set([...this.state.relays, ...relays]);
    return this;
  }

  /**
   * Check that at least one relay has a truly open WebSocket.
   * NDK's `connectedRelays()` only checks its internal status enum, NOT the
   * actual `ws.readyState`, so after idle/sleep it reports stale relays as
   * connected.  We use `relay.connected` which checks BOTH.
   * If every relay is dead, force-disconnect them all and reconnect.
   */
  public async ensureConnected(): Promise<void> {
    const relays = Array.from(this.ndk.pool.relays.values());
    const live = relays.filter((r) => r.connected).length;
    if (live > 0) return;

    Debug.log(
      `All ${relays.length} relays have dead WebSockets — forcing reconnect`,
      "NWPCBase",
    );

    // Force-disconnect each relay so NDK resets its internal status.
    for (const relay of relays) {
      try { relay.disconnect(); } catch { /* ignore */ }
    }
    this.connected = false;

    await this.ndk.connect(3000);
    this.connected = true;

    const reconnected = this.ndk.pool
      .connectedRelays()
      .map((r) => r.url);
    Debug.log("Reconnected to " + reconnected.join(", "), "NWPCBase");
    this.state.relays = new Set([...this.state.relays, ...reconnected]);

    // Re-subscribe so incoming messages are received on fresh connections.
    if (this.publicKey) {
      await this.subscribe(this.publicKey, this.handleEvent.bind(this));
    }
  }

  public async disconnect(): Promise<void> {
    Debug.log("disconnect", "NWPCBase");
    this.stopKeepalive();
    if (!this.connected) {
      return;
    }

    this.connected = false;
  }

  /**
   * Start a periodic keepalive that detects dead relay connections and
   * re-subscribes before the server goes deaf.
   *
   * Every tick: calls ensureConnected() (catches relays whose WebSocket
   * readyState has flipped to CLOSED).
   *
   * Every ~5 minutes: forces a fresh subscribe().  Re-subscribing sends a
   * REQ to the relay; if the socket is silently dead (readyState still OPEN
   * but the intermediate LB dropped the TCP session) the write will fail and
   * NDK marks the relay disconnected, so the next tick reconnects.
   */
  public startKeepalive(intervalMs = 30_000): void {
    this.stopKeepalive();
    this._keepaliveTick = 0;
    const refreshEvery = Math.max(1, Math.ceil(300_000 / intervalMs));

    this._keepaliveTimer = setInterval(async () => {
      try {
        this._keepaliveTick++;
        await this.ensureConnected();

        // Periodic full re-subscribe to catch silently-dead sockets
        if (this._keepaliveTick % refreshEvery === 0 && this.publicKey) {
          Debug.log("Keepalive: refreshing subscription", "NWPCBase");
          await this.subscribe(this.publicKey, this.handleEvent.bind(this));
        }
      } catch (err) {
        Debug.error("Keepalive error: " + err, "NWPCBase");
      }
    }, intervalMs);
  }

  public stopKeepalive(): void {
    if (this._keepaliveTimer) {
      clearInterval(this._keepaliveTimer);
      this._keepaliveTimer = null;
    }
  }

  public use(method: string, ...handlers: NWPCHandler[]): void {
    return this.router.use(method, ...handlers);
  }

  public getActiveSubscriptions(): Map<string, any> {
    return this.activeSubscriptions ?? new Map();
  }

  public getSubscription(pubkey: string): NDKSubscription | undefined {
    return this.activeSubscriptions?.get(pubkey);
  }

  /**
   * Get the public key for this NWPC instance
   * @returns The public key string
   */
  public getPublicKey(): string | undefined {
    return this.publicKey;
  }

  // Hybrid duplicate detection
  public isEventProcessed(eventId: string): boolean {
    if (this.deduplication) {
      if (this.processedEventLRU.has(eventId)) return true;
      if (this.processedEventBloom.contains(eventId)) return true;
    }
    return false;
  }

  public markEventProcessed(eventId: string) {
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
  public async subscribe(
    pubkey: string,
    handler: (event: NDKEvent) => Promise<void>,
    since?: number,
  ): Promise<NDKSubscription> {
    // Prevent duplicate subscriptions: Unsubscribe if already subscribed
    const existing = this.getSubscription(pubkey);
    if (existing) {
      await this.unsubscribe(pubkey);
    }

    const filter = {
      kinds: [1059],
      "#p": [pubkey],
      since: since ?? Math.floor(Date.now() / 1000) - 10 * 60,
    };

    const subscription = this.ndk.subscribe(filter, {
      closeOnEose: false,
    });

    // Set up event handlers before creating subscription
    const eventHandler = async (event: NDKEvent) => {
      if (this.deduplication && this.isEventProcessed(event.id)) {
        Debug.log(
          `\nSkipping already processed event: ${event.id}`,
          "NWPCBase",
        );
        return;
      }
      Debug.log(
        `\n=========================== Received event on subscription : ${event.id} ============\n\n`,
        "NWPCBase",
      );
      await handler(event);
      this.markEventProcessed(event.id);
      // Use the save queue to serialize state saves
      await this.queueSaveState(this.stateKey, this.state);
    };

    const eoseHandler = async () => {
      Debug.log(
        "\n=========================== EOSE received ===========================\n",
        "NWPCBase",
      );
      // Use the save queue to serialize state saves
      await this.queueSaveState(this.stateKey, this.state);
    };

    subscription.on("event", eventHandler);
    subscription.on("eose", eoseHandler);
    this.activeSubscriptions?.set(pubkey, subscription);
    return subscription;
  }

  public async unsubscribe(pubkey: string): Promise<boolean> {
    const sub = this.getSubscription(pubkey);
    sub?.stop();
    return this.activeSubscriptions?.delete(pubkey) ?? false;
  }

  // Helper to serialize NWPCState safely
  protected serializeState(state: NWPCState): Record<string, unknown> {
    return {
      ...state,
      relays: Array.from(state.relays || []),
      // processedEventIds: Array.from(state.processedEventIds || []),
      processedEventBloom: JSON.parse(
        this.processedEventBloom.serialize(),
      ) as SerializableData,
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
  public async saveState(key: string, state: NWPCState): Promise<void> {
    // Persist the Bloom filter in state
    state.processedEventBloom = JSON.parse(
      this.processedEventBloom.serialize(),
    ) as SerializableData;
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
  public async loadState(key: string): Promise<NWPCState | null> {
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
        this.processedEventBloom = BloomFilter.deserialize(
          JSON.stringify(state.processedEventBloom),
        );
      }
    }
    return state;
  }

  public async sendResponse(
    response: NWPCResponse,
    recipientPubkey: string,
  ): Promise<void> {
    if (!this.signer && !this.keys) {
      throw new Error("Signer or keys not initialized");
    }

    await this.ensureConnected();

    let wrappedEvent;
    if (this.signer) {
      wrappedEvent = await WrapWithSigner(
        this.ndk,
        JSON.stringify(response),
        this.signer,
        recipientPubkey,
      );
    } else {
      wrappedEvent = await Wrap(
        this.ndk,
        JSON.stringify(response),
        this.keys,
        recipientPubkey,
      );
    }

    // Same first-relay-wins pattern as NWPCPeer.request(): resolve as soon as
    // one relay ACKs rather than waiting for all relays via Promise.all.
    await new Promise<void>((resolve, reject) => {
      const onFirstAck = () => {
        resolve();
      };
      wrappedEvent.once("relay:published", onFirstAck);
      wrappedEvent
        .publish()
        .then(() => {
          wrappedEvent.off("relay:published", onFirstAck);
          resolve();
        })
        .catch((err) => {
          wrappedEvent.off("relay:published", onFirstAck);
          reject(err as Error);
        });
    });
  }

  public async broadcastResponse(
    response: NWPCResponse,
    recipients: string[],
  ): Promise<void> {
    await Promise.all(
      recipients.map((pubkey) => this.sendResponse(response, pubkey)),
    );
  }

  protected createRequest(
    method: string,
    params: Record<string, unknown>,
  ): NWPCRequest {
    return {
      id: uuidv4(),
      method,
      params: JSON.stringify(params),
      timestamp: Date.now(),
    };
  }

  protected abstract handleEvent(event: NDKEvent): Promise<void>;
}
