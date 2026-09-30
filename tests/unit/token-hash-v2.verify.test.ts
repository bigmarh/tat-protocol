// A7: the lossy token hash.
//
// token_hash was sha256(TextDecoder().decode(sha256(payload))): the raw 32-byte
// digest was decoded as UTF-8 before the second hash. Most digests are not
// valid UTF-8, and every invalid sequence collapses to U+FFFD, so distinct
// digests map to the same string and the same token_hash. Other languages'
// decoders replace invalid bytes differently, so no other implementation could
// reproduce the hash.
//
// New tokens (header ver 2.0.0) hash the hex of the first digest under a domain
// tag. v1 tokens still verify under the v1 rule, so nothing issued is stranded,
// and a token's version cannot be relabelled without breaking its hash.
import { Token, TokenType } from "../../packages/token/src/index";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

const enc = (s: string) => new TextEncoder().encode(s);

/** v2, written out independently of the SDK. */
function v2Hash(payloadB64: string): string {
  const first = bytesToHex(sha256(enc(JSON.stringify(payloadB64))));
  return bytesToHex(sha256(enc("TAT-TOKEN-HASH-v2\n" + first)));
}

/** v1, the legacy rule, for tokens already issued. */
function v1Hash(payloadB64: string): string {
  const first = sha256(enc(JSON.stringify(payloadB64)));
  return bytesToHex(sha256(enc(new TextDecoder().decode(first))));
}

async function build() {
  const t = new Token();
  await t.build({
    token_type: TokenType.FUNGIBLE,
    payload: Token.createPayload({ iss: "f".repeat(64), amount: 7 }),
  });
  return t;
}

describe("token hash v2", () => {
  it("the v1 rule really is lossy: distinct digests decode to the same string", () => {
    const a = new Uint8Array(32).fill(0x80);
    const b = new Uint8Array(32).fill(0x81);
    expect(new TextDecoder().decode(a)).toBe(new TextDecoder().decode(b));
  });

  it("new tokens are version 2.0.0 and hash the hex of the first digest", async () => {
    const t = await build();
    expect(t.header.ver).toBe("2.0.0");
    expect(t.header.token_hash).toBe(v2Hash((t as any).encode_payload()));
    expect(await t.verifyTokenHash()).toBe(true);
  });

  it("still verifies tokens issued under v1", async () => {
    const t = await build();
    t.header.ver = "1.0.0";
    t.header.token_hash = v1Hash((t as any).encode_payload());
    expect(await t.verifyTokenHash()).toBe(true);
    // And re-hashing a v1 token keeps it v1, so its spent-set key is stable.
    expect(await t.create_token_hash()).toBe(v1Hash((t as any).encode_payload()));
  });

  it("refuses a token whose version was relabelled", async () => {
    const v2 = await build();
    v2.header.ver = "1.0.0";
    expect(await v2.verifyTokenHash()).toBe(false);

    const v1 = await build();
    v1.header.ver = "1.0.0";
    v1.header.token_hash = v1Hash((v1 as any).encode_payload());
    v1.header.ver = "2.0.0";
    expect(await v1.verifyTokenHash()).toBe(false);
  });

  it("keeps its version and hash through a JWT round trip", async () => {
    const t = await build();
    const jwt = await t.toJWT("00".repeat(64));
    const back = await new Token().restore(jwt);
    expect(back.header.ver).toBe("2.0.0");
    expect(back.header.token_hash).toBe(t.header.token_hash);
    expect(await back.verifyTokenHash()).toBe(true);
  });
});
