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
export declare class HandlerEngine {
  private handlers;
  constructor();
  addAll(handlers: NWPCHandler[]): void;
  execute(
    request: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ): Promise<NWPCResponse | void>;
  createErrorResponse(id: string, code: number, message: string): NWPCResponse;
}
