export type NWPCRequest = any;
export type NWPCContext = any;
export type NWPCResponse = any;
export type NWPCConfig = any;

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
