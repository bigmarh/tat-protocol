import {
  NWPCRequest,
  NWPCContext,
  NWPCResponseObject,
  NWPCResponse,
  NWPCIntrospectionConfig,
  NWPCHandler,
} from "./NWPCResponseTypes";
import { NWPCRouter } from "./NWPCRouter";

/**
 * Token auth info exposed in introspection
 */
export interface NWPCInfoTokenAuth {
  mode: "bearer" | "payment";
  issuerPubkey?: string;
  audience?: string;
  scopes?: string[];
  cost?: number;
  maxAmount?: number;
  acquireMethod?: string;
  acquireHint?: string;
  relays?: string[];
  paramName?: string;
}

/**
 * Method info exposed in introspection
 */
export interface NWPCInfoMethod {
  name: string;
  description?: string;
  params?: Record<
    string,
    { type: string; description?: string; required?: boolean }
  >;
  result?: { type: string; description?: string };
  auth?: string;
  tokenAuth?: NWPCInfoTokenAuth;
  deprecated?: boolean;
  tags?: string[];
  idempotent?: boolean;
  rateLimit?: { requests: number; windowMs: number };
  examples?: Array<{
    name?: string;
    params: Record<string, unknown>;
    result?: unknown;
  }>;
  errors?: Array<{
    code: number;
    message: string;
    when: string;
  }>;
}

/**
 * Response format for the nwpc.info introspection method
 */
export interface NWPCInfoResponse {
  server: {
    name?: string;
    version?: string;
    description?: string;
    pubkey?: string;
  };
  protocol: { name: "NWPC"; version: "1.0" };
  methods: NWPCInfoMethod[];
  timestamp: number;
}

/**
 * Create the nwpc.info handler for server introspection
 * @param router - The NWPCRouter instance to inspect
 * @param config - Introspection configuration
 * @param getPublicKey - Function to get the server's public key
 * @returns An NWPCHandler for the nwpc.info method
 */
export function createInfoHandler(
  router: NWPCRouter,
  config: NWPCIntrospectionConfig,
  getPublicKey: () => string | undefined,
): NWPCHandler {
  return async (
    _req: NWPCRequest,
    context: NWPCContext,
    res: NWPCResponseObject,
  ): Promise<NWPCResponse | void> => {
    const routes = router.listRoutes();

    const methods: NWPCInfoMethod[] = routes
      .filter((r) => r.metadata)
      .map((route) => {
        const meta = route.metadata!;

        // Build tokenAuth info if present
        const tokenAuth: NWPCInfoTokenAuth | undefined = meta.tokenAuth
          ? {
              mode: meta.tokenAuth.mode,
              issuerPubkey: meta.tokenAuth.issuerPubkey,
              audience: meta.tokenAuth.audience,
              scopes: meta.tokenAuth.scopes,
              cost: meta.tokenAuth.cost,
              maxAmount: meta.tokenAuth.maxAmount,
              acquireMethod: meta.tokenAuth.acquireMethod,
              acquireHint: meta.tokenAuth.acquireHint,
              relays: meta.tokenAuth.relays,
              paramName: meta.tokenAuth.paramName,
            }
          : undefined;

        return {
          name: route.method,
          description: meta.description,
          params: meta.paramsSchema
            ? Object.fromEntries(
                Object.entries(meta.paramsSchema).map(([k, v]) => [
                  k,
                  {
                    type: v.type,
                    description: v.description,
                    required: v.required,
                  },
                ]),
              )
            : undefined,
          result: meta.resultSchema
            ? {
                type: meta.resultSchema.type,
                description: meta.resultSchema.description,
              }
            : undefined,
          auth: meta.auth,
          tokenAuth,
          deprecated: meta.deprecated,
          tags: meta.tags,
          idempotent: meta.idempotent,
          rateLimit: meta.rateLimit,
          examples: meta.examples,
          errors: meta.errors,
        };
      });

    const response: NWPCInfoResponse = {
      server: {
        name: config.serverName,
        version: config.serverVersion,
        description: config.serverDescription,
        pubkey: getPublicKey(),
      },
      protocol: { name: "NWPC", version: "1.0" },
      methods,
      timestamp: Date.now(),
    };

    return res.send(response, context.sender);
  };
}

/**
 * Register the introspection handler on the router
 * @param router - The NWPCRouter to register on
 * @param config - Introspection configuration
 * @param getPublicKey - Function to get the server's public key
 */
export function registerIntrospection(
  router: NWPCRouter,
  config: NWPCIntrospectionConfig,
  getPublicKey: () => string | undefined,
): void {
  if (!config.enabled) return;

  router.use("nwpc.info", createInfoHandler(router, config, getPublicKey), {
    description: "Discover server capabilities and available methods",
    auth: "public",
    tags: ["introspection"],
  });
}
