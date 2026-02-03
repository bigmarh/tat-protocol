import { NDKEvent } from "@nostr-dev-kit/ndk";
import { NWPCResponse } from "./NWPCResponseTypes";
import { NWPCRouter } from "./NWPCRouter";
export interface INWPCBase {
  router: NWPCRouter;
  sendResponse(response: NWPCResponse, recipientPubkey: string): Promise<void>;
  broadcastResponse(
    response: NWPCResponse,
    recipients: string[],
  ): Promise<void>;
  subscribe(
    pubkey: string,
    handler: (event: NDKEvent) => Promise<void>,
  ): Promise<unknown>;
}
