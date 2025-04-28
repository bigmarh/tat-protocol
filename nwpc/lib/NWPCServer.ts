import NDK, { NDKEvent } from "@nostr-dev-kit/ndk";
import { Unwrap, Wrap } from "@tat-protocol/utils/Nostr";
import { NWPCResponse, NWPCHandler, MessageHookOptions, NWPCResponseObject, NWPCConfig, NWPCRoute } from "./NWPCResponseTypes";
import { NWPCRouter } from "./NWPCRouter";
import { NWPCBase } from "./NWPCBase";

export class NWPCServer extends NWPCBase {


    constructor(config: NWPCConfig) {
        super(config);
        // Bind handleEvent to this instance
        this.handleEvent = this.handleEvent.bind(this);
    }

    protected async handleEvent(event: NDKEvent): Promise<void> {
        try {
            if (!this.keys) {
                console.error('NWPCServer: Keys not initialized');
                return;
            }
           
            const unwrapped = await Unwrap(event.content, this.keys, event.pubkey);
            if (!unwrapped) {
                console.log('NWPCServer: Failed to unwrap event:', event.id);
                return;
            }

            const request = JSON.parse(unwrapped.content);
            const context = {
                event,
                poster: event.pubkey,
                sender: unwrapped.sender,
                recipient: this.keys.publicKey as string
            };

            // Apply beforeRequest hook if it exists
            if (this.hooks.beforeRequest) {
                const shouldContinue = await this.hooks.beforeRequest(request, context);
                if (!shouldContinue) return;
            }

            const res = new NWPCResponseObject(request.id, this, context);
            const response = await this.router.handle(request, context, res);

            // Apply afterRequest hook if it exists
            if (this.hooks.afterRequest) {
                await this.hooks.afterRequest(request, context);
            }
        } catch (error) {
            console.error('NWPCServer: Error in handleEvent:', error);
        }
    }

    /**
     * Send a response to a specific public key
     * @param response - The NWPC response to send
     * @param recipientPubkey - The public key to send the response to
     * @returns Promise that resolves when the response is sent
     */
    public async sendResponse(response: NWPCResponse, recipientPubkey: string): Promise<void> {
        const wrappedEvent = await Wrap(
            this.ndk,
            JSON.stringify(response),
            this.keys,
            recipientPubkey
        );

        console.log('NWPCServer: Send response:', response);
        await wrappedEvent.publish();
    }

    /**
     * Send a response to multiple public keys
     * @param response - The NWPC response to send
     * @param recipientPubkeys - Array of public keys to send the response to
     * @returns Promise that resolves when all responses are sent
     */
    public async broadcastResponse(response: NWPCResponse, recipientPubkeys: string[]): Promise<void> {
        console.log('NWPCServer: Broadcasting response to', recipientPubkeys.length, 'recipients:', recipientPubkeys);
        await Promise.all(
            recipientPubkeys.map(pubkey => this.sendResponse(response, pubkey))
        );
    }

   
}