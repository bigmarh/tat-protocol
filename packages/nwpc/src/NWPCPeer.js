import { NWPCResponseObject, } from "./NWPCResponseTypes";
import { Wrap, Unwrap, WrapWithSigner, UnwrapWithSigner, DebugLogger } from "@tat-protocol/utils";
import { NWPCBase } from "./NWPCBase";
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
    responseHandlers;
    constructor(config) {
        super(config);
        this.responseHandlers = new Map();
        // Bind handleEvent to this instance
        this.handleEvent = this.handleEvent.bind(this);
    }
    async handleEvent(event) {
        try {
            // Use signer-based unwrap if signer is available, otherwise fall back to keys
            let unwrapped;
            if (this.signer) {
                unwrapped = await UnwrapWithSigner(event.content, this.signer, event.pubkey);
            }
            else {
                unwrapped = await Unwrap(event.content, this.keys, event.pubkey);
            }
            if (!unwrapped) {
                Debug.log("Failed to unwrap event:" + event.id, 'NWPCPeer');
                return;
            }
            const message = JSON.parse(unwrapped.content);
            const context = {
                event,
                poster: event.pubkey,
                sender: unwrapped.sender,
                recipient: this.publicKey || this.keys.publicKey,
            };
            // Check if it's a response to our request
            if (this.responseHandlers.has(message.id)) {
                if (this.hooks.beforeResponse) {
                    const shouldContinue = await this.hooks.beforeResponse(message, context);
                    if (!shouldContinue)
                        return;
                }
                const handler = this.responseHandlers.get(message.id);
                if (handler) {
                    clearTimeout(handler.timeoutId);
                    this.responseHandlers.delete(message.id);
                    handler.resolve(message);
                    if (this.hooks.afterResponse) {
                        await this.hooks.afterResponse(message, context);
                    }
                }
            }
            else if ("method" in message) {
                if (this.hooks.beforeRequest) {
                    const shouldContinue = await this.hooks.beforeRequest(message, context);
                    if (!shouldContinue)
                        return;
                }
                // Handle as a request
                const request = message;
                const handler = this.requestHandlers.get(request.method);
                if (handler) {
                    const res = new NWPCResponseObject(request.id, this, context);
                    const response = await this.router.handle(request, context, res);
                    Debug.log("handleEvent:" + response, 'NWPCPeer');
                    await this.sendResponse(response, event.pubkey);
                    if (this.hooks.afterRequest) {
                        await this.hooks.afterRequest(message, context);
                    }
                }
                else {
                    Debug.log("No handler found for method:" + request.method, 'NWPCPeer');
                }
            }
            else {
                Debug.log("handleEvent: Unknown message type:" + message.result, 'NWPCPeer');
            }
        }
        catch (error) {
            Debug.error("Error in handleEvent:" + error, 'NWPCPeer');
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
    async request(method, params, recipientPubkey, senderKeysOrSigner, timeout = 30000) {
        const request = this.createRequest(method, params);
        let wrappedEvent;
        // Determine if the sender param is a Signer or KeyPair
        const isSigner = (obj) => obj !== null &&
            typeof obj === 'object' &&
            'getPublicKey' in obj &&
            'signEvent' in obj;
        if (senderKeysOrSigner && isSigner(senderKeysOrSigner)) {
            // Use provided signer
            wrappedEvent = await WrapWithSigner(this.ndk, JSON.stringify(request), senderKeysOrSigner, recipientPubkey);
        }
        else if (senderKeysOrSigner) {
            // Use provided keys
            wrappedEvent = await Wrap(this.ndk, JSON.stringify(request), senderKeysOrSigner, recipientPubkey);
        }
        else if (this.signer) {
            // Use instance signer
            wrappedEvent = await WrapWithSigner(this.ndk, JSON.stringify(request), this.signer, recipientPubkey);
        }
        else {
            // Use instance keys
            wrappedEvent = await Wrap(this.ndk, JSON.stringify(request), this.keys, recipientPubkey);
        }
        Debug.log("request:", 'NWPCPeer');
        await wrappedEvent.publish();
        return new Promise((resolve, reject) => {
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
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiTldQQ1BlZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJOV1BDUGVlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFDQSxPQUFPLEVBSUwsa0JBQWtCLEdBRW5CLE1BQU0scUJBQXFCLENBQUM7QUFDN0IsT0FBTyxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsY0FBYyxFQUFFLGdCQUFnQixFQUFFLFdBQVcsRUFBRSxNQUFNLHFCQUFxQixDQUFDO0FBQ2xHLE9BQU8sRUFBRSxRQUFRLEVBQUUsTUFBTSxZQUFZLENBQUM7QUFJdEMsTUFBTSxLQUFLLEdBQUcsV0FBVyxDQUFDLFdBQVcsRUFBRSxDQUFDO0FBRXhDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBeUJHO0FBQ0gsTUFBTSxPQUFPLFFBQVMsU0FBUSxRQUFRO0lBQzFCLGdCQUFnQixDQU94QjtJQUVGLFlBQVksTUFBa0I7UUFDNUIsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBRWQsSUFBSSxDQUFDLGdCQUFnQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUM7UUFDbEMsb0NBQW9DO1FBQ3BDLElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDakQsQ0FBQztJQUVTLEtBQUssQ0FBQyxXQUFXLENBQUMsS0FBZTtRQUN6QyxJQUFJLENBQUM7WUFDSCw4RUFBOEU7WUFDOUUsSUFBSSxTQUFTLENBQUM7WUFDZCxJQUFJLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztnQkFDaEIsU0FBUyxHQUFHLE1BQU0sZ0JBQWdCLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFFLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUMvRSxDQUFDO2lCQUFNLENBQUM7Z0JBQ04sU0FBUyxHQUFHLE1BQU0sTUFBTSxDQUFDLEtBQUssQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLElBQUksRUFBRSxLQUFL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T0FBTyxDQUFDLEVBQUUsRUFBRTtnQkFDcEMsT0FBTztnQkFDUCxNQUFNO2dCQUNOLFNBQVM7YUFDVixDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IE5ES0V2ZW50IH0gZnJvbSBcIkBub3N0ci1kZXYta2l0L25ka1wiO1xuaW1wb3J0IHtcbiAgTldQQ1JlcXVlc3QsXG4gIE5XUENSZXNwb25zZSxcbiAgTldQQ0NvbnRleHQsXG4gIE5XUENSZXNwb25zZU9iamVjdCxcbiAgTldQQ0NvbmZpZyxcbn0gZnJvbSBcIi4vTldQQ1Jlc3BvbnNlVHlwZXNcIjtcbmltcG9ydCB7IFdyYXAsIFVud3JhcCwgV3JhcFdpdGhTaWduZXIsIFVud3JhcFdpdGhTaWduZXIsIERlYnVnTG9nZ2VyIH0gZnJvbSBcIkB0YXQtcHJvdG9jb2wvdXRpbHNcIjtcbmltcG9ydCB7IE5XUENCYXNlIH0gZnJvbSBcIi4vTldQQ0Jhc2VcIjtcbmltcG9ydCB7IEtleVBhaXIgfSBmcm9tIFwiQHRhdC1wcm90b2NvbC9oZGtleXNcIjtcbmltcG9ydCB0eXBlIHsgU2lnbmVyIH0gZnJvbSBcIkB0YXQtcHJvdG9jb2wvdHlwZXNcIjtcblxuY29uc3QgRGVidWcgPSBEZWJ1Z0xvZ2dlci5nZXRJbnN0YW5jZSgpO1xuXG4vKipcbiAqIE5XUEMgUGVlciBpbXBsZW1lbnRhdGlvbiBmb3IgY2xpZW50LXNpZGUgY29tbXVuaWNhdGlvbi5cbiAqXG4gKiBOV1BDUGVlciBleHRlbmRzIE5XUENCYXNlIHRvIHByb3ZpZGUgY2xpZW50LXNpZGUgZnVuY3Rpb25hbGl0eSBmb3IgbWFraW5nXG4gKiByZXF1ZXN0cyB0byBOV1BDIHNlcnZlcnMgYW5kIGhhbmRsaW5nIHJlc3BvbnNlcy4gSXQgbWFuYWdlcyByZXF1ZXN0L3Jlc3BvbnNlXG4gKiBjb3JyZWxhdGlvbiwgdGltZW91dHMsIGFuZCBjYW4gYWxzbyBoYW5kbGUgaW5jb21pbmcgcmVxdWVzdHMgKHBlZXItdG8tcGVlcikuXG4gKlxuICogS2V5IGZlYXR1cmVzOlxuICogLSBTZW5kIHJlcXVlc3RzIGFuZCBhd2FpdCByZXNwb25zZXNcbiAqIC0gQXV0b21hdGljIHJlcXVlc3QvcmVzcG9uc2UgbWF0Y2hpbmcgYnkgSURcbiAqIC0gQ29uZmlndXJhYmxlIHRpbWVvdXRzXG4gKiAtIFN1cHBvcnQgZm9yIGJvdGggY2xpZW50IGFuZCBwZWVyLXRvLXBlZXIgbW9kZXNcbiAqXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogY29uc3QgcGVlciA9IG5ldyBOV1BDUGVlcih7XG4gKiAgIGtleXM6IG15S2V5cyxcbiAqICAgc3RvcmFnZTogbXlTdG9yYWdlLFxuICogICByZWxheXM6IFsnd3NzOi8vcmVsYXkuZXhhbXBsZS5jb20nXVxuICogfSk7XG4gKiBhd2FpdCBwZWVyLmluaXQoKTtcbiAqXG4gKiAvLyBNYWtlIGEgcmVxdWVzdFxuICogY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBwZWVyLnJlcXVlc3QoJ21ldGhvZE5hbWUnLCB7IHBhcmFtOiAndmFsdWUnIH0sICdzZXJ2ZXJQdWJrZXknKTtcbiAqIGBgYFxuICovXG5leHBvcnQgY2xhc3MgTldQQ1BlZXIgZXh0ZW5kcyBOV1BDQmFzZSB7XG4gIHByb3RlY3RlZCByZXNwb25zZUhhbmRsZXJzOiBNYXA8XG4gICAgc3RyaW5nLFxuICAgIHtcbiAgICAgIHJlc29sdmU6IChyZXNwb25zZTogTldQQ1Jlc3BvbnNlKSA9PiB2b2lkO1xuICAgICAgcmVqZWN0OiAoZXJyb3I6IEVycm9yKSA9PiB2b2lkO1xuICAgICAgdGltZW91dElkOiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PjtcbiAgICB9XG4gID47XG5cbiAgY29uc3RydWN0b3IoY29uZmlnOiBOV1BDQ29uZmlnKSB7XG4gICAgc3VwZXIoY29uZmlnKTtcblxuICAgIHRoaXMucmVzcG9uc2VIYW5kbGVycyA9IG5ldyBNYXAoKTtcbiAgICAvLyBCaW5kIGhhbmRsZUV2ZW50IHRvIHRoaXMgaW5zdGFuY2VcbiAgICB0aGlzLmhhbmRsZUV2ZW50ID0gdGhpcy5oYW5kbGVFdmVudC5iaW5kKHRoaXMpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGhhbmRsZUV2ZW50KGV2ZW50OiBOREtFdmVudCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICAvLyBVc2Ugc2lnbmVyLWJhc2VkIHVud3JhcCBpZiBzaWduZXIgaXMgYXZhaWxhYmxlLCBvdGhlcndpc2UgZmFsbCBiYWNrIHRvIGtleXNcbiAgICAgIGxldCB1bndyYXBwZWQ7XG4gICAgICBpZiAodGhpcy5zaWduZXIpIHtcbiAgICAgICAgdW53cmFwcGVkID0gYXdhaXQgVW53cmFwV2l0aFNpZ25lcihldmVudC5jb250ZW50LCB0aGlzLnNpZ25lciwgZXZlbnQucHVia2V5KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHVud3JhcHBlZCA9IGF3YWl0IFVud3JhcChldmVudC5jb250ZW50LCB0aGlzLmtleXMsIGV2ZW50LnB1YmtleSk7XG4gICAgICB9XG4gICAgICBpZiAoIXVud3JhcHBlZCkge1xuICAgICAgICBEZWJ1Zy5sb2coXCJGYWlsZWQgdG8gdW53cmFwIGV2ZW50OlwiICsgZXZlbnQuaWQsICdOV1BDUGVlcicpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBKU09OLnBhcnNlKHVud3JhcHBlZC5jb250ZW50KTtcblxuICAgICAgY29uc3QgY29udGV4dDogTldQQ0NvbnRleHQgPSB7XG4gICAgICAgIGV2ZW50LFxuICAgICAgICBwb3N0ZXI6IGV2ZW50LnB1YmtleSxcbiAgICAgICAgc2VuZGVyOiB1bndyYXBwZWQuc2VuZGVyLFxuICAgICAgICByZWNpcGllbnQ6IHRoaXMucHVibGljS2V5IHx8IHRoaXMua2V5cy5wdWJsaWNLZXkgYXMgc3RyaW5nLFxuICAgICAgfTtcblxuICAgICAgLy8gQ2hlY2sgaWYgaXQncyBhIHJlc3BvbnNlIHRvIG91ciByZXF1ZXN0XG4gICAgICBpZiAodGhpcy5yZXNwb25zZUhhbmRsZXJzLmhhcyhtZXNzYWdlLmlkKSkge1xuICAgICAgICBpZiAodGhpcy5ob29rcy5iZWZvcmVSZXNwb25zZSkge1xuICAgICAgICAgIGNvbnN0IHNob3VsZENvbnRpbnVlID0gYXdhaXQgdGhpcy5ob29rcy5iZWZvcmVSZXNwb25zZShcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICBjb250ZXh0LFxuICAgICAgICAgICk7XG4gICAgICAgICAgaWYgKCFzaG91bGRDb250aW51ZSkgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgaGFuZGxlciA9IHRoaXMucmVzcG9uc2VIYW5kbGVycy5nZXQobWVzc2FnZS5pZCk7XG4gICAgICAgIGlmIChoYW5kbGVyKSB7XG4gICAgICAgICAgY2xlYXJUaW1lb3V0KGhhbmRsZXIudGltZW91dElkKTtcbiAgICAgICAgICB0aGlzLnJlc3BvbnNlSGFuZGxlcnMuZGVsZXRlKG1lc3NhZ2UuaWQpO1xuICAgICAgICAgIGhhbmRsZXIucmVzb2x2ZShtZXNzYWdlIGFzIE5XUENSZXNwb25zZSk7XG5cbiAgICAgICAgICBpZiAodGhpcy5ob29rcy5hZnRlclJlc3BvbnNlKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmhvb2tzLmFmdGVyUmVzcG9uc2UobWVzc2FnZSwgY29udGV4dCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKFwibWV0aG9kXCIgaW4gbWVzc2FnZSkge1xuICAgICAgICBpZiAodGhpcy5ob29rcy5iZWZvcmVSZXF1ZXN0KSB7XG4gICAgICAgICAgY29uc3Qgc2hvdWxkQ29udGludWUgPSBhd2FpdCB0aGlzLmhvb2tzLmJlZm9yZVJlcXVlc3QoXG4gICAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgICAgY29udGV4dCxcbiAgICAgICAgICApO1xuICAgICAgICAgIGlmICghc2hvdWxkQ29udGludWUpIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEhhbmRsZSBhcyBhIHJlcXVlc3RcbiAgICAgICAgY29uc3QgcmVxdWVzdCA9IG1lc3NhZ2UgYXMgTldQQ1JlcXVlc3Q7XG4gICAgICAgIGNvbnN0IGhhbmRsZXIgPSB0aGlzLnJlcXVlc3RIYW5kbGVycy5nZXQocmVxdWVzdC5tZXRob2QpO1xuICAgICAgICBpZiAoaGFuZGxlcikge1xuICAgICAgICAgIGNvbnN0IHJlcyA9IG5ldyBOV1BDUmVzcG9uc2VPYmplY3QocmVxdWVzdC5pZCwgdGhpcywgY29udGV4dCk7XG4gICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnJvdXRlci5oYW5kbGUocmVxdWVzdCwgY29udGV4dCwgcmVzKTtcbiAgICAgICAgICBEZWJ1Zy5sb2coXCJoYW5kbGVFdmVudDpcIiArIHJlc3BvbnNlLCAnTldQQ1BlZXInKTtcbiAgICAgICAgICBhd2FpdCB0aGlzLnNlbmRSZXNwb25zZShyZXNwb25zZSwgZXZlbnQucHVia2V5KTtcblxuICAgICAgICAgIGlmICh0aGlzLmhvb2tzLmFmdGVyUmVxdWVzdCkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5ob29rcy5hZnRlclJlcXVlc3QobWVzc2FnZSwgY29udGV4dCk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIERlYnVnLmxvZyhcIk5vIGhhbmRsZXIgZm91bmQgZm9yIG1ldGhvZDpcIiArIHJlcXVlc3QubWV0aG9kLCAnTldQQ1BlZXInKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgRGVidWcubG9nKFxuICAgICAgICAgIFwiaGFuZGxlRXZlbnQ6IFVua25vd24gbWVzc2FnZSB0eXBlOlwiICsgbWVzc2FnZS5yZXN1bHQsXG4gICAgICAgICAgJ05XUENQZWVyJyxcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgRGVidWcuZXJyb3IoXCJFcnJvciBpbiBoYW5kbGVFdmVudDpcIiArIGVycm9yLCAnTldQQ1BlZXInKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2VuZHMgYSByZXF1ZXN0IHRvIGEgcmVtb3RlIE5XUEMgcGVlciBvciBzZXJ2ZXIuXG4gICAqXG4gICAqIENyZWF0ZXMgYW5kIHNlbmRzIGFuIGVuY3J5cHRlZCByZXF1ZXN0LCB0aGVuIHdhaXRzIGZvciBhIHJlc3BvbnNlIHdpdGggdGhlXG4gICAqIG1hdGNoaW5nIElELiBUaGUgcmVxdWVzdCBpcyB3cmFwcGVkIHVzaW5nIE5vc3RyJ3MgZ2lmdC13cmFwIGVuY3J5cHRpb24gYW5kXG4gICAqIHB1Ymxpc2hlZCB0byBjb25uZWN0ZWQgcmVsYXlzLlxuICAgKlxuICAgKiBAcGFyYW0gbWV0aG9kIC0gVGhlIG1ldGhvZCBuYW1lIHRvIGludm9rZSBvbiB0aGUgcmVjaXBpZW50XG4gICAqIEBwYXJhbSBwYXJhbXMgLSBQYXJhbWV0ZXJzIHRvIHNlbmQgd2l0aCB0aGUgcmVxdWVzdFxuICAgKiBAcGFyYW0gcmVjaXBpZW50UHVia2V5IC0gVGhlIHB1YmxpYyBrZXkgb2YgdGhlIHJlY2lwaWVudFxuICAgKiBAcGFyYW0gc2VuZGVyS2V5c09yU2lnbmVyIC0gT3B0aW9uYWwga2V5cyBvciBzaWduZXIgdG8gdXNlIGFzIHNlbmRlciAoZGVmYXVsdHMgdG8gdGhpcyBwZWVyJ3Mgc2lnbmVyL2tleXMpXG4gICAqIEBwYXJhbSB0aW1lb3V0IC0gVGltZW91dCBpbiBtaWxsaXNlY29uZHMgKGRlZmF1bHQgMzAwMDApXG4gICAqIEByZXR1cm5zIFRoZSByZXNwb25zZSBmcm9tIHRoZSByZWNpcGllbnRcbiAgICogQHRocm93cyB7RXJyb3J9IElmIHRoZSByZXF1ZXN0IHRpbWVzIG91dCBvciBmYWlsc1xuICAgKlxuICAgKiBAZXhhbXBsZVxuICAgKiBgYGB0eXBlc2NyaXB0XG4gICAqIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgcGVlci5yZXF1ZXN0KFxuICAgKiAgICd0cmFuc2ZlcicsXG4gICAqICAgeyBhbW91bnQ6IDEwMCwgdG86ICdyZWNpcGllbnRQdWJrZXknIH0sXG4gICAqICAgJ2ZvcmdlUHVia2V5JyxcbiAgICogICB1bmRlZmluZWQsXG4gICAqICAgMTAwMDBcbiAgICogKTtcbiAgICogaWYgKHJlc3BvbnNlLmVycm9yKSB7XG4gICAqICAgY29uc29sZS5lcnJvcignUmVxdWVzdCBmYWlsZWQ6JywgcmVzcG9uc2UuZXJyb3IpO1xuICAgKiB9IGVsc2Uge1xuICAgKiAgIGNvbnNvbGUubG9nKCdTdWNjZXNzOicsIHJlc3BvbnNlLnJlc3VsdCk7XG4gICAqIH1cbiAgICogYGBgXG4gICAqL1xuICBwdWJsaWMgYXN5bmMgcmVxdWVzdChcbiAgICBtZXRob2Q6IHN0cmluZyxcbiAgICBwYXJhbXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICAgIHJlY2lwaWVudFB1YmtleTogc3RyaW5nLFxuICAgIHNlbmRlcktleXNPclNpZ25lcj86IEtleVBhaXIgfCBTaWduZXIsXG4gICAgdGltZW91dDogbnVtYmVyID0gMzAwMDAsXG4gICk6IFByb21pc2U8TldQQ1Jlc3BvbnNlPiB7XG4gICAgY29uc3QgcmVxdWVzdCA9IHRoaXMuY3JlYXRlUmVxdWVzdChtZXRob2QsIHBhcmFtcyk7XG5cbiAgICBsZXQgd3JhcHBlZEV2ZW50O1xuXG4gICAgLy8gRGV0ZXJtaW5lIGlmIHRoZSBzZW5kZXIgcGFyYW0gaXMgYSBTaWduZXIgb3IgS2V5UGFpclxuICAgIGNvbnN0IGlzU2lnbmVyID0gKG9iajogdW5rbm93bik6IG9iaiBpcyBTaWduZXIgPT5cbiAgICAgIG9iaiAhPT0gbnVsbCAmJlxuICAgICAgdHlwZW9mIG9iaiA9PT0gJ29iamVjdCcgJiZcbiAgICAgICdnZXRQdWJsaWNLZXknIGluIG9iaiAmJlxuICAgICAgJ3NpZ25FdmVudCcgaW4gb2JqO1xuXG4gICAgaWYgKHNlbmRlcktleXNPclNpZ25lciAmJiBpc1NpZ25lcihzZW5kZXJLZXlzT3JTaWduZXIpKSB7XG4gICAgICAvLyBVc2UgcHJvdmlkZWQgc2lnbmVyXG4gICAgICB3cmFwcGVkRXZlbnQgPSBhd2FpdCBXcmFwV2l0aFNpZ25lcihcbiAgICAgICAgdGhpcy5uZGssXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KHJlcXVlc3QpLFxuICAgICAgICBzZW5kZXJLZXlzT3JTaWduZXIsXG4gICAgICAgIHJlY2lwaWVudFB1YmtleSxcbiAgICAgICk7XG4gICAgfSBlbHNlIGlmIChzZW5kZXJLZXlzT3JTaWduZXIpIHtcbiAgICAgIC8vIFVzZSBwcm92aWRlZCBrZXlzXG4gICAgICB3cmFwcGVkRXZlbnQgPSBhd2FpdCBXcmFwKFxuICAgICAgICB0aGlzLm5kayxcbiAgICAgICAgSlNPTi5zdHJpbmdpZnkocmVxdWVzdCksXG4gICAgICAgIHNlbmRlcktleXNPclNpZ25lciBhcyBLZXlQYWlyLFxuICAgICAgICByZWNpcGllbnRQdWJrZXksXG4gICAgICApO1xuICAgIH0gZWxzZSBpZiAodGhpcy5zaWduZXIpIHtcbiAgICAgIC8vIFVzZSBpbnN0YW5jZSBzaWduZXJcbiAgICAgIHdyYXBwZWRFdmVudCA9IGF3YWl0IFdyYXBXaXRoU2lnbmVyKFxuICAgICAgICB0aGlzLm5kayxcbiAgICAgICAgSlNPTi5zdHJpbmdpZnkocmVxdWVzdCksXG4gICAgICAgIHRoaXMuc2lnbmVyLFxuICAgICAgICByZWNpcGllbnRQdWJrZXksXG4gICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBVc2UgaW5zdGFuY2Uga2V5c1xuICAgICAgd3JhcHBlZEV2ZW50ID0gYXdhaXQgV3JhcChcbiAgICAgICAgdGhpcy5uZGssXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KHJlcXVlc3QpLFxuICAgICAgICB0aGlzLmtleXMsXG4gICAgICAgIHJlY2lwaWVudFB1YmtleSxcbiAgICAgICk7XG4gICAgfVxuXG4gICAgRGVidWcubG9nKFwicmVxdWVzdDpcIiwgJ05XUENQZWVyJyk7XG4gICAgYXdhaXQgd3JhcHBlZEV2ZW50LnB1Ymxpc2goKTtcblxuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjb25zdCB0aW1lb3V0SWQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgdGhpcy5yZXNwb25zZUhhbmRsZXJzLmRlbGV0ZShyZXF1ZXN0LmlkKTtcbiAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihcIlJlcXVlc3QgdGltZWQgb3V0XCIpKTtcbiAgICAgIH0sIHRpbWVvdXQpO1xuXG4gICAgICB0aGlzLnJlc3BvbnNlSGFuZGxlcnMuc2V0KHJlcXVlc3QuaWQsIHtcbiAgICAgICAgcmVzb2x2ZSxcbiAgICAgICAgcmVqZWN0LFxuICAgICAgICB0aW1lb3V0SWQsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxufVxuIl19