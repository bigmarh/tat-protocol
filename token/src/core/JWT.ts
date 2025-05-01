
import { Payload, Header } from "./Token";

/**
 * Convert a string to base64url
 */
function base64url(str: string): string {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Convert base64url to string
 */
function base64urlDecode(str: string): string {
  return atob(str.replace(/-/g, "+").replace(/_/g, "/"));
}

/**
 * Serialize a token to JWT format
 */
export function serializeToken(
  header: Header,
  payload: Payload,
  signature: string,
): string {
  const headerBase64 = base64url(JSON.stringify(header));
  const payloadBase64 = base64url(JSON.stringify(payload));
  return `${headerBase64}.${payloadBase64}.${signature}`;
}

/**
 * Deserialize a JWT token
 */
export function deserializeToken(jwt: string): {
  header: Header;
  payload: Payload;
  signature: string;
} {
  const [headerBase64, payloadBase64, signature] = jwt.split(".");
  if (!headerBase64 || !payloadBase64 || !signature) {
    throw new Error("Invalid JWT format");
  }

  try {
    const header = JSON.parse(base64urlDecode(headerBase64));
    const payload = JSON.parse(base64urlDecode(payloadBase64));
    return { header, payload, signature };
  } catch (error) {
    throw new Error("Invalid JWT format");
  }
}
