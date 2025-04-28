import NDK, { NDKEvent } from '@nostr-dev-kit/ndk';
import { NWPCRequest, NWPCResponse, NWPCContext, NWPCHandler, NWPCResponseObject, MessageHookOptions, NWPCConfig } from './NWPCResponseTypes';
import { Wrap, Unwrap } from '@tat-protocol/utils/Nostr';
import { NWPCBase } from './NWPCBase';
import { NWPCRouter } from './NWPCRouter';
import { NWPCServer } from './NWPCServer';



export class NWPCPeer extends NWPCBase {
    private responseHandlers: Map<string, { resolve: (response: NWPCResponse) => void, reject: (error: Error) => void, timeoutId: NodeJS.Timeout }>;

    constructor(config: NWPCConfig) {
        super(config);
        console.log('NWPCPeer: Constructor:', config);
        this.responseHandlers = new Map();
        // Bind handleEvent to this instance
        this.handleEvent = this.handleEvent.bind(this);
       
    }

    protected async handleEvent(event: NDKEvent): Promise<void> {
        try {
            const unwrapped = await Unwrap(event.content, this.keys, event.pubkey);
            if (!unwrapped) {
                console.log('NWPCPeer: Failed to unwrap event:', event.id);
                return;
            }

            const message = JSON.parse(unwrapped.content);
            const context: NWPCContext = {
                event,
                poster: event.pubkey,
                sender: unwrapped.sender,
                recipient: this.keys.publicKey as string
            };

            // Check if it's a response to our request
            if (this.responseHandlers.has(message.id)) {
                if (this.hooks.beforeResponse) {
                    const shouldContinue = await this.hooks.beforeResponse(message, context);
                    if (!shouldContinue) return;
                }

                console.log('NWPCPeer: Found response handler for message ID:', message.id);
                const handler = this.responseHandlers.get(message.id);
                if (handler) {
                    clearTimeout(handler.timeoutId);
                    this.responseHandlers.delete(message.id);
                    handler.resolve(message as NWPCResponse);

                    if (this.hooks.afterResponse) {
                        await this.hooks.afterResponse(message, context);
                    }
                }
            } else if ('method' in message) {
                if (this.hooks.beforeRequest) {
                    const shouldContinue = await this.hooks.beforeRequest(message, context);
                    if (!shouldContinue) return;
                }
               
                // Handle as a request
                const request = message as NWPCRequest;
                console.log('NWPCPeer: handleEvent: has method', request.method);
                const handler = this.requestHandlers.get(request.method);
                if (handler) {
                    const res = new NWPCResponseObject(request.id, this, context);
                    const response = await this.router.handle(request, context, res);
                    console.log('NWPCPeer: handleEvent:', response);
                    await this.sendResponse(response, event.pubkey);

                    if (this.hooks.afterRequest) {
                        await this.hooks.afterRequest(message, context);
                    }
                } else {
                    console.log('NWPCPeer: No handler found for method:', request.method);
                }
            } else {
                console.log('NWPCPeer: Unknown message type:', message);
            }
        } catch (error) {
            console.error('NWPCPeer: Error in handleEvent:', error);
        }
    }

    public async request(method: string, params: any[], recipientPubkey: string, timeout: number = 30000): Promise<NWPCResponse> {
        console.log(this.keys);
        const request = this.createRequest(method, params);
        const wrappedEvent = await Wrap(
            this.ndk,
            JSON.stringify(request),
            this.keys,
            recipientPubkey
        );
        console.log('NWPCPeer: request:');
        await wrappedEvent.publish();

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.responseHandlers.delete(request.id);
                reject(new Error('Request timed out'));
            }, timeout);

            this.responseHandlers.set(request.id, {
                resolve,
                reject,
                timeoutId
            });
        });
    }
} 