import {
  NWPCContext,
  NWPCRequest,
  NWPCResponse,
  NWPCHandler,
  NWPCRoute,
  NWPCResponseObject,
} from "./NWPCResponseTypes";
/**
 * Router class for handling NWPC (Network Protocol Communication) requests
 * with support for middleware and method-based routing
 */
export declare class NWPCRouter {
  private readonly routes;
  private readonly handlerEngine;
  constructor(routes: Map<string, NWPCRoute>);
  use(method: string, ...handlers: NWPCHandler[]): void;
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
  handle(
    request: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ): Promise<NWPCResponse>;
}
