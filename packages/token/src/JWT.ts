import { Payload, Header } from "./Token.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Base64-encode raw bytes.
 *
 * `btoa` is a *binary*-string encoder: it throws InvalidCharacterError on any
 * code point above U+00FF. Feeding it a JSON string directly therefore throws
 * for any token whose metadata contains an emoji, a non-Latin script, or a
 * smart quote — so the UTF-8 encoding has to happen first, and `btoa` only ever
 * sees bytes. Chunked because `String.fromCharCode(...bytes)` blows the
 * argument limit on large payloads (data_uri can be sizeable).
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(
      ...(bytes.subarray(i, i + CHUNK) as unknown as number[]),
    );
  }
  return btoa(binary);
}

/**
 * Decode base64 into raw bytes.
 */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert a string to base64url.
 *
 * Output is byte-identical to the previous implementation for ASCII input, so
 * existing tokens keep round-tripping; input that used to throw now encodes.
 */
function base64url(str: string): string {
  return bytesToBase64(textEncoder.encode(str))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Convert base64url to string.
 */
function base64urlDecode(str: string): string {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  // Re-pad: base64url drops trailing '=', and atob is not required to accept
  // unpadded input.
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return textDecoder.decode(base64ToBytes(padded));
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
