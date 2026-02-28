import { NWPCBase } from "./NWPCBase.js";
import { NWPCServer } from "./NWPCServer.js";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { KeyPair } from "@tat-protocol/hdkeys";
import { StorageInterface } from "@tat-protocol/storage";
import { DebugLogger } from "@tat-protocol/utils";
import type { Signer } from "@tat-protocol/types";
import { NWPC_SPEC_ERRORS } from "./errors.js";

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
  /** Introspection configuration (opt-in, disabled by default) */
  introspection?: NWPCIntrospectionConfig;
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

  /** Validated token set by auth middleware (bearer or payment) */
  validatedToken?: unknown;

  /** Payment token to be spent after successful handler execution */
  paymentToken?: unknown;

  /** Amount to deduct from payment token */
  paymentCost?: number;
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

export interface NWPCParamSchema {
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  required?: boolean;
  properties?: Record<string, NWPCParamSchema>;
  items?: NWPCParamSchema;
  enum?: (string | number | boolean)[];
  default?: unknown;
}

export type NWPCAuthLevel = "public" | "authenticated" | "admin";

/**
 * Token-based authentication configuration for a method
 */
export interface NWPCTokenAuth {
  /** Authentication mode */
  mode: "bearer" | "payment";

  /** Pubkey of the forge that issues valid tokens (required for payment) */
  issuerPubkey?: string;

  /** Server pubkey binding for replay protection */
  audience?: string;

  /** Required access scopes (bearer mode) */
  scopes?: string[];

  /** Cost per call in token units (payment mode) */
  cost?: number;

  /** Allow overpayment up to this amount, return change (payment mode) */
  maxAmount?: number;

  /** Method to call to acquire a token (e.g., "auth.getToken") */
  acquireMethod?: string;

  /** Human-readable hint for token acquisition */
  acquireHint?: string;

  /** Relay hints for discovering external forge */
  relays?: string[];

  /** Parameter name for token in request params (default: "_token") */
  paramName?: string;
}

/**
 * Example request/response pair for documentation
 */
export interface NWPCMethodExample {
  name?: string;
  params: Record<string, unknown>;
  result?: unknown;
}

/**
 * Error documentation for a method
 */
export interface NWPCMethodError {
  code: number;
  message: string;
  when: string;
}

export interface NWPCRouteMetadata {
  description?: string;
  paramsSchema?: Record<string, NWPCParamSchema>;
  resultSchema?: NWPCParamSchema;
  auth?: NWPCAuthLevel;
  deprecated?: boolean;
  tags?: string[];
  hidden?: boolean;

  /** Token authentication requirements */
  tokenAuth?: NWPCTokenAuth;

  /** Whether this method is idempotent (important for payment retry safety) */
  idempotent?: boolean;

  /** Rate limiting configuration */
  rateLimit?: {
    requests: number;
    windowMs: number;
  };

  /** Example request/response pairs */
  examples?: NWPCMethodExample[];

  /** Documented error conditions */
  errors?: NWPCMethodError[];
}

export interface NWPCIntrospectionConfig {
  enabled: boolean;
  serverName?: string;
  serverVersion?: string;
  serverDescription?: string;
}

export interface NWPCRoute {
  method: string;
  handlers: NWPCHandler[];
  metadata?: NWPCRouteMetadata;
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

  async send(
    data: unknown,
    recipient?: string | string[],
  ): Promise<NWPCResponse> {
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
        Debug.log(
          "sending error response to" + targetRecipient,
          "NWPCResponseObject",
        );
        await this.sender.sendResponse(this.response, targetRecipient);
      }
    }

    return this.response;
  }

  async notFound(
    message?: string,
    recipient?: string | string[],
  ): Promise<NWPCResponse> {
    return this.error(
      NWPC_SPEC_ERRORS.NOT_FOUND.code,
      message || NWPC_SPEC_ERRORS.NOT_FOUND.message,
      undefined,
      recipient,
    );
  }

  async badRequest(
    message?: string,
    recipient?: string | string[],
  ): Promise<NWPCResponse> {
    return this.error(
      NWPC_SPEC_ERRORS.INVALID_REQUEST.code,
      message || NWPC_SPEC_ERRORS.INVALID_REQUEST.message,
      undefined,
      recipient,
    );
  }

  async unauthorized(
    message?: string,
    recipient?: string | string[],
  ): Promise<NWPCResponse> {
    return this.error(
      NWPC_SPEC_ERRORS.UNAUTHORIZED.code,
      message || NWPC_SPEC_ERRORS.UNAUTHORIZED.message,
      undefined,
      recipient,
    );
  }

  async internalError(
    message?: string,
    recipient?: string | string[],
  ): Promise<NWPCResponse> {
    return this.error(
      NWPC_SPEC_ERRORS.INTERNAL_ERROR.code,
      message || NWPC_SPEC_ERRORS.INTERNAL_ERROR.message,
      undefined,
      recipient,
    );
  }
}
