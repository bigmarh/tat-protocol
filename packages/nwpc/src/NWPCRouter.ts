import {
  NWPCContext,
  NWPCRequest,
  NWPCResponse,
  NWPCHandler,
  NWPCRoute,
  NWPCRouteMetadata,
  NWPCResponseObject,
} from "./NWPCResponseTypes.js";
import { HandlerEngine } from "./HandlerEngine.js";
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

  public use(
    method: string,
    ...args: (NWPCHandler | NWPCRouteMetadata)[]
  ): void {
    let metadata: NWPCRouteMetadata | undefined;
    const handlers: NWPCHandler[] = [];

    for (const arg of args) {
      if (typeof arg === "function") {
        handlers.push(arg);
      } else if (typeof arg === "object" && arg !== null) {
        metadata = arg as NWPCRouteMetadata;
      }
    }

    if (handlers.length === 0) {
      throw new Error("At least one handler is required");
    }

    const route: NWPCRoute = { method, handlers, metadata };
    this.routes.set(method, route);
  }
  /**
   * Routes an incoming NWPC request to the appropriate handler.
   *
   * This is the core routing method that matches requests to registered handlers
   * based on the method name. If a handler is found, it executes the handler chain
   * (including any middleware) and returns the response. If no handler is found,
   * it returns a METHOD_NOT_FOUND error (code 1002).
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
      return this.handlerEngine.createMethodNotFoundResponse(
        request.id,
        request.method,
      );
    }

    this.handlerEngine.addAll(route.handlers);
    const response = await this.handlerEngine.execute(request, context, res);
    return response as NWPCResponse;
  }

  /**
   * List all registered routes with their metadata
   * @returns Array of route info objects sorted by method name
   */
  public listRoutes(): Array<{ method: string; metadata?: NWPCRouteMetadata }> {
    return Array.from(this.routes.entries())
      .filter(([_, route]) => !route.metadata?.hidden)
      .map(([method, route]) => ({ method, metadata: route.metadata }))
      .sort((a, b) => a.method.localeCompare(b.method));
  }

  /**
   * Get metadata for a specific route
   * @param method - The method name to look up
   * @returns The route metadata or undefined if not found
   */
  public getRouteMetadata(method: string): NWPCRouteMetadata | undefined {
    return this.routes.get(method)?.metadata;
  }
}
