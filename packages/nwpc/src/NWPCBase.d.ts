import NDK, { NDKEvent, NDKSubscription } from "@nostr-dev-kit/ndk";
import { StorageInterface } from "@tat-protocol/storage";
import { KeyPair } from "@tat-protocol/hdkeys";
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
import { INWPCBase } from "./NWPCBaseInterface";
import { NWPCState } from "./NWPCState";
import type { Signer } from "@tat-protocol/types";
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
export declare abstract class NWPCBase implements INWPCBase {
  ndk: NDK;
  router: NWPCRouter;
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
  protected stateKey: string;
  protected connected: boolean;
  protected activeSubscriptions: Map<string, NDKSubscription>;
  private deduplication;
  private processedEventLRU;
  private processedEventBloom;
  private static BLOOM_EXPECTED_ITEMS;
  private static BLOOM_ERROR_RATE;
  private static LRU_SIZE;
  private saveLock;
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
  init(): Promise<void>;
  private queueSaveState;
  constructor(config: NWPCConfig);
  connect(): Promise<NWPCBase>;
  disconnect(): Promise<void>;
  use(method: string, ...handlers: NWPCHandler[]): void;
  getActiveSubscriptions(): Map<string, any>;
  getSubscription(pubkey: string): NDKSubscription | undefined;
  isEventProcessed(eventId: string): boolean;
  markEventProcessed(eventId: string): void;
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
  subscribe(
    pubkey: string,
    handler: (event: NDKEvent) => Promise<void>,
  ): Promise<NDKSubscription>;
  unsubscribe(pubkey: string): Promise<boolean>;
  protected serializeState(state: NWPCState): Record<string, unknown>;
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
  saveState(key: string, state: NWPCState): Promise<void>;
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
  loadState(key: string): Promise<NWPCState | null>;
  sendResponse(response: NWPCResponse, recipientPubkey: string): Promise<void>;
  broadcastResponse(
    response: NWPCResponse,
    recipients: string[],
  ): Promise<void>;
  protected createRequest(
    method: string,
    params: Record<string, unknown>,
  ): NWPCRequest;
  protected abstract handleEvent(event: NDKEvent): Promise<void>;
}
