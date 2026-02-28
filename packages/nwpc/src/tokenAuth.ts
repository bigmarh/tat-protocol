import {
  NWPCRequest,
  NWPCContext,
  NWPCResponseObject,
  NWPCResponse,
  NWPCHandler,
  NWPCTokenAuth,
  NWPCRouteMetadata,
} from "./NWPCResponseTypes.js";
import { NWPC_SPEC_ERRORS } from "./errors.js";

/**
 * Validated token information returned by the validation function
 */
export interface ValidatedToken {
  /** Original token JWT string */
  jwt: string;
  /** Token hash for spent tracking */
  hash: string;
  /** Token issuer pubkey */
  issuer: string;
  /** Token audience (if bound) */
  audience?: string;
  /** Token amount (for fungible/payment tokens) */
  amount?: number;
  /** Access scopes/features */
  scopes?: string[];
  /** Token expiration timestamp */
  expiresAt?: number;
  /** Whether the token is expired */
  isExpired: boolean;
  /** Whether the signature is valid */
  isValid: boolean;
  /** Raw token object for handler use */
  raw?: unknown;
}

/**
 * Options for creating the token auth middleware
 */
export interface TokenAuthMiddlewareOptions {
  /**
   * Function to validate and parse a token JWT
   * Should verify signature and extract token info
   */
  validateToken: (jwt: string) => Promise<ValidatedToken | null>;

  /**
   * Function to check if a token has already been spent
   * Only called for payment mode tokens
   */
  isTokenSpent?: (tokenHash: string) => Promise<boolean>;

  /**
   * Function to mark a token as spent
   * Called after successful payment handler execution
   */
  markTokenSpent?: (tokenHash: string) => Promise<void>;

  /**
   * Server pubkey for audience validation
   * If provided, tokens must have matching audience
   */
  serverPubkey?: string;

  /**
   * Function to get route metadata for the current request
   * If not provided, tokenAuth config must be passed per-call
   */
  getRouteMetadata?: (method: string) => NWPCRouteMetadata | undefined;
}

/**
 * Create a token authentication middleware
 *
 * @example
 * ```typescript
 * const tokenAuth = createTokenAuthMiddleware({
 *   validateToken: async (jwt) => {
 *     const token = await Token.restore(jwt);
 *     return {
 *       jwt,
 *       hash: token.getHash(),
 *       issuer: token.payload.iss,
 *       amount: token.payload.amount,
 *       scopes: token.getAccessRules()?.scopes,
 *       isExpired: token.isExpired(),
 *       isValid: token.validate(),
 *       raw: token,
 *     };
 *   },
 *   isTokenSpent: (hash) => forge.isSpent(hash),
 *   serverPubkey: SERVER_PUBKEY,
 * });
 *
 * server.use("protected.method", tokenAuth, handler, {
 *   tokenAuth: { mode: "bearer", scopes: ["read"] }
 * });
 * ```
 */
export function createTokenAuthMiddleware(
  options: TokenAuthMiddlewareOptions,
): NWPCHandler {
  const {
    validateToken,
    isTokenSpent,
    markTokenSpent,
    serverPubkey,
    getRouteMetadata,
  } = options;

  return async (
    req: NWPCRequest,
    ctx: NWPCContext,
    res: NWPCResponseObject,
    next: () => Promise<void>,
  ): Promise<NWPCResponse | void> => {
    // Get token auth config from route metadata
    const metadata = getRouteMetadata?.(req.method);
    const tokenAuth = metadata?.tokenAuth;

    // If no token auth configured, pass through
    if (!tokenAuth?.mode) {
      return next();
    }

    // Extract token from params
    const paramName = tokenAuth.paramName || "_token";
    const tokenJwt = getTokenFromParams(req.params, paramName);

    if (!tokenJwt) {
      return res.error(
        NWPC_SPEC_ERRORS.TOKEN_REQUIRED.code,
        NWPC_SPEC_ERRORS.TOKEN_REQUIRED.message,
      );
    }

    // Validate token
    const validatedToken = await validateToken(tokenJwt);

    if (!validatedToken) {
      return res.error(
        NWPC_SPEC_ERRORS.TOKEN_INVALID.code,
        NWPC_SPEC_ERRORS.TOKEN_INVALID.message,
      );
    }

    if (!validatedToken.isValid) {
      return res.error(
        NWPC_SPEC_ERRORS.TOKEN_INVALID.code,
        NWPC_SPEC_ERRORS.TOKEN_INVALID.message,
      );
    }

    if (validatedToken.isExpired) {
      return res.error(
        NWPC_SPEC_ERRORS.TOKEN_EXPIRED.code,
        NWPC_SPEC_ERRORS.TOKEN_EXPIRED.message,
      );
    }

    // Check audience binding
    // If tokenAuth.audience is explicitly set, enforce it strictly
    // If only serverPubkey is set, allow tokens without audience (backwards compatible)
    // but reject tokens with wrong audience
    const expectedAudience = tokenAuth.audience || serverPubkey;
    if (expectedAudience) {
      if (tokenAuth.audience && !validatedToken.audience) {
        // Explicit audience required but token has none - reject
        return res.error(
          NWPC_SPEC_ERRORS.TOKEN_WRONG_AUDIENCE.code,
          `${NWPC_SPEC_ERRORS.TOKEN_WRONG_AUDIENCE.message}: audience binding required`,
        );
      }
      if (
        validatedToken.audience &&
        validatedToken.audience !== expectedAudience
      ) {
        // Token has audience but it doesn't match - reject
        return res.error(
          NWPC_SPEC_ERRORS.TOKEN_WRONG_AUDIENCE.code,
          NWPC_SPEC_ERRORS.TOKEN_WRONG_AUDIENCE.message,
        );
      }
    }

    // Check issuer - required for BOTH bearer and payment when specified
    // Critical: Without this, any issuer's token with correct scopes would be accepted
    if (tokenAuth.issuerPubkey) {
      if (validatedToken.issuer !== tokenAuth.issuerPubkey) {
        return res.error(
          NWPC_SPEC_ERRORS.TOKEN_WRONG_ISSUER.code,
          NWPC_SPEC_ERRORS.TOKEN_WRONG_ISSUER.message,
        );
      }
    }

    // Mode-specific validation
    if (tokenAuth.mode === "bearer") {
      // Check scopes
      const requiredScopes = tokenAuth.scopes || [];
      const tokenScopes = validatedToken.scopes || [];

      const hasAllScopes = requiredScopes.every((scope) =>
        tokenScopes.includes(scope),
      );

      if (!hasAllScopes) {
        return res.error(
          NWPC_SPEC_ERRORS.INSUFFICIENT_SCOPE.code,
          `${NWPC_SPEC_ERRORS.INSUFFICIENT_SCOPE.message}: requires ${requiredScopes.join(", ")}`,
        );
      }

      // Bearer tokens are not spent
    } else if (tokenAuth.mode === "payment") {
      const cost = tokenAuth.cost || 0;
      const tokenAmount = validatedToken.amount || 0;

      // Check amount
      if (tokenAmount < cost) {
        return res.error(
          NWPC_SPEC_ERRORS.INSUFFICIENT_BALANCE.code,
          `${NWPC_SPEC_ERRORS.INSUFFICIENT_BALANCE.message}: need ${cost}, got ${tokenAmount}`,
        );
      }

      // Check if already spent
      if (isTokenSpent) {
        const spent = await isTokenSpent(validatedToken.hash);
        if (spent) {
          return res.error(
            NWPC_SPEC_ERRORS.TOKEN_SPENT.code,
            NWPC_SPEC_ERRORS.TOKEN_SPENT.message,
          );
        }
      }

      // Set payment info on context for post-handler processing
      ctx.paymentToken = validatedToken.raw || validatedToken;
      ctx.paymentCost = cost;
    }

    // Set validated token on context
    ctx.validatedToken = validatedToken.raw || validatedToken;

    // Continue to next handler
    await next();

    // After handler succeeds, mark payment tokens as spent
    // Note: This runs after next() returns, so handler has completed
    if (tokenAuth.mode === "payment" && markTokenSpent) {
      try {
        await markTokenSpent(validatedToken.hash);
      } catch (err) {
        // Log but don't fail - handler already succeeded
        // The token was effectively spent by the handler execution
        console.error("Failed to mark token as spent:", err);
      }
    }
  };
}

/**
 * Extract token from request params
 */
function getTokenFromParams(
  params: string,
  paramName: string,
): string | undefined {
  try {
    const parsed = JSON.parse(params);
    return typeof parsed[paramName] === "string"
      ? parsed[paramName]
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Create a simple token auth middleware for a specific tokenAuth config
 * Use this when you want to configure token auth inline without route metadata
 */
export function createSimpleTokenAuth(
  tokenAuth: NWPCTokenAuth,
  options: Omit<TokenAuthMiddlewareOptions, "getRouteMetadata">,
): NWPCHandler {
  return createTokenAuthMiddleware({
    ...options,
    getRouteMetadata: () => ({ tokenAuth }),
  });
}
