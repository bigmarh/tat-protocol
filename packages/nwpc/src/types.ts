import { NDKEvent } from "@nostr-dev-kit/ndk";
import { NWPCBase } from "./NWPCBase";

export interface MessageHookOptions {
  beforeRequest?: MessageHook;
  afterRequest?: MessageHook;
  beforeResponse?: MessageHook;
  afterResponse?: MessageHook;
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
  };
  ver?: string; // Protocol version (e.g., "1.0.0")
  [key: string]: unknown;
}

export type MessageHook = (
  message: NWPCMessageData,
  context: NWPCContext,
) => Promise<boolean>;

export interface NWPCContext {
  event: NDKEvent;
  poster: string;
  sender: string;
  recipient: string;
}

export interface NWPCRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
  timestamp: number;
  ver?: string; // Protocol version (e.g., "1.0.0")
}

export interface NWPCResponse {
  id: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
  timestamp: number;
  ver?: string; // Protocol version (e.g., "1.0.0")
}

export interface NWPCRoute {
  method: string;
  handlers: NWPCHandler[];
}

export type NWPCHandler = (
  request: NWPCRequest,
  context: NWPCContext,
  res: NWPCResponseObject,
  next: () => Promise<NWPCResponse>,
) => Promise<NWPCResponse>;

export type NWPCMiddleware = (
  request: NWPCRequest,
  context: NWPCContext,
  res: NWPCResponseObject,
  next: () => Promise<NWPCResponse>,
) => Promise<NWPCResponse>;

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
    let targetRecipient = recipient || this.context.poster;

    if (recipient === "sender") {
      targetRecipient = this.context.sender;
    }

    if (targetRecipient) {
      if (Array.isArray(targetRecipient)) {
        await this.sender.broadcastResponse(this.response, targetRecipient);
      } else {
        await this.sender.sendResponse(this.response, targetRecipient);
      }
    }

    return this.response;
  }

  async error(
    code: number,
    message: string,
    recipient?: string | string[],
  ): Promise<NWPCResponse> {
    this.response.error = { code, message };
    const targetRecipient = recipient || this.context.sender;

    if (targetRecipient) {
      if (Array.isArray(targetRecipient)) {
        await this.sender.broadcastResponse(this.response, targetRecipient);
      } else {
        await this.sender.sendResponse(this.response, targetRecipient);
      }
    }

    return this.response;
  }
}
