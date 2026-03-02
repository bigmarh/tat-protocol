import { NDKEvent } from "@nostr-dev-kit/ndk";
import {
  NWPCRequest,
  NWPCResponse,
  NWPCContext,
  NWPCResponseObject,
  NWPCConfig,
} from "./NWPCResponseTypes.js";
import {
  Wrap,
  Unwrap,
  WrapWithSigner,
  UnwrapWithSigner,
  DebugLogger,
} from "@tat-protocol/utils";
import { NWPCBase } from "./NWPCBase.js";
import { KeyPair } from "@tat-protocol/hdkeys";
import type { Signer } from "@tat-protocol/types";

const Debug = DebugLogger.getInstance();

/**
 * NWPC Peer implementation for client-side communication.
 *
 * NWPCPeer extends NWPCBase to provide client-side functionality for making
 * requests to NWPC servers and handling responses. It manages request/response
 * correlation, timeouts, and can also handle incoming requests (peer-to-peer).
 *
 * Key features:
 * - Send requests and await responses
 * - Automatic request/response matching by ID
 * - Configurable timeouts
 * - Support for both client and peer-to-peer modes
 *
 * @example
 * ```typescript
 * const peer = new NWPCPeer({
 *   keys: myKeys,
 *   storage: myStorage,
 *   relays: ['wss://relay.example.com']
 * });
 * await peer.init();
 *
 * // Make a request
 * const response = await peer.request('methodName', { param: 'value' }, 'serverPubkey');
 * ```
 */
export class NWPCPeer extends NWPCBase {
  protected responseHandlers: Map<
    string,
    {
      resolve: (response: NWPCResponse) => void;
      reject: (error: Error) => void;
      timeoutId: ReturnType<typeof setTimeout>;
    }
  >;

  constructor(config: NWPCConfig) {
    super(config);

    this.responseHandlers = new Map();
    // Bind handleEvent to this instance
    this.handleEvent = this.handleEvent.bind(this);
  }

  protected async handleEvent(event: NDKEvent): Promise<void> {
    try {
      // Use signer-based unwrap if signer is available, otherwise fall back to keys
      let unwrapped;
      if (this.signer) {
        unwrapped = await UnwrapWithSigner(
          event.content,
          this.signer,
          event.pubkey,
        );
      } else {
        unwrapped = await Unwrap(event.content, this.keys, event.pubkey);
      }
      if (!unwrapped) {
        Debug.log("Failed to unwrap event:" + event.id, "NWPCPeer");
        return;
      }

      const message = JSON.parse(unwrapped.content);

      const context: NWPCContext = {
        event,
        poster: event.pubkey,
        sender: unwrapped.sender,
        recipient: this.publicKey || (this.keys.publicKey as string),
      };

      // Check if it's a response to our request
      if (this.responseHandlers.has(message.id)) {
        if (this.hooks.beforeResponse) {
          const shouldContinue = await this.hooks.beforeResponse(
            message,
            context,
          );
          if (!shouldContinue) return;
        }

        const handler = this.responseHandlers.get(message.id);
        if (handler) {
          clearTimeout(handler.timeoutId);
          this.responseHandlers.delete(message.id);
          handler.resolve(message as NWPCResponse);

          if (this.hooks.afterResponse) {
            await this.hooks.afterResponse(message, context);
          }
        }
      } else if ("method" in message) {
        if (this.hooks.beforeRequest) {
          const shouldContinue = await this.hooks.beforeRequest(
            message,
            context,
          );
          if (!shouldContinue) return;
        }

        // Handle as a request
        const request = message as NWPCRequest;
        const handler = this.requestHandlers.get(request.method);
        if (handler) {
          const res = new NWPCResponseObject(request.id, this, context);
          const response = await this.router.handle(request, context, res);
          Debug.log("handleEvent:" + response, "NWPCPeer");
          await this.sendResponse(response, event.pubkey);

          if (this.hooks.afterRequest) {
            await this.hooks.afterRequest(message, context);
          }
        } else {
          Debug.log(
            "No handler found for method:" + request.method,
            "NWPCPeer",
          );
        }
      } else {
        Debug.log(
          "handleEvent: Unknown message type:" + message.result,
          "NWPCPeer",
        );
      }
    } catch (error) {
      Debug.error("Error in handleEvent:" + error, "NWPCPeer");
    }
  }

  /**
   * Sends a request to a remote NWPC peer or server.
   *
   * Creates and sends an encrypted request, then waits for a response with the
   * matching ID. The request is wrapped using Nostr's gift-wrap encryption and
   * published to connected relays.
   *
   * @param method - The method name to invoke on the recipient
   * @param params - Parameters to send with the request
   * @param recipientPubkey - The public key of the recipient
   * @param senderKeysOrSigner - Optional keys or signer to use as sender (defaults to this peer's signer/keys)
   * @param timeout - Timeout in milliseconds (default 30000)
   * @returns The response from the recipient
   * @throws {Error} If the request times out or fails
   *
   * @example
   * ```typescript
   * const response = await peer.request(
   *   'transfer',
   *   { amount: 100, to: 'recipientPubkey' },
   *   'forgePubkey',
   *   undefined,
   *   10000
   * );
   * if (response.error) {
   *   console.error('Request failed:', response.error);
   * } else {
   *   console.log('Success:', response.result);
   * }
   * ```
   */
  public async request(
    method: string,
    params: Record<string, unknown>,
    recipientPubkey: string,
    senderKeysOrSigner?: KeyPair | Signer,
    timeout: number = 30000,
  ): Promise<NWPCResponse> {
    const request = this.createRequest(method, params);

    let wrappedEvent;

    // Determine if the sender param is a Signer or KeyPair
    const isSigner = (obj: unknown): obj is Signer =>
      obj !== null &&
      typeof obj === "object" &&
      "getPublicKey" in obj &&
      "signEvent" in obj;

    if (senderKeysOrSigner && isSigner(senderKeysOrSigner)) {
      // Use provided signer
      wrappedEvent = await WrapWithSigner(
        this.ndk,
        JSON.stringify(request),
        senderKeysOrSigner,
        recipientPubkey,
      );
    } else if (senderKeysOrSigner) {
      // Use provided keys
      wrappedEvent = await Wrap(
        this.ndk,
        JSON.stringify(request),
        senderKeysOrSigner as KeyPair,
        recipientPubkey,
      );
    } else if (this.signer) {
      // Use instance signer
      wrappedEvent = await WrapWithSigner(
        this.ndk,
        JSON.stringify(request),
        this.signer,
        recipientPubkey,
      );
    } else {
      // Use instance keys
      wrappedEvent = await Wrap(
        this.ndk,
        JSON.stringify(request),
        this.keys,
        recipientPubkey,
      );
    }

    Debug.log("request:", "NWPCPeer");

    // Register the response handler BEFORE publishing to prevent the race
    // where a fast server responds before the handler map is populated.
    const responsePromise = new Promise<NWPCResponse>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.responseHandlers.delete(request.id);
        reject(new Error("Request timed out"));
      }, timeout);

      this.responseHandlers.set(request.id, {
        resolve,
        reject,
        timeoutId,
      });
    });

    try {
      // Resolve as soon as the FIRST relay ACKs — don't wait for all relays.
      // NDK's publish() uses Promise.all internally, so without this wrapper it
      // blocks until every relay responds (or times out at 2500ms each). By
      // listening to the per-relay "relay:published" event we can move on the
      // moment any relay has the event, letting the rest settle in the background.
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
    } catch (err) {
      // If the publish fails entirely (no relay ACKed), clean up the pending
      // response handler so it doesn't linger until the request timeout fires.
      const handler = this.responseHandlers.get(request.id);
      if (handler) {
        clearTimeout(handler.timeoutId);
        this.responseHandlers.delete(request.id);
        handler.reject(new Error("Failed to publish request: " + String(err)));
      }
      throw err;
    }

    return responsePromise;
  }
}
