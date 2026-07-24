export type NWPCRequest = any;
export type NWPCContext = any;
export type NWPCResponse = any;
export type NWPCConfig = any;

// Mirror of the JSON-RPC-style error table the forge references. Kept in the
// mock so error paths build a real response object instead of throwing on an
// undefined constant (the real barrel has a CJS circular-import quirk).
export const NWPC_SPEC_ERRORS = {
  PARSE_ERROR: { code: 1000, message: "Parse Error" },
  INVALID_REQUEST: { code: 1001, message: "Invalid Request" },
  METHOD_NOT_FOUND: { code: 1002, message: "Method Not Found" },
  INVALID_PARAMS: { code: 1003, message: "Invalid Params" },
  RATE_LIMITED: { code: 1004, message: "Rate Limited" },
  NOT_FOUND: { code: 1005, message: "Not Found" },
  TOKEN_INVALID: { code: 2000, message: "Token Invalid" },
  TOKEN_EXPIRED: { code: 2001, message: "Token Expired" },
  TOKEN_SPENT: { code: 2002, message: "Token Spent" },
  INSUFFICIENT_BALANCE: { code: 2003, message: "Insufficient Balance" },
  UNAUTHORIZED: { code: 2004, message: "Unauthorized" },
  SUPPLY_LIMIT: { code: 2005, message: "Supply Limit" },
  INTERNAL_ERROR: { code: 3000, message: "Internal Error" },
} as const;

export class NWPCResponseObject {
  constructor() {}
}

export class NWPCServer {
  public publicKey?: string;

  constructor(config: { keys?: { publicKey?: string } } = {}) {
    this.publicKey = config.keys?.publicKey;
  }

  async init(): Promise<void> {
    return;
  }

  use(): void {
    return;
  }

  getPublicKey(): string | undefined {
    return this.publicKey;
  }

  async sendResponse(): Promise<void> {
    return;
  }

  // Persistence hooks used by ForgeBase; no-ops in tests.
  stateKey?: string;
  async saveState(_key?: string, _state?: unknown): Promise<void> {
    return;
  }
  async queueSaveState(_key?: string, _state?: unknown): Promise<void> {
    return;
  }
  async loadState(_key?: string): Promise<unknown> {
    return null;
  }
}

export class NWPCPeer {
  constructor(_config: any) {}

  async init(): Promise<void> {
    return;
  }

  async request(): Promise<NWPCResponse> {
    return { id: "mock", timestamp: Date.now(), result: {} };
  }
}
