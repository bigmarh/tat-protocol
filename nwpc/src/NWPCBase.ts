import NDK, { NDKEvent, NDKSubscription } from "@nostr-dev-kit/ndk";
import { Storage, StorageInterface } from "@tat-protocol/storage";
import { KeyPair } from "@tat-protocol/hdkeys";
import { defaultConfig } from "@tat-protocol/config/defaultConfig";
import { NWPCRouter } from "./NWPCRouter";
import { HandlerEngine } from "./HandlerEngine";
import {
  NWPCConfig,
  NWPCRequest,
  NWPCResponse,
  NWPCRoute,
  NWPCHandler,
  MessageHookOptions,
} from "./NWPCResponseTypes";
import { deserializeData, serializeData, Wrap } from "@tat-protocol/utils";
import { INWPCBase } from "./NWPCBaseInterface";
import { NWPCState } from "./NWPCState";

export abstract class NWPCBase implements INWPCBase {
  public ndk: NDK;
  public router: NWPCRouter;
  protected engine: HandlerEngine;
  protected storage: StorageInterface;
  protected keys: KeyPair;
  protected config: NWPCConfig;
  protected requestHandlers: Map<string, NWPCRoute>;
  protected hooks: MessageHookOptions;
  protected state: NWPCState;
  protected stateKey!: string;
  protected connected: boolean = false;
  protected activeSubscriptions: Map<string, NDKSubscription> = new Map();

  // Save queue lock to serialize state saves
  private saveLock: Promise<void> = Promise.resolve();

  /**
   * Call this after construction and before using the instance.
   * Example:
   *   const obj = new NWPCBase(config);
   *   await obj.init();
   */
  public async init(): Promise<void> {
    // Load state from storage if available
    // Connect and subscribe after state is loaded
    await this.connect();
    if (this.keys) {
      await this.subscribe(
        this.keys.publicKey || "",
        this.handleEvent.bind(this)
      );
    }
  }

  private async queueSaveState(key: string, state: NWPCState): Promise<void> {
    this.saveLock = this.saveLock.then(() => this.saveState(key, state));
    return this.saveLock;
  }

  constructor(config: NWPCConfig) {
    this.config = config;
    this.keys = config.keys || { secretKey: "", publicKey: "" };
    this.ndk = new NDK({
      explicitRelayUrls: config.relays || defaultConfig.relays,
    });
    this.requestHandlers = config.requestHandlers || new Map();
    this.storage = new Storage(config.storage);
    this.hooks = config.hooks || {};
    this.state = {
      relays: new Set(),
      processedEventIds: new Set(),
    };
    this.router = new NWPCRouter(this.requestHandlers);
    this.engine = new HandlerEngine();
  }

  public async connect(): Promise<NWPCBase> {
    if (this.connected) {
      console.log("NWPCBase: already connected", this.state.relays);
      return this;
    }
    await this.ndk.connect();

    this.connected = true;
    console.log(
      "NWPCBase: connected",
      this.ndk.pool.connectedRelays().map((relay) => relay.url),
    );
    const relays = this.ndk.pool.connectedRelays().map((relay) => relay.url);
    this.state.relays = new Set([...this.state.relays, ...relays]);
    return this;
  }

  public async disconnect(): Promise<void> {
    console.log("NWPCBase: disconnect");
    if (!this.connected) {
      return;
    }

    this.connected = false;
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

  // Helper to serialize NWPCState safely
  protected serializeState(state: NWPCState): any {
    return {
      ...state,
      relays: Array.from(state.relays || []),
      processedEventIds: Array.from(state.processedEventIds || []),
    };
  }

  public async subscribe(
    pubkey: string,
    handler: (event: NDKEvent) => Promise<void>,
  ): Promise<NDKSubscription> {
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
    const eventHandler = async (event: NDKEvent) => {
      if (this.state.processedEventIds.has(event.id)) {
        console.log(`\nSkipping already processed event: ${event.id}`);
        return;
      }
      console.log(
        `\n=========================== NWPCBase: Received event on subscription : ${event.id} ============\n\n`,
      );
      await handler(event);
      this.state.processedEventIds.add(event.id);
      // Use the save queue to serialize state saves
      await this.queueSaveState(this.stateKey, this.state);
    };

    const eoseHandler = async () => {
      console.log(
        "\n=========================== NWPCBase: EOSE received ===========================\n",
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

  public async saveState(key: string, state: NWPCState): Promise<void> {
    const serializedState = serializeData(state);
    key = key || "nwpc-bbb-love";
    await this.storage.setItem(key, serializedState);
    return;
  }

  public async loadState(key: string): Promise<any> {
    const stateString = await this.storage.getItem(key);
    return stateString ? deserializeData(stateString) : null;
  }

  public async sendResponse(
    response: NWPCResponse,
    recipientPubkey: string,
  ): Promise<void> {

    if (!this.keys) {
      throw new Error("Keys not initialized");
    }

    const wrappedEvent = await Wrap(
      this.ndk,
      JSON.stringify(response),
      this.keys,
      recipientPubkey,
    );
  

    await wrappedEvent.publish();
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
    params: Record<string, any>,
  ): NWPCRequest {
    return {
      id: Math.random().toString(36).substring(7),
      method,
      params: JSON.stringify(params),
      timestamp: Date.now(),
    };
  }

  protected abstract handleEvent(event: NDKEvent): Promise<void>;
}
