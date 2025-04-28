import { NDKEvent } from "@nostr-dev-kit/ndk";
import { NWPCResponse } from "./NWPCResponseTypes";

export interface INWPCBase {
    router: any;
    sendResponse(response: NWPCResponse, recipientPubkey: string): Promise<void>;
    broadcastResponse(response: NWPCResponse, recipients: string[]): Promise<void>;
} 