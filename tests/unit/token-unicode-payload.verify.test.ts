// Regression test for the btoa/atob defect in token serialisation.
//
// `btoa` is a binary-string encoder: it throws InvalidCharacterError on any code
// point above U+00FF. `Payload` carries `data_uri` and a free-form
// `ext: Record<string, unknown>`, so any token whose metadata contained an
// emoji, a non-Latin script, or a smart quote threw at serialisation. For
// creator drops and merchant loyalty tokens — the things people actually issue —
// that is not an edge case.
// NB: imported by path, not via "@tat-protocol/token" — jest maps that specifier
// to tests/mocks/token.ts, which reimplements encoding with Buffer.base64url and
// would therefore pass this test while the real JWT.ts still threw.
import { serializeToken, deserializeToken } from "../../packages/token/src/JWT.js";
import { TokenType } from "../../packages/token/src/Token.js";
import type { Header, Payload } from "../../packages/token/src/Token.js";

const header: Header = {
  alg: "schnorr",
  typ: TokenType.FUNGIBLE,
  token_hash: "a".repeat(64),
  ver: "1.0.0",
};

const basePayload: Payload = {
  iss: "b".repeat(64),
  iat: 1_700_000_000,
  amount: 10,
};

const SIGNATURE = "c".repeat(128);

const roundTrip = (payload: Payload) =>
  deserializeToken(serializeToken(header, payload, SIGNATURE));

describe("token serialisation carries non-ASCII payloads", () => {
  const cases: Array<[string, string]> = [
    ["emoji", "🎁 drop #1 🚀"],
    ["CJK", "限定トークン・限量代幣"],
    ["RTL", "رمز مميز"],
    ["smart quote", "the “golden” ticket — don’t lose it"],
    ["combining marks", "Amélié"],
    ["astral plane", "\u{1D11E}\u{1F600}"],
  ];

  it.each(cases)("round-trips %s in ext", (_label, value) => {
    const payload: Payload = { ...basePayload, ext: { name: value } };
    const { payload: decoded } = roundTrip(payload);
    expect(decoded.ext?.name).toBe(value);
  });

  it.each(cases)("round-trips %s in data_uri", (_label, value) => {
    const payload: Payload = {
      ...basePayload,
      data_uri: `data:text/plain,${value}`,
    };
    const { payload: decoded } = roundTrip(payload);
    expect(decoded.data_uri).toBe(`data:text/plain,${value}`);
  });

  it("preserves the whole structure, not just the string", () => {
    const payload: Payload = {
      ...basePayload,
      tokenID: "🎟️-001",
      data_uri: "data:application/json,{\"emoji\":\"🔥\"}",
      ext: {
        title: "Café — “limited” 限定",
        tags: ["🎨", "音楽"],
        nested: { note: "naïve résumé 🚀" },
        count: 42,
      },
    };
    const { header: h, payload: decoded, signature } = roundTrip(payload);
    expect(decoded).toEqual(payload);
    expect(h).toEqual(header);
    expect(signature).toBe(SIGNATURE);
  });

  it("still produces unpadded base64url", () => {
    // Lengths chosen so at least one segment would need padding.
    const jwt = serializeToken(header, { ...basePayload, ext: { a: "é" } }, SIGNATURE);
    const [h, p] = jwt.split(".");
    for (const segment of [h, p]) {
      expect(segment).not.toContain("=");
      expect(segment).not.toContain("+");
      expect(segment).not.toContain("/");
    }
  });

  it("remains byte-compatible with the previous encoder for ASCII", () => {
    // Existing tokens must keep round-tripping: for pure-ASCII input the new
    // UTF-8 path must produce exactly what btoa(JSON.stringify(...)) produced.
    const payload: Payload = { ...basePayload, tokenID: "plain-ascii-001" };
    const jwt = serializeToken(header, payload, SIGNATURE);
    const legacy = (s: string) =>
      btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    expect(jwt).toBe(
      `${legacy(JSON.stringify(header))}.${legacy(JSON.stringify(payload))}.${SIGNATURE}`,
    );
  });

  it("rejects malformed JWTs rather than throwing on the decode", () => {
    expect(() => deserializeToken("only.two")).toThrow("Invalid JWT format");
    expect(() => deserializeToken("!!!.!!!.sig")).toThrow("Invalid JWT format");
  });
});
