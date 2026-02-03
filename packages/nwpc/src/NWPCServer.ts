import { NDKEvent } from "@nostr-dev-kit/ndk";
import { Unwrap, Wrap, UnwrapWithSigner, WrapWithSigner, DebugLogger } from "@tat-protocol/utils";
import {
  NWPCResponse,
  NWPCResponseObject,
  NWPCConfig,
  NWPCRequest,
  NWPCContext,
} from "./NWPCResponseTypes";
import { NWPCBase } from "./NWPCBase";
import { HandlerEngine } from "./HandlerEngine";

const Debug = DebugLogger.getInstance();

export class NWPCServer extends NWPCBase {
  private handlerEngine: HandlerEngine;

  constructor(config: NWPCConfig) {
    super(config);
    this.handlerEngine = new HandlerEngine();
    // Bind handleEvent to this instance
    this.handleEvent = this.handleEvent.bind(this);
  }

  protected async handleEvent(event: NDKEvent): Promise<void> {
    try {
      if (!this.signer && !this.keys) {
        Debug.error("Signer or keys not initialized", 'NWPCServer');
        return;
      }

      // Use signer-based unwrap if signer is available, otherwise fall back to keys
      let unwrapped;
      if (this.signer) {
        unwrapped = await UnwrapWithSigner(event.content, this.signer, event.pubkey);
      } else {
        unwrapped = await Unwrap(event.content, this.keys, event.pubkey);
      }
      if (!unwrapped) {
        Debug.log("Failed to unwrap event:" + event.id, 'NWPCServer');
        return;
      }

      const request = JSON.parse(unwrapped.content);
      if (!unwrapped.verifiedSender) {
        Debug.log("Original Event is not valid:" + event.id, 'NWPCServer');
        return;
      }

      //Event is valid from sender
      const context = {
        event,
        poster: event.pubkey,
        sender: unwrapped.sender,
        recipient: this.publicKey || this.keys.publicKey as string,
      };

      // Apply beforeRequest hook if it exists
      if (this.hooks.beforeRequest) {
        const shouldContinue = await this.hooks.beforeRequest(request, context);
        if (!shouldContinue) return;
      }

      const res = new NWPCResponseObject(request.id, this, context);

      await this.router.handle(request, context, res);

      // Apply afterRequest hook if it exists
      if (this.hooks.afterRequest) {
        await this.hooks.afterRequest(request, context);
      }
    } catch (error) {
      Debug.error("Error in handleEvent:" + error, 'NWPCServer');
    }
  }

  /**
   * Send a response to a specific public key
   * @param response - The NWPC response to send
   * @param recipientPubkey - The public key to send the response to
   * @returns Promise that resolves when the response is sent
   */
  public async sendResponse(
    response: NWPCResponse,
    recipientPubkey: string,
  ): Promise<void> {
    let wrappedEvent;
    if (this.signer) {
      wrappedEvent = await WrapWithSigner(
        this.ndk,
        JSON.stringify(response),
        this.signer,
        recipientPubkey,
      );
    } else {
      wrappedEvent = await Wrap(
        this.ndk,
        JSON.stringify(response),
        this.keys,
        recipientPubkey,
      );
    }

    Debug.log(
      "Send response:" + response + ` - ${recipientPubkey.slice(0, 3)}...${recipientPubkey.slice(-3)}`,
      'NWPCServer',
    );
    await wrappedEvent.publish();
  }

  /**
   * Send a response to multiple public keys
   * @param response - The NWPC response to send
   * @param recipientPubkeys - Array of public keys to send the response to
   * @returns Promise that resolves when all responses are sent
   */
  public async broadcastResponse(
    response: NWPCResponse,
    recipientPubkeys: string[],
  ): Promise<void> {
    Debug.log(
      "Broadcasting response to " + recipientPubkeys.length + " recipients:" + recipientPubkeys,
      'NWPCServer',
    );
    await Promise.all(
      recipientPubkeys.map((pubkey) => this.sendResponse(response, pubkey)),
    );
  }

  async handleRequest(
    request: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ): Promise<void> {
    try {
      await this.handlerEngine.execute(request, context, res);
    } catch (error) {
      res.send({ error: { code: 500, message: "Internal server error" } });
    }
  }
}
