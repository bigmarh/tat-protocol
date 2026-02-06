/**
 * Legacy NWPC error codes (HTTP-style) for familiarity.
 *
 * NOTE: PROTOCOL_SPEC.md defines the canonical 1000/2000/3000 series.
 * New code SHOULD use NWPC_SPEC_ERRORS.
 */
export const NWPC_ERRORS = {
  // Authentication errors (401)
  TOKEN_REQUIRED: { code: 401, message: "Token required" },
  TOKEN_INVALID: { code: 401, message: "Invalid token signature" },
  TOKEN_EXPIRED: { code: 401, message: "Token expired" },
  UNAUTHORIZED: { code: 401, message: "Unauthorized" },

  // Payment errors (402)
  INSUFFICIENT_AMOUNT: { code: 402, message: "Insufficient payment amount" },
  TOKEN_SPENT: { code: 402, message: "Token already spent" },
  PAYMENT_REQUIRED: { code: 402, message: "Payment required" },

  // Authorization errors (403)
  INSUFFICIENT_SCOPE: { code: 403, message: "Insufficient token scope" },
  TOKEN_WRONG_AUDIENCE: {
    code: 403,
    message: "Token not valid for this server",
  },
  TOKEN_WRONG_ISSUER: { code: 403, message: "Token from untrusted issuer" },
  FORBIDDEN: { code: 403, message: "Forbidden" },

  // Client errors (4xx)
  BAD_REQUEST: { code: 400, message: "Bad request" },
  METHOD_NOT_FOUND: { code: 404, message: "Method not found" },
  RATE_LIMITED: { code: 429, message: "Rate limit exceeded" },

  // Server errors (5xx)
  INTERNAL_ERROR: { code: 500, message: "Internal server error" },
  NOT_IMPLEMENTED: { code: 501, message: "Not implemented" },
} as const;

/**
 * PROTOCOL_SPEC.md compliant error codes (1000/2000/3000 series)
 * Use these for strict protocol compliance.
 */
export const NWPC_SPEC_ERRORS = {
  // Parse/Request errors (1000 series)
  PARSE_ERROR: { code: 1000, message: "Parse Error" },
  INVALID_REQUEST: { code: 1001, message: "Invalid Request" },
  METHOD_NOT_FOUND: { code: 1002, message: "Method Not Found" },
  INVALID_PARAMS: { code: 1003, message: "Invalid Params" },
  RATE_LIMITED: { code: 1004, message: "Rate Limited" },
  NOT_FOUND: { code: 1005, message: "Not Found" },

  // Token errors (2000 series)
  TOKEN_INVALID: { code: 2000, message: "Token Invalid" },
  TOKEN_EXPIRED: { code: 2001, message: "Token Expired" },
  TOKEN_SPENT: { code: 2002, message: "Token Spent" },
  INSUFFICIENT_BALANCE: { code: 2003, message: "Insufficient Balance" },
  UNAUTHORIZED: { code: 2004, message: "Unauthorized" },
  SUPPLY_LIMIT: { code: 2005, message: "Supply Limit" },
  TOKEN_REQUIRED: { code: 2006, message: "Token Required" },
  INSUFFICIENT_SCOPE: { code: 2007, message: "Insufficient Scope" },
  TOKEN_WRONG_AUDIENCE: { code: 2008, message: "Token Wrong Audience" },
  TOKEN_WRONG_ISSUER: { code: 2009, message: "Token Wrong Issuer" },

  // Server errors (3000 series)
  INTERNAL_ERROR: { code: 3000, message: "Internal Error" },
} as const;

export type NWPCErrorCode =
  | keyof typeof NWPC_SPEC_ERRORS
  | keyof typeof NWPC_ERRORS;

/**
 * Create an error response object.
 * Prefers spec-compliant codes when available.
 */
export function createError(
  errorCode: NWPCErrorCode,
  customMessage?: string,
): { code: number; message: string } {
  const specError =
    NWPC_SPEC_ERRORS[errorCode as keyof typeof NWPC_SPEC_ERRORS];
  const legacyError = NWPC_ERRORS[errorCode as keyof typeof NWPC_ERRORS];
  const error = specError || legacyError;
  return {
    code: error.code,
    message: customMessage || error.message,
  };
}
