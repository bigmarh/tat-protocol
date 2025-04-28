import { NWPCServer } from "../lib";
import type { NWPCHandler, NWPCRequest, NWPCContext, NWPCResponseObject } from '@tat-protocol/nwpc';
import { getPublicKey } from "@tat-protocol/utils";
import { hexToBytes } from "@noble/hashes/utils";

// Example keys - DO NOT USE IN PRODUCTION
const secretKey = "67661ac515f3d2e24911e280dfbf508f0e2291f1de58505984fa643ae5d5cc18";
const SERVER_KEYS = {
    secretKey: secretKey,
    publicKey: getPublicKey(hexToBytes(secretKey))
};

class ProtectedServer extends NWPCServer {
    private logger!: NWPCHandler;
    private authenticator!: NWPCHandler;
    private rateLimiter!: NWPCHandler;

    constructor() {
        super({
            keys: SERVER_KEYS,
            type: 'server',
            relays: ['ws://localhost:8080']
        });
        this.initializeMiddleware();
        this.registerHandlers();
    }

    private initializeMiddleware() {
        this.logger = async (request: NWPCRequest, context: NWPCContext, res: NWPCResponseObject, next: () => Promise<void>) => {
            console.log('\n++++++++++++++++++++++++++ Logger ++++++++++++++++++++++++++');
            console.log(`[${new Date().toISOString()}] Action: ${request.method}`);
            console.log('++++++++++++++++++++++++++ Logger: End ++++++++++++++++++++++++++\n');
            return next();
        };

        this.authenticator = async (request: NWPCRequest, context: NWPCContext, res: NWPCResponseObject, next: () => Promise<void>) => {
            const result = request.params?.[0] ? JSON.parse(request.params?.[0]) : null;
            console.log('\n++++++++++++++++++++++++++ Authenticator ++++++++++++++++++++++++++');
            console.log(`Authenticating request: 
                \nSender:${context.sender} 
                \nRecipient:${context.recipient}
                 \nPoster:${context.poster} 
                 \nMessage:${request.params?.[0]}
                 \nToken: ${result?.token}`);
            console.log('++++++++++++++++++++++++++ Authenticator: End ++++++++++++++++++++++++++\n');

            if (!result?.token) {
                res.error(500, 'Authentication required');
            }
            // In a real implementation, verify the token here
            return next();
        };

        this.rateLimiter = async (request: NWPCRequest, context: NWPCContext, res: NWPCResponseObject, next: () => Promise<void>) => {
            console.log('\n++++++++++++++++++++++++++ Rate Limiter ++++++++++++++++++++++++++');
            // In a real implementation, implement rate limiting logic 
            console.log('Rate limiting check passed');
            console.log('++++++++++++++++++++++++++ Rate Limiter: End ++++++++++++++++++++++++++\n');
            return next();
        };
    }

    private adminAction: NWPCHandler = async (request, context, res) => {
        console.log('\n++++++++++++++++++++++++++ Admin Action ++++++++++++++++++++++++++');
        return await res.send({
            message: 'Admin action executed'
        });
    };

    private userAction: NWPCHandler = async (request, context, res) => {
        console.log('\n++++++++++++++++++++++++++ User Action ++++++++++++++++++++++++++');
        return await res.send({
            message: 'User action executed'
        });
    };

    private publicAction: NWPCHandler = async (request, context, res) => {
        console.log('\n++++++++++++++++++++++++++ Public Action ++++++++++++++++++++++++++');
        return await res.send({
            message: 'Public action executed'
        }, context.sender);
    };

    private registerHandlers() {
        // Admin action with all middleware
        this.use('admin',
            this.logger,
            this.authenticator,
            this.rateLimiter,
            this.adminAction
        );

        // User action with authentication and rate limiting
        this.use('user',
            this.authenticator,
            this.rateLimiter,
            this.userAction
        );

        // Public action with just logging
        this.use('public',
            this.logger,
            this.publicAction
        );
    }

    async start() {
        try {
            console.log('\n🔒 Protected NWPC Server');
            console.log('------------------------');
            console.log('Public Key:', SERVER_KEYS.publicKey);
            console.log('Relay URLs:', ['ws://localhost:8080']);
            console.log('------------------------\n');
            console.log('Available actions:');
            console.log('- admin: Requires authentication and rate limiting');
            console.log('- user: Requires authentication');
            console.log('- public: No authentication required');
            console.log('\nWaiting for client requests...\n');
        } catch (error) {
            console.error('Failed to start server:', error);
            process.exit(1);
        }
    }
}

// Start the server
const server = new ProtectedServer();
server.start();





