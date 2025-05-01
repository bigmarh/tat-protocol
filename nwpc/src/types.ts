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

export type MessageHook = (
  message: any,
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
  params: Record<string, any>;
  timestamp: number;
}

export interface NWPCResponse {
  id: string;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
  timestamp: number;
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
  private id: string;
  private response: NWPCResponse;
  private sender: NWPCBase;
  private context: NWPCContext;

  constructor(id: string, sender: NWPCBase, context: NWPCContext) {
    this.id = id;
    this.sender = sender;
    this.context = context;
    this.response = {
      id,
      timestamp: Date.now(),
    };
  }

  async send(data: any, recipient?: string | string[]): Promise<NWPCResponse> {
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
