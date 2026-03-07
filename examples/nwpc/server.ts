import { NWPCServer } from "@tat-protocol/nwpc";
import type {
  NWPCHandler,
  NWPCRequest,
  NWPCContext,
  NWPCResponseObject,
} from "@tat-protocol/nwpc";
import { getPublicKey } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { defaultConfig } from "./defaultConfig";
import { NodeStore } from "@tat-protocol/storage";

/*   Private Key: 2623a88c18e829794edd8f2fdfd7408f644a3675c706d98173a6cb9ede41515e
  Public Key: 031dd47426e7518119dcca1688cc3c3ae976f8c5690b4e2160e66dab47833f0876 */
// Server configuration
const secretKey =
  "2623a88c18e829794edd8f2fdfd7408f644a3675c706d98173a6cb9ede41515e";
const SERVER_KEYS = {
  secretKey: secretKey,
  publicKey: getPublicKey(hexToBytes(secretKey)),
};
console.log(SERVER_KEYS.publicKey);
const RELAYS = defaultConfig.relays;
const METHOD_INFO = [
  {
    name: "nwpc.info",
    description: "Describe available methods and server metadata",
    params: null,
    returns: "Server info and methods list",
  },
  {
    name: "ping",
    description: "Health check",
    params: null,
    returns: "\"pong\"",
  },
  {
    name: "add",
    description: "Add two numbers",
    params: "{ a: number, b: number }",
    returns: "number",
  },
  {
    name: "subtract",
    description: "Subtract two numbers",
    params: "{ a: number, b: number }",
    returns: "number",
  },
  {
    name: "multiply",
    description: "Multiply two numbers",
    params: "{ a: number, b: number }",
    returns: "number",
  },
  {
    name: "divide",
    description: "Divide two numbers",
    params: "{ a: number, b: number }",
    returns: "number",
  },
];
// Calculator handlers
const handlers = {
  "nwpc.info": async (
    _req: NWPCRequest,
    _ctx: NWPCContext,
    _res: NWPCResponseObject,
  ) => {
    return await _res.send(
      {
        name: "NWPC Calculator Server",
        publicKey: SERVER_KEYS.publicKey,
        relays: RELAYS,
        methods: METHOD_INFO,
      },
      "sender",
    );
  },
  ping: async (_req: NWPCRequest, _: NWPCContext, _res: NWPCResponseObject) => {
    return await _res.send("pong", "sender");
  },
  add: async (_req: NWPCRequest, _: NWPCContext, _res: NWPCResponseObject) => {
    function add(a: number, b: number) {
      return a + b;
    }

    const { a, b } = JSON.parse(_req.params);
    if (!a || !b) {
      return await _res.error(400, "Invalid parameters");
    }
    return await _res.send(add(a, b), "sender");
  },

  subtract: async (
    req: NWPCRequest,
    _: NWPCContext,
    _res: NWPCResponseObject,
  ) => {
    const { a, b } = JSON.parse(req.params);
    if (!a || !b) {
      return await _res.error(400, "Invalid parameters");
    }
    return await _res.send(a - b, "sender");
  },

  multiply: async (
    req: NWPCRequest,
    _: NWPCContext,
    _res: NWPCResponseObject,
  ) => {
    const { a, b } = JSON.parse(req.params);
    if (!a || !b) {
      return await _res.error(400, "Invalid parameters");
    }
    return await _res.send(a * b, "sender");
  },

  divide: async (
    req: NWPCRequest,
    _: NWPCContext,
    _res: NWPCResponseObject,
  ) => {
    const { a, b } = JSON.parse(req.params);
    if (!a || !b) {
      return await _res.error(400, "Invalid parameters");
    }
    if (b === 0) {
      return await _res.error(400, "Division by zero");
    }
    return await _res.send(a / b, "sender");
  },
};

class CalculatorServer {
  private server: NWPCServer;

  constructor() {
    this.server = new NWPCServer({
      keys: SERVER_KEYS,
      type: "server",
      relays: RELAYS,
      storage: new NodeStore(),
    });

    console.log("Server Connected");
    this.registerHandlers();
  }

  private registerHandlers() {
    Object.entries(handlers).forEach(([name, handler]) => {
      this.server.use(name, handler as NWPCHandler);
    });
  }

  async start() {
    await this.server.init();
    try {
      console.log("\n🔢 NWPC Calculator Server");
      console.log("------------------------");
      console.log("Public Key:", SERVER_KEYS.publicKey);
      console.log("Relay URLs:", RELAYS);
      console.log("------------------------\n");

      console.log("Introspection: nwpc.info");
      console.log("Waiting for client requests...\n");
    } catch (error) {
      console.error("Failed to start server:", error);
      process.exit(1);
    }
  }
}

async function main() {
  // Start the server
  const server = new CalculatorServer();
  server.start();
}

main();
