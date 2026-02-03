import { HandlerEngine } from "./HandlerEngine";
import { DebugLogger } from "@tat-protocol/utils";
const Debug = DebugLogger.getInstance();
/**
 * Router class for handling NWPC (Network Protocol Communication) requests
 * with support for middleware and method-based routing
 */
export class NWPCRouter {
    routes = new Map();
    handlerEngine;
    constructor(routes) {
        this.handlerEngine = new HandlerEngine();
        this.routes = routes;
    }
    use(method, ...handlers) {
        // Validate we have at least one handler
        if (handlers.length === 0) {
            throw new Error("At least one handler is required");
        }
        const route = {
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
    async handle(request, context, res) {
        Debug.log("handle" + request.method, 'NWPCRouter');
        const route = this.routes.get(request.method);
        if (!route) {
            return this.handlerEngine.createErrorResponse(request.id, 404, `Method ${request.method} not found`);
        }
        this.handlerEngine.addAll(route.handlers);
        const response = await this.handlerEngine.execute(request, context, res);
        return response;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiTldQQ1JvdXRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIk5XUENSb3V0ZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBUUEsT0FBTyxFQUFFLGFBQWEsRUFBRSxNQUFNLGlCQUFpQixDQUFDO0FBQ2hELE9BQU8sRUFBRSxXQUFXLEVBQUUsTUFBTSxxQkFBcUIsQ0FBQztBQUVsRCxNQUFNLEtBQUssR0FBRyxXQUFXLENBQUMsV0FBVyxFQUFFLENBQUM7QUFFeEM7OztHQUdHO0FBQ0gsTUFBTSxPQUFPLFVBQVU7SUFDSixNQUFNLEdBQTJCLElBQUksR0FBRyxFQUFFLENBQUM7SUFDM0MsYUFBYSxDQUFnQjtJQUU5QyxZQUFZLE1BQThCO1FBQ3hDLElBQUksQ0FBQyxhQUFhLEdBQUcsSUFBSSxhQUFhLEVBQUUsQ0FBQztRQUN6QyxJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQztJQUN2QixDQUFDO0lBRU0sR0FBRyxDQUFDLE1BQWMsRUFBRSxHQUFHLFFBQXVCO1FBQ25ELHdDQUF3QztRQUN4QyxJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDMUIsTUFBTSxJQUFJLEtBQUssQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDO1FBQ3RELENBQUM7UUFFRCxNQUFNLEtBQUssR0FBYztZQUN2QixNQUFNO1lBQ04sUUFBUSxFQUFFLFFBQVE7U0FDbkIsQ0FBQztRQUNGLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxLQUFLLENBQUMsQ0FBQztJQUNqQyxDQUFDO0lBQ0Q7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7T0FtQkc7SUFDSSxLQUFLLENBQUMsTUFBTSxDQUNqQixPQUFvQixFQUNwQixPQUFvQixFQUNwQixHQUF1QjtRQUV2QixLQUFLLENBQUMsR0FBRyxDQUFDLFFBQVEsR0FBRyxPQUFPLENBQUMsTUFBTSxFQUFFLFlBQVksQ0FBQyxDQUFDO1FBQ25ELE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUU5QyxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDWCxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsbUJBQW1CLENBQzNDLE9BQU8sQ0FBQyxFQUFFLEVBQ1YsR0FBRyxFQUNILFVBQVUsT0FBTyxDQUFDLE1BQU0sWUFBWSxDQUNyQyxDQUFDO1FBQ0osQ0FBQztRQUVELElBQUksQ0FBQyxhQUFhLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUMxQyxNQUFNLFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxPQUFPLEVBQUUsR0FBRyxDQUFDLENBQUM7UUFDekUsT0FBTyxRQUF3QixDQUFDO0lBQ2xDLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7XG4gIE5XUENDb250ZXh0LFxuICBOV1BDUmVxdWVzdCxcbiAgTldQQ1Jlc3BvbnNlLFxuICBOV1BDSGFuZGxlcixcbiAgTldQQ1JvdXRlLFxuICBOV1BDUmVzcG9uc2VPYmplY3QsXG59IGZyb20gXCIuL05XUENSZXNwb25zZVR5cGVzXCI7XG5pbXBvcnQgeyBIYW5kbGVyRW5naW5lIH0gZnJvbSBcIi4vSGFuZGxlckVuZ2luZVwiO1xuaW1wb3J0IHsgRGVidWdMb2dnZXIgfSBmcm9tIFwiQHRhdC1wcm90b2NvbC91dGlsc1wiO1xuXG5jb25zdCBEZWJ1ZyA9IERlYnVnTG9nZ2VyLmdldEluc3RhbmNlKCk7XG5cbi8qKlxuICogUm91dGVyIGNsYXNzIGZvciBoYW5kbGluZyBOV1BDIChOZXR3b3JrIFByb3RvY29sIENvbW11bmljYXRpb24pIHJlcXVlc3RzXG4gKiB3aXRoIHN1cHBvcnQgZm9yIG1pZGRsZXdhcmUgYW5kIG1ldGhvZC1iYXNlZCByb3V0aW5nXG4gKi9cbmV4cG9ydCBjbGFzcyBOV1BDUm91dGVyIHtcbiAgcHJpdmF0ZSByZWFkb25seSByb3V0ZXM6IE1hcDxzdHJpbmcsIE5XUENSb3V0ZT4gPSBuZXcgTWFwKCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgaGFuZGxlckVuZ2luZTogSGFuZGxlckVuZ2luZTtcblxuICBjb25zdHJ1Y3Rvcihyb3V0ZXM6IE1hcDxzdHJpbmcsIE5XUENSb3V0ZT4pIHtcbiAgICB0aGlzLmhhbmRsZXJFbmdpbmUgPSBuZXcgSGFuZGxlckVuZ2luZSgpO1xuICAgIHRoaXMucm91dGVzID0gcm91dGVzO1xuICB9XG5cbiAgcHVibGljIHVzZShtZXRob2Q6IHN0cmluZywgLi4uaGFuZGxlcnM6IE5XUENIYW5kbGVyW10pOiB2b2lkIHtcbiAgICAvLyBWYWxpZGF0ZSB3ZSBoYXZlIGF0IGxlYXN0IG9uZSBoYW5kbGVyXG4gICAgaWYgKGhhbmRsZXJzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXQgbGVhc3Qgb25lIGhhbmRsZXIgaXMgcmVxdWlyZWRcIik7XG4gICAgfVxuXG4gICAgY29uc3Qgcm91dGU6IE5XUENSb3V0ZSA9IHtcbiAgICAgIG1ldGhvZCxcbiAgICAgIGhhbmRsZXJzOiBoYW5kbGVycyxcbiAgICB9O1xuICAgIHRoaXMucm91dGVzLnNldChtZXRob2QsIHJvdXRlKTtcbiAgfVxuICAvKipcbiAgICogUm91dGVzIGFuIGluY29taW5nIE5XUEMgcmVxdWVzdCB0byB0aGUgYXBwcm9wcmlhdGUgaGFuZGxlci5cbiAgICpcbiAgICogVGhpcyBpcyB0aGUgY29yZSByb3V0aW5nIG1ldGhvZCB0aGF0IG1hdGNoZXMgcmVxdWVzdHMgdG8gcmVnaXN0ZXJlZCBoYW5kbGVyc1xuICAgKiBiYXNlZCBvbiB0aGUgbWV0aG9kIG5hbWUuIElmIGEgaGFuZGxlciBpcyBmb3VuZCwgaXQgZXhlY3V0ZXMgdGhlIGhhbmRsZXIgY2hhaW5cbiAgICogKGluY2x1ZGluZyBhbnkgbWlkZGxld2FyZSkgYW5kIHJldHVybnMgdGhlIHJlc3BvbnNlLiBJZiBubyBoYW5kbGVyIGlzIGZvdW5kLFxuICAgKiBpdCByZXR1cm5zIGEgNDA0IGVycm9yLlxuICAgKlxuICAgKiBAcGFyYW0gcmVxdWVzdCAtIFRoZSBpbmNvbWluZyBOV1BDIHJlcXVlc3Qgd2l0aCBtZXRob2QgYW5kIHBhcmFtZXRlcnNcbiAgICogQHBhcmFtIGNvbnRleHQgLSBUaGUgcmVxdWVzdCBjb250ZXh0IGNvbnRhaW5pbmcgc2VuZGVyLCByZWNpcGllbnQsIGFuZCBldmVudCBpbmZvXG4gICAqIEBwYXJhbSByZXMgLSBUaGUgcmVzcG9uc2Ugb2JqZWN0IGZvciBzZW5kaW5nIHJlc3VsdHNcbiAgICogQHJldHVybnMgVGhlIHJlc3BvbnNlIGZyb20gdGhlIGhhbmRsZXIgb3IgYW4gZXJyb3IgcmVzcG9uc2VcbiAgICpcbiAgICogQGV4YW1wbGVcbiAgICogYGBgdHlwZXNjcmlwdFxuICAgKiAvLyBJbnNpZGUgYSBzZXJ2ZXIncyBoYW5kbGVFdmVudCBtZXRob2RcbiAgICogY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnJvdXRlci5oYW5kbGUocmVxdWVzdCwgY29udGV4dCwgcmVzKTtcbiAgICogYXdhaXQgdGhpcy5zZW5kUmVzcG9uc2UocmVzcG9uc2UsIGNvbnRleHQuc2VuZGVyKTtcbiAgICogYGBgXG4gICAqL1xuICBwdWJsaWMgYXN5bmMgaGFuZGxlKFxuICAgIHJlcXVlc3Q6IE5XUENSZXF1ZXN0LFxuICAgIGNvbnRleHQ6IE5XUENDb250ZXh0LFxuICAgIHJlczogTldQQ1Jlc3BvbnNlT2JqZWN0LFxuICApOiBQcm9taXNlPE5XUENSZXNwb25zZT4ge1xuICAgIERlYnVnLmxvZyhcImhhbmRsZVwiICsgcmVxdWVzdC5tZXRob2QsICdOV1BDUm91dGVyJyk7XG4gICAgY29uc3Qgcm91dGUgPSB0aGlzLnJvdXRlcy5nZXQocmVxdWVzdC5tZXRob2QpO1xuXG4gICAgaWYgKCFyb3V0ZSkge1xuICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlckVuZ2luZS5jcmVhdGVFcnJvclJlc3BvbnNlKFxuICAgICAgICByZXF1ZXN0LmlkLFxuICAgICAgICA0MDQsXG4gICAgICAgIGBNZXRob2QgJHtyZXF1ZXN0Lm1ldGhvZH0gbm90IGZvdW5kYCxcbiAgICAgICk7XG4gICAgfVxuXG4gICAgdGhpcy5oYW5kbGVyRW5naW5lLmFkZEFsbChyb3V0ZS5oYW5kbGVycyk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLmhhbmRsZXJFbmdpbmUuZXhlY3V0ZShyZXF1ZXN0LCBjb250ZXh0LCByZXMpO1xuICAgIHJldHVybiByZXNwb25zZSBhcyBOV1BDUmVzcG9uc2U7XG4gIH1cbn1cbiJdfQ==