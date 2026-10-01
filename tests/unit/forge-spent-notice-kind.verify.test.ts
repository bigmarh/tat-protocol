// Regression test for the spent-notice relay discipline fix.
//
// Two defects in the original publish path:
//   1. kind 1 is the short-text-note kind, so every spend rendered as a garbage
//      post in any social client following the forge's pubkey;
//   2. the token hash rode in the `t` tag — the NIP-01 *hashtag* tag, which
//      relays index globally. That wrote every spent token hash into the public
//      hashtag index of every relay the note reached (a transaction-graph leak)
//      and is the kind of tag abuse relays rate-limit or ban for.
//
// The hash now travels in a multi-letter, non-indexed tag, and notices are
// published under a dedicated kind — with the legacy kind emitted alongside
// during the transition so pockets on an older SDK keep reconciling.
import "@tat-protocol/nwpc";
import { FungibleForge } from "@tat-protocol/forge";
import {
  KIND_TOKEN_SPENT,
  LEGACY_KIND_TOKEN_SPENT,
  TAG_TOKEN_HASH,
} from "@tat-protocol/utils";
import type { StorageInterface } from "@tat-protocol/storage";
import { schnorr } from "@noble/curves/secp256k1";
import { bytesToHex } from "@noble/hashes/utils";

const OWNER_SK = "44".repeat(32);
const OWNER = bytesToHex(schnorr.getPublicKey(OWNER_SK));
const TOKEN_HASH = "d".repeat(64);

class MemStore implements StorageInterface {
  private m = new Map<string, string>();
  async getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  async setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  async removeItem(k: string) {
    this.m.delete(k);
  }
  async clear() {
    this.m.clear();
  }
}

interface CapturedEvent {
  kind: number;
  content: string;
  tags: string[][];
}

/**
 * Build a forge whose publication path is captured rather than sent.
 *
 * A signer is installed so publishSpentToken takes the signEvent branch, which
 * is where the event is fully formed — that lets the test assert on kind and
 * tags without a relay.
 */
function makeForge(opts: { publishLegacySpentNotes?: boolean } = {}) {
  const published: CapturedEvent[] = [];
  const forge = new FungibleForge({
    owner: OWNER,
    keys: { secretKey: OWNER_SK, publicKey: OWNER },
    storage: new MemStore(),
    totalSupply: 0,
    relays: [],
    ...opts,
  } as any);
  (forge as any).keys = { secretKey: OWNER_SK, publicKey: OWNER };
  (forge as any).getPublicKey = () => OWNER;
  (forge as any).signer = {
    signEvent: async (event: CapturedEvent) => {
      published.push(event);
      // Reject the publish leg: publication is fire-and-forget and the error is
      // swallowed by design, so the test observes the event without needing NDK.
      throw new Error("capture-only");
    },
  };
  return { forge: forge as any, published };
}

async function publish(forge: any) {
  await forge.publishSpentToken(TOKEN_HASH);
  // The publish chain is fire-and-forget; let its microtasks settle.
  await new Promise((r) => setTimeout(r, 0));
}

describe("spent notices use a dedicated kind and a non-indexed tag", () => {
  it("never publishes the token hash in a `t` tag", async () => {
    const { forge, published } = makeForge();
    await publish(forge);

    expect(published.length).toBeGreaterThan(0);
    for (const event of published) {
      const tTags = event.tags.filter((tag) => tag[0] === "t");
      expect(tTags).toHaveLength(0);
      // ...and the hash is still carried, just not where relays index it.
      expect(event.tags).toContainEqual([TAG_TOKEN_HASH, TOKEN_HASH]);
    }
  });

  it("publishes under the dedicated kind", async () => {
    const { forge, published } = makeForge();
    await publish(forge);

    const kinds = published.map((e) => e.kind);
    expect(kinds).toContain(KIND_TOKEN_SPENT);
  });

  it("keeps the content format pockets already parse", async () => {
    const { forge, published } = makeForge();
    await publish(forge);

    for (const event of published) {
      expect(event.content).toBe(`spent:${TOKEN_HASH}`);
    }
  });

  it("also emits the legacy kind by default, so older pockets still reconcile", async () => {
    const { forge, published } = makeForge();
    await publish(forge);

    const kinds = published.map((e) => e.kind);
    expect(kinds).toContain(LEGACY_KIND_TOKEN_SPENT);
    expect(published).toHaveLength(2);
  });

  it("stops emitting the legacy kind when the transition is switched off", async () => {
    const { forge, published } = makeForge({ publishLegacySpentNotes: false });
    await publish(forge);

    expect(published).toHaveLength(1);
    expect(published[0].kind).toBe(KIND_TOKEN_SPENT);
    expect(published.map((e) => e.kind)).not.toContain(
      LEGACY_KIND_TOKEN_SPENT,
    );
  });

  it("marks the token spent even when relay publication fails", async () => {
    // Publication is fire-and-forget precisely so a relay outage cannot block a
    // transfer response; the spent-set write must not depend on it.
    const { forge } = makeForge();
    await publish(forge);
    expect(forge.state.spentTokens.has(TOKEN_HASH)).toBe(true);
  });

  it("uses a dedicated kind outside the short-text-note range", async () => {
    // Guards the constant itself: a regular-range kind (1000-9999) is what
    // relays retain, and it must not collide with kind 1.
    expect(KIND_TOKEN_SPENT).toBeGreaterThanOrEqual(1000);
    expect(KIND_TOKEN_SPENT).toBeLessThanOrEqual(9999);
    expect(KIND_TOKEN_SPENT).not.toBe(LEGACY_KIND_TOKEN_SPENT);
    // Multi-letter tags are the un-indexed ones; a single letter would put the
    // hash straight back into a relay index.
    expect(TAG_TOKEN_HASH.length).toBeGreaterThan(1);
  });
});
