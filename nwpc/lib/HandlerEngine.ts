import { NWPCRequest, NWPCResponse, NWPCContext, NWPCHandler, NWPCResponseObject } from './NWPCResponseTypes';
import { INWPCBase } from './NWPCBaseInterface';

type HandlerFunction = (req: any, ctx: any, res: any, next: () => void) => void;

/**
 * Engine for executing middleware chains and handlers
 */
export class HandlerEngine {
    private server: INWPCBase;
    private handlers: NWPCHandler[] = [];

    constructor(server: INWPCBase) {
        this.server = server;
    }

    public addAll(handlers: NWPCHandler[]): void {
        this.handlers = handlers;
    }

    public async execute(request: NWPCRequest, context: NWPCContext, res: NWPCResponseObject): Promise<NWPCResponse | void> {
        let currentIndex = 0;
        const next = async (): Promise<void> => {
            if (currentIndex >= this.handlers.length) {
                return;
            }   

            const handler = this.handlers[currentIndex++];
            await handler(request, context, res, next);
        };

        return next();
    }

    public createErrorResponse(id: string, code: number, message: string): NWPCResponse {
        return {
            id,
            error: { code, message },
            timestamp: Date.now()
        };
    }

  
} 