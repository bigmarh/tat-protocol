import { NDKEvent } from "@nostr-dev-kit/ndk";
import {
  NWPCResponse,
  NWPCResponseObject,
  NWPCConfig,
  NWPCRequest,
  NWPCContext,
} from "./NWPCResponseTypes";
import { NWPCBase } from "./NWPCBase";
export declare class NWPCServer extends NWPCBase {
  private handlerEngine;
  constructor(config: NWPCConfig);
  protected handleEvent(event: NDKEvent): Promise<void>;
  /**
   * Send a response to a specific public key
   * @param response - The NWPC response to send
   * @param recipientPubkey - The public key to send the response to
   * @returns Promise that resolves when the response is sent
   */
  sendResponse(response: NWPCResponse, recipientPubkey: string): Promise<void>;
  /**
   * Send a response to multiple public keys
   * @param response - The NWPC response to send
   * @param recipientPubkeys - Array of public keys to send the response to
   * @returns Promise that resolves when all responses are sent
   */
  broadcastResponse(
    response: NWPCResponse,
    recipientPubkeys: string[],
  ): Promise<void>;
  handleRequest(
    request: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ): Promise<void>;
}
