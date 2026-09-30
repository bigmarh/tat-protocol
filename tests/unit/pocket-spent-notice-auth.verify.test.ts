// A pocket deleted tokens on a fake "spent" message.
//
// DM path: any key could gift-wrap `{ result: { spent: h, issuer: X } }` to a
// pocket, and the pocket deleted its token h from issuer X — the seal only
// proved who SENT the message, and nothing compared that to X.
// Feed path: the `issuer` field inside the content overrode the event's author,
// and the author's signature was assumed checked by the relay.
//
// Now a spent notice is acted on only when the issuer of the token signed it:
// the seal's sender for a DM, the locally verified author for a feed event.
jest.mock("@tat-protocol/nwpc", () => jest.requireActual("../../packages/nwpc/src/index"));

import { Pocket } from "../../packages/pocket/src/Pocket";
import { Wrap } from "../../packages/utils/src/Nostr";
import NDK from "@nostr-dev-kit/ndk";
import { finalizeEvent, getPublicKey } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { KIND_TOKEN_SPENT } from "@tat-protocol/utils";

const key = (hex: string) => ({ secretKey: hex, publicKey: getPublicKey(hexToBytes(hex)) });
const ME = key("01".repeat(32));
const ISSUER = key("02".repeat(32));
const OTHER_ISSUER = key("03".repeat(32));
const MALLORY = key("04".repeat(32));
const H = "aa".repeat(32);
const H_OTHER = "bb".repeat(32);

function pocket() {
  const p = Object.create(Pocket.prototype) as any;
  Object.assign(p, {
    publicKey: ME.publicKey,
    keys: ME,
    config: {},
    hooks: {},
    responseHandlers: new Map(),
    state: {
      relays: new Set(),
      singleUseKeys: new Map(),
      tokens: new Map([
        [ISSUER.publicKey, new Map([[H, "jwt-H"]])],
        [OTHER_ISSUER.publicKey, new Map([[H_OTHER, "jwt-H-other"]])],
      ]),
    },
    deleted: [] as string[],
    remembered: [] as string[],
    isEventProcessed: () => false,
    markEventProcessed: () => undefined,
    noteEventSeen: () => undefined,
    savePocketState: async () => undefined,
    storeToken: async () => true,
  });
  p.deleteToken = async (jwt: string) => void p.deleted.push(jwt);
  p.rememberSpent = (issuer: string, hash: string) => void p.remembered.push(`${issuer}:${hash}`);
  return p;
}

const ndk = new NDK({ explicitRelayUrls: [] });
async function dm(from: typeof ME, body: unknown) {
  return await Wrap(ndk, JSON.stringify(body), from, ME.publicKey);
}

function feedEvent(signer: typeof ME, content: string, opts: { tamper?: boolean } = {}) {
  const raw = finalizeEvent(
    {
      kind: KIND_TOKEN_SPENT,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["p", ISSUER.publicKey]],
      content,
    },
    hexToBytes(signer.secretKey),
  );
  // Tampering with anything the id commits to breaks the signature while
  // leaving the notice's content — and so the token it names — intact.
  // Plain fields only: finalizeEvent caches "verified" on its result under a
  // Symbol, which a spread would carry along. Events off a relay have none.
  const ev = {
    id: raw.id,
    pubkey: raw.pubkey,
    sig: raw.sig,
    kind: raw.kind,
    tags: raw.tags,
    content: raw.content,
    created_at: opts.tamper ? raw.created_at + 1 : raw.created_at,
  };
  return { ...ev, rawEvent: () => ev };
}

describe("spent notices by DM", () => {
  it("acts on a notice sealed by the token's issuer", async () => {
    const p = pocket();
    await p.handleEvent(await dm(ISSUER, { id: "x", result: { spent: H, issuer: ISSUER.publicKey } }));
    expect(p.deleted).toEqual(["jwt-H"]);
  });

  it("ignores a notice from anyone else naming the issuer", async () => {
    const p = pocket();
    await p.handleEvent(await dm(MALLORY, { id: "x", result: { spent: H, issuer: ISSUER.publicKey } }));
    expect(p.deleted).toEqual([]);
    expect(p.remembered).toEqual([]);
  });

  it("ignores an issuer's notice about another issuer's token", async () => {
    const p = pocket();
    await p.handleEvent(await dm(ISSUER, { id: "x", result: { spent: H_OTHER, issuer: OTHER_ISSUER.publicKey } }));
    expect(p.deleted).toEqual([]);
  });

  it("ignores a TOKEN_SPENT error reply from anyone but the issuer", async () => {
    const p = pocket();
    p.responseHandlers.set("req-1", { resolve: () => undefined, timeoutId: undefined });
    await p.handleEvent(
      await dm(MALLORY, {
        id: "req-1",
        error: { code: 2002, message: "Token Spent", params: JSON.stringify({ spent: H, issuer: ISSUER.publicKey }) },
      }),
    );
    expect(p.deleted).toEqual([]);
  });
});

describe("spent notices on the issuer feed", () => {
  it("acts on a notice the issuer signed", async () => {
    const p = pocket();
    await p.handleIssuerSpentEvent(feedEvent(ISSUER, `spent:${H}`), ISSUER.publicKey);
    expect(p.deleted).toEqual(["jwt-H"]);
  });

  it("ignores a notice another key signed, whatever its content claims", async () => {
    const p = pocket();
    await p.handleIssuerSpentEvent(
      feedEvent(MALLORY, JSON.stringify({ spent: H, issuer: ISSUER.publicKey })),
      ISSUER.publicKey,
    );
    expect(p.deleted).toEqual([]);
  });

  it("ignores a notice whose signature does not verify", async () => {
    const p = pocket();
    await p.handleIssuerSpentEvent(feedEvent(ISSUER, `spent:${H}`, { tamper: true }), ISSUER.publicKey);
    expect(p.deleted).toEqual([]);
  });

  it("does not let an issuer's notice name another issuer's token", async () => {
    const p = pocket();
    await p.handleIssuerSpentEvent(
      feedEvent(ISSUER, JSON.stringify({ spent: H_OTHER, issuer: OTHER_ISSUER.publicKey })),
      ISSUER.publicKey,
    );
    expect(p.deleted).toEqual([]);
  });
});
