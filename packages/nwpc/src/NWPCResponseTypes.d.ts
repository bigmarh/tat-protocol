import { NWPCBase } from "./NWPCBase";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { KeyPair } from "@tat-protocol/hdkeys";
import { StorageInterface } from "@tat-protocol/storage";
import type { Signer } from "@tat-protocol/types";
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
  id: string;
  method: string;
  params: string;
  timestamp: number;
}
export interface NWPCResponse {
  id: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    params?: string;
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
  next: () => Promise<void>,
) => Promise<NWPCResponse | void>;
export declare class NWPCResponseObject {
  private _id;
  private response;
  private sender;
  private context;
  constructor(id: string, sender: NWPCBase, context: NWPCContext);
  send(data: unknown, recipient?: string | string[]): Promise<NWPCResponse>;
  error(
    code: number,
    message: string,
    params?: string,
    recipient?: string | string[],
  ): Promise<NWPCResponse>;
  notFound(
    message?: string,
    recipient?: string | string[],
  ): Promise<NWPCResponse>;
  badRequest(
    message?: string,
    recipient?: string | string[],
  ): Promise<NWPCResponse>;
  unauthorized(
    message?: string,
    recipient?: string | string[],
  ): Promise<NWPCResponse>;
  internalError(
    message?: string,
    recipient?: string | string[],
  ): Promise<NWPCResponse>;
}
