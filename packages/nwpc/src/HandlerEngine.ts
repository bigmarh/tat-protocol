import {
  NWPCRequest,
  NWPCResponse,
  NWPCContext,
  NWPCHandler,
  NWPCResponseObject,
} from "./NWPCResponseTypes";
import { NWPC_SPEC_ERRORS } from "./errors";

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
    res.send = async (...args: unknown[]) => {
      responseSent = true;
      // Ensure at least one argument (data)
      const [data, recipient] = args.length === 0 ? [{}] : args;
      return originalSend(data, recipient as string | string[] | undefined);
    };
    res.error = async (...args: unknown[]) => {
      responseSent = true;
      // Ensure at least two arguments (code, message)
      const [code, message, recipient] =
        args.length < 2
          ? [
              NWPC_SPEC_ERRORS.INTERNAL_ERROR.code,
              NWPC_SPEC_ERRORS.INTERNAL_ERROR.message,
            ]
          : args;
      return originalError(
        code as number,
        message as string,
        recipient as string | undefined,
      );
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

  public createMethodNotFoundResponse(
    id: string,
    method: string,
  ): NWPCResponse {
    return this.createErrorResponse(
      id,
      NWPC_SPEC_ERRORS.METHOD_NOT_FOUND.code,
      `Method ${method} not found`,
    );
  }
}
