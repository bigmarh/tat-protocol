import { NDKEvent } from "@nostr-dev-kit/ndk";
import { NWPCResponse, NWPCConfig } from "./NWPCResponseTypes";
import { NWPCBase } from "./NWPCBase";
import { KeyPair } from "@tat-protocol/hdkeys";
import type { Signer } from "@tat-protocol/types";
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
export declare class NWPCPeer extends NWPCBase {
  protected responseHandlers: Map<
    string,
    {
      resolve: (response: NWPCResponse) => void;
      reject: (error: Error) => void;
      timeoutId: ReturnType<typeof setTimeout>;
    }
  >;
  constructor(config: NWPCConfig);
  protected handleEvent(event: NDKEvent): Promise<void>;
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
  request(
    method: string,
    params: Record<string, unknown>,
    recipientPubkey: string,
    senderKeysOrSigner?: KeyPair | Signer,
    timeout?: number,
  ): Promise<NWPCResponse>;
}
