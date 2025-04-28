import NDK from "@nostr-dev-kit/ndk";
import { NWPCServer } from "../lib";
import type { NWPCHandler, NWPCRequest, NWPCContext, NWPCResponseObject } from '../lib/NWPCResponseTypes';
import { getPublicKey } from "@tat-protocol/utils";
import { hexToBytes } from "@noble/hashes/utils";

/*   Private Key: 2623a88c18e829794edd8f2fdfd7408f644a3675c706d98173a6cb9ede41515e
  Public Key: 031dd47426e7518119dcca1688cc3c3ae976f8c5690b4e2160e66dab47833f0876 */
// Server configuration
const secretKey = "2623a88c18e829794edd8f2fdfd7408f644a3675c706d98173a6cb9ede41515e";
const SERVER_KEYS = {
    secretKey: secretKey,
    publicKey: getPublicKey(hexToBytes(secretKey))
};
console.log(SERVER_KEYS.publicKey);
// Calculator handlers
const handlers = {
    ping: async (req: NWPCRequest, _: NWPCContext, res: NWPCResponseObject) => {
        return await res.send('pong', 'sender');
    },
    add: async (req: NWPCRequest, _: NWPCContext, res: NWPCResponseObject) => {
        const [a, b] = req.params;
        return await res.send(a + b, 'sender');
    },

    subtract: async (req: NWPCRequest, _: NWPCContext, res: NWPCResponseObject) => {
        const [a, b] = req.params;
        return await res.send(a - b, 'sender');
    },

    multiply: async (req: NWPCRequest, _: NWPCContext, res: NWPCResponseObject) => {
        const [a, b] = req.params;
        return await res.send(a * b, 'sender');
    },

    divide: async (req: NWPCRequest, _: NWPCContext, res: NWPCResponseObject) => {
        const [a, b] = req.params;
        if (b === 0) {
            return await res.error(400, 'Division by zero');
        }
        return await res.send(a / b, 'sender');
    }
};

class CalculatorServer {
    private server: NWPCServer;

    constructor() {

        this.server = new NWPCServer({
            keys: SERVER_KEYS,
            type: 'server',
            relays: ['ws://localhost:8080']
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
        try {
            console.log('\n🔢 NWPC Calculator Server');
            console.log('------------------------');
            console.log('Public Key:', SERVER_KEYS.publicKey);
            console.log('Relay URLs:', ['ws://localhost:8080']);
            console.log('------------------------\n');

            console.log('Waiting for client requests...\n');
        } catch (error) {
            console.error('Failed to start server:', error);
            process.exit(1);
        }
    }
}

// Start the server
new CalculatorServer().start().catch(console.error); 