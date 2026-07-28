import { NDKEvent } from "@nostr-dev-kit/ndk";
import { NWPCResponse } from "./NWPCResponseTypes.js";
import { NWPCRouter } from "./NWPCRouter.js";

export interface INWPCBase {
  router: NWPCRouter;
  ensureConnected(): Promise<void>;
  /** Live socket state, so a caller can report connectivity truthfully. */
  relayHealth(): { total: number; live: number; urls: string[] };
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
