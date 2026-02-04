import {
  NWPCContext,
  NWPCRequest,
  NWPCResponse,
  NWPCHandler,
  NWPCRoute,
  NWPCResponseObject,
} from "./NWPCResponseTypes";
import { HandlerEngine } from "./HandlerEngine";
import { DebugLogger } from "@tat-protocol/utils";

const Debug = DebugLogger.getInstance();

/**
 * Router class for handling NWPC (Network Protocol Communication) requests
 * with support for middleware and method-based routing
 */
export class NWPCRouter {
  private readonly routes: Map<string, NWPCRoute> = new Map();
  private readonly handlerEngine: HandlerEngine;

  constructor(routes: Map<string, NWPCRoute>) {
    this.handlerEngine = new HandlerEngine();
    this.routes = routes;
  }

  public use(method: string, ...handlers: NWPCHandler[]): void {
    // Validate we have at least one handler
    if (handlers.length === 0) {
      throw new Error("At least one handler is required");
    }

    const route: NWPCRoute = {
      method,
      handlers: handlers,
    };
    this.routes.set(method, route);
  }
  /**
   * Routes an incoming NWPC request to the appropriate handler.
   *
   * This is the core routing method that matches requests to registered handlers
   * based on the method name. If a handler is found, it executes the handler chain
   * (including any middleware) and returns the response. If no handler is found,
   * it returns a 404 error.
   *
   * @param request - The incoming NWPC request with method and parameters
   * @param context - The request context containing sender, recipient, and event info
   * @param res - The response object for sending results
   * @returns The response from the handler or an error response
   *
   * @example
   * ```typescript
   * // Inside a server's handleEvent method
   * const response = await this.router.handle(request, context, res);
   * await this.sendResponse(response, context.sender);
   * ```
   */
  public async handle(
    request: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ): Promise<NWPCResponse> {
    Debug.log("handle" + request.method, "NWPCRouter");
    const route = this.routes.get(request.method);

    if (!route) {
      return this.handlerEngine.createErrorResponse(
        request.id,
        404,
        `Method ${request.method} not found`,
      );
    }

    this.handlerEngine.addAll(route.handlers);
    const response = await this.handlerEngine.execute(request, context, res);
    return response as NWPCResponse;
  }
}
