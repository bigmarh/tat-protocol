import {
  NWPCRequest,
  NWPCResponse,
  NWPCContext,
  NWPCHandler,
  NWPCResponseObject,
} from "./NWPCResponseTypes";

/**
 * Engine for executing middleware chains and handlers
 */
export class HandlerEngine {
  private handlers: NWPCHandler[] = [];

  constructor() {}

  public addAll(handlers: NWPCHandler[]): void {
    this.handlers = handlers;
  }

  public async execute(
    request: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ): Promise<NWPCResponse | void> {
    let currentIndex = 0;
    let responseSent = false;
    // Patch: wrap res.send and res.error to detect if a response was sent
    const originalSend = res.send.bind(res);
    const originalError = res.error.bind(res);
    res.send = async (...args: any[]) => {
      responseSent = true;
      // Ensure at least one argument (data)
      const [data, recipient] = args.length === 0 ? [{}] : args;
      return originalSend(data, recipient);
    };
    res.error = async (...args: any[]) => {
      responseSent = true;
      // Ensure at least two arguments (code, message)
      const [code, message, recipient] =
        args.length < 2 ? [500, "Unknown error"] : args;
      return originalError(code, message, recipient);
    };

    const next = async (): Promise<void> => {
      if (currentIndex >= this.handlers.length) {
        return;
      }

      const handler = this.handlers[currentIndex++];
      await handler(request, context, res, next);
    };

    await next();
    // After all handlers, if no response was sent, send a default ok
    if (!responseSent) {
      await res.send({ status: "ok" }, context.sender);
    }
  }

  public createErrorResponse(
    id: string,
    code: number,
    message: string,
  ): NWPCResponse {
    return {
      id,
      error: { code, message },
      timestamp: Date.now(),
    };
  }
}
