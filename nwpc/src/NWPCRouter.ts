import {
  NWPCContext,
  NWPCRequest,
  NWPCResponse,
  NWPCHandler,
  NWPCRoute,
  NWPCResponseObject,
} from "./NWPCResponseTypes";
import { HandlerEngine } from "./HandlerEngine";
import { INWPCBase } from "./NWPCBaseInterface";
/**
 * Router class for handling NWPC (Network Protocol Communication) requests
 * with support for middleware and method-based routing
 */
export class NWPCRouter {
  private readonly routes: Map<string, NWPCRoute> = new Map();
  private readonly handlerEngine: HandlerEngine;

  constructor(server: INWPCBase, routes: Map<string, NWPCRoute>) {
    this.handlerEngine = new HandlerEngine(server);
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
   * Handle an incoming NWPC request
   * @param request - The NWPC request
   * @param context - The NWPC context
   * @returns Promise that resolves to an NWPC response
   */
  public async handle(
    request: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ): Promise<NWPCResponse> {
    console.log("NWPCRouter: handle", request.method);
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
