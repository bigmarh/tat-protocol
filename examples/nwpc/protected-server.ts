import { NWPCServer } from "@tat-protocol/nwpc";
import type {
  NWPCHandler,
  NWPCRequest,
  NWPCContext,
  NWPCResponseObject,
} from "@tat-protocol/nwpc";
import { getPublicKey } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { NodeStore } from "@tat-protocol/storage/dist/DiskStorage";

// Example keys - DO NOT USE IN PRODUCTION
const secretKey =
  "67661ac515f3d2e24911e280dfbf508f0e2291f1de58505984fa643ae5d5cc18";
const SERVER_KEYS = {
  secretKey: secretKey,
  publicKey: getPublicKey(hexToBytes(secretKey)),
};

class ProtectedServer extends NWPCServer {
  private logger!: NWPCHandler;
  private authenticator!: NWPCHandler;
  private rateLimiter!: NWPCHandler;

  constructor() {
    super({
      keys: SERVER_KEYS,
      type: "server",
      relays: ["ws://localhost:8080"],
      storage: new NodeStore(),
    });
    this.initializeMiddleware();
    this.registerHandlers();
  }

  private initializeMiddleware() {
    this.logger = async (
      request: NWPCRequest,
      _context: NWPCContext,
      _res: NWPCResponseObject,
      next: () => Promise<void>,
    ) => {
      console.log(
        "\n++++++++++++++++++++++++++ Logger ++++++++++++++++++++++++++",
      );
      console.log(`[${new Date().toISOString()}] Action: ${request.method}`);
      console.log(
        "++++++++++++++++++++++++++ Logger: End ++++++++++++++++++++++++++\n",
      );
      return next();
    };

    this.authenticator = async (
      request: NWPCRequest,
      _context: NWPCContext,
      _res: NWPCResponseObject,
      next: () => Promise<void>,
    ) => {
      const result = request.params?.[0]
        ? JSON.parse(request.params?.[0])
        : null;
      console.log(
        "\n++++++++++++++++++++++++++ Authenticator ++++++++++++++++++++++++++",
      );
      console.log(`Authenticating request: 
                  \nSender:${_context.sender} 
                \nRecipient:${_context.recipient}
                 \nPoster:${_context.poster} 
                 \nMessage:${request.params?.[0]}
                 \nToken: ${result?.token}`);
      console.log(
        "++++++++++++++++++++++++++ Authenticator: End ++++++++++++++++++++++++++\n",
      );

      if (!result?.token) {
        _res.error(500, "Authentication required");
      }
      // In a real implementation, verify the token here
      return next();
    };

    this.rateLimiter = async (
      _request: NWPCRequest,
      _context: NWPCContext,
      _res: NWPCResponseObject,
      next: () => Promise<void>,
    ) => {
      console.log(
        "\n++++++++++++++++++++++++++ Rate Limiter ++++++++++++++++++++++++++",
      );
      // In a real implementation, implement rate limiting logic
      console.log("Rate limiting check passed");
      console.log(
        "++++++++++++++++++++++++++ Rate Limiter: End ++++++++++++++++++++++++++\n",
      );
      return next();
    };
  }

  private adminAction: NWPCHandler = async (_request, _context, _res) => {
    console.log(
      "\n++++++++++++++++++++++++++ Admin Action ++++++++++++++++++++++++++",
    );
    return await _res.send({
      message: "Admin action executed",
    });
  };

  private userAction: NWPCHandler = async (_request, _context, _res) => {
    console.log(
      "\n++++++++++++++++++++++++++ User Action ++++++++++++++++++++++++++",
    );
    return await _res.send({
      message: "User action executed",
    });
  };

  private publicAction: NWPCHandler = async (_request, _context, _res) => {
    console.log(
      "\n++++++++++++++++++++++++++ Public Action ++++++++++++++++++++++++++",
    );
    return await _res.send(
      {
        message: "Public action executed",
      },
      _context.sender,
    );
  };

  private registerHandlers() {
    // Admin action with all middleware
    this.use(
      "admin",
      this.logger,
      this.authenticator,
      this.rateLimiter,
      this.adminAction,
    );

    // User action with authentication and rate limiting
    this.use("user", this.authenticator, this.rateLimiter, this.userAction);

    // Public action with just logging
    this.use("public", this.logger, this.publicAction);
  }

  async start() {
    try {
      console.log("\n🔒 Protected NWPC Server");
      console.log("------------------------");
      console.log("Public Key:", SERVER_KEYS.publicKey);
      console.log("Relay URLs:", ["ws://localhost:8080"]);
      console.log("------------------------\n");
      console.log("Available actions:");
      console.log("- admin: Requires authentication and rate limiting");
      console.log("- user: Requires authentication");
      console.log("- public: No authentication required");
      console.log("\nWaiting for client requests...\n");
    } catch (error) {
      console.error("Failed to start server:", error);
      process.exit(1);
    }
  }
}

// Start the server
const server = new ProtectedServer();
server.init();
server.start();
