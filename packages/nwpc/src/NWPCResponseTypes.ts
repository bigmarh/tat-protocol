import { NWPCBase } from "./NWPCBase";
import { NWPCServer } from "./NWPCServer";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { KeyPair } from "@tat-protocol/hdkeys";
import { StorageInterface } from "@tat-protocol/storage";
import { DebugLogger } from "@tat-protocol/utils";
import type { Signer } from "@tat-protocol/types";

const Debug = DebugLogger.getInstance();

/**
 * Configuration for NWPC instances.
 *
 * Supports two key management approaches:
 * 1. `signer` - A Signer interface for abstracted key management (recommended)
 * 2. `keys` - Direct KeyPair for backwards compatibility
 *
 * If both are provided, `signer` takes precedence.
 */
export interface NWPCConfig {
  relays?: string[];
  /** Signer interface for abstracted key management (recommended) */
  signer?: Signer;
  /** Direct key pair for backwards compatibility */
  keys?: KeyPair;
  keyID?: string;
  hooks?: MessageHookOptions;
  storage?: StorageInterface;
  requestHandlers?: Map<string, NWPCHandler>;
  type?: "client" | "server";
  [key: string]: unknown;
}

export interface NWPCError {
  code: number;
  message: string;
}

/**
 * NWPC message data structure
 */
export interface NWPCMessageData {
  id: string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    params?: string;
  };
  [key: string]: unknown;
}

export type MessageHook = (
  message: NWPCMessageData,
  context: NWPCContext,
) => Promise<boolean>;

export interface MessageHookOptions {
  beforeRequest?: MessageHook;
  afterRequest?: MessageHook;
  beforeResponse?: MessageHook;
  afterResponse?: MessageHook;
}

export interface NWPCContext {
  event: NDKEvent;
  poster: string;
  sender: string;
  recipient: string;
}

export interface NWPCRequest {
  id: string; // Unique request ID
  method: string; // Method to call
  params: string; // Method parameters
  timestamp: number; // Request timestamp
}

export interface NWPCResponse {
  id: string; // Matches request ID
  result?: unknown; // Success result
  error?: {
    // Error details if any
    code: number;
    message: string;
    params?: string;
  };
  timestamp: number; // Response timestamp
}

export interface NWPCRoute {
  method: string;
  handlers: NWPCHandler[];
}
export type NWPCHandler = (
  request: NWPCRequest,
  context: NWPCContext,
  res: NWPCResponseObject,
  next: () => Promise<void>,
) => Promise<NWPCResponse | void>;

export class NWPCResponseObject {
  private _id: string;
  private response: NWPCResponse;
  private sender: NWPCBase;
  private context: NWPCContext;

  constructor(id: string, sender: NWPCBase, context: NWPCContext) {
    this._id = id;
    this.sender = sender;
    this.context = context;
    this.response = {
      id: this._id,
      timestamp: Date.now(),
    };
  }

  async send(data: unknown, recipient?: string | string[]): Promise<NWPCResponse> {
    this.response.result = data;
    // If recipient is not specified, send it back to the entity who sent the request
    let targetRecipient = recipient || this.context.poster;

    // If recipient is specified as 'sender', send it back to the envelope signer
    if (recipient === "sender") {
      targetRecipient = this.context.sender;
    }

    if (targetRecipient) {
      if (Array.isArray(targetRecipient)) {
        if (this.sender instanceof NWPCServer) {
          await this.sender.broadcastResponse(this.response, targetRecipient);
        } else {
          await Promise.all(
            targetRecipient.map((pubkey) =>
              this.sender.sendResponse(this.response, pubkey),
            ),
          );
        }
      } else {
        await this.sender.sendResponse(this.response, targetRecipient);
      }
      // If the recipient is not the sender, send a success response to the sender
      if (targetRecipient !== this.context.sender) {
        await this.sender.sendResponse(
          {
            id: this.response.id,
            timestamp: Date.now(),
            result: { success: "ok" },
          },
          this.context.sender,
        );
      }
    }

    return this.response;
  }

  async error(
    code: number,
    message: string,
    params?: string,
    recipient?: string | string[],
  ): Promise<NWPCResponse> {
    this.response.error = { code, message, params };
    const targetRecipient = recipient || this.context.sender;

    if (targetRecipient) {
      if (Array.isArray(targetRecipient)) {
        if (this.sender instanceof NWPCServer) {
          await this.sender.broadcastResponse(this.response, targetRecipient);
        } else {
          await Promise.all(
            targetRecipient.map((pubkey) =>
              this.sender.sendResponse(this.response, pubkey),
            ),
          );
        }
      } else {
        Debug.log("sending error response to" + targetRecipient, 'NWPCResponseObject');
        await this.sender.sendResponse(this.response, targetRecipient);
      }
    }

    return this.response;
  }

  async notFound(
    message?: string,
    recipient?: string | string[],
  ): Promise<NWPCResponse> {
    return this.error(404, message || "Not found", undefined, recipient);
  }

  async badRequest(
    message?: string,
    recipient?: string | string[],
  ): Promise<NWPCResponse> {
    return this.error(400, message || "Bad request", undefined, recipient);
  }

  async unauthorized(
    message?: string,
    recipient?: string | string[],
  ): Promise<NWPCResponse> {
    return this.error(401, message || "Unauthorized", undefined, recipient);
  }

  async internalError(
    message?: string,
    recipient?: string | string[],
  ): Promise<NWPCResponse> {
    return this.error(
      500,
      message || "Internal server error",
      undefined,
      recipient,
    );
  }
}
