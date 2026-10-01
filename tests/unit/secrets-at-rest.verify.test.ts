// Plaintext secrets at rest.
//
// NodeStore encrypted only if TAT_STORAGE_ENCRYPTION_KEY happened to be set
// (with an unsalted sha256 of it as the key), and handed back plaintext it
// found on disk even when a key WAS set — so a file swapped for plaintext was
// accepted. BrowserStore never encrypted. The forge wrote its secret key, and
// the pocket its mnemonic and single-use keys, into whatever storage it had.
//
// Now encryption is the default: a store with no key refuses to construct
// unless told `allowPlaintext`, an encrypted store refuses to read plaintext,
// and the forge and pocket refuse to put secrets into storage that does not
// encrypt at rest.
import { NodeStore } from "../../packages/storage/src/DiskStorage";
import { EncryptedStorage } from "../../packages/storage/src/EncryptedStorage";
import { createCipheriv, createHash, randomBytes } from "crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "@tat-protocol/nwpc";
import { FungibleForge } from "@tat-protocol/forge";
import { Pocket } from "../../packages/pocket/src/Pocket";

const SECRET = JSON.stringify({ secretKey: "5e".repeat(32), publicKey: "pk" });
// Keep the KDF cheap in tests; production uses the 600k default.
const FAST = { kdfIterations: 1000 };

class MemStore {
  m = new Map<string, string>();
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

describe("NodeStore encrypts by default and fails closed", () => {
  let dir: string;
  const prevKey = process.env.TAT_STORAGE_ENCRYPTION_KEY;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tat-secrets-"));
    delete process.env.TAT_STORAGE_ENCRYPTION_KEY;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (prevKey === undefined) delete process.env.TAT_STORAGE_ENCRYPTION_KEY;
    else process.env.TAT_STORAGE_ENCRYPTION_KEY = prevKey;
  });

  const fileOf = (key: string) => readFileSync(join(dir, `${key}.json`), "utf-8");

  it("refuses to construct without a key unless plaintext is explicitly allowed", () => {
    expect(() => new NodeStore(dir)).toThrow(/encryption key/i);
    expect(() => new NodeStore(dir, { allowPlaintext: true })).not.toThrow();
  });

  it("writes only ciphertext, and reads it back with the same passphrase", async () => {
    const a = new NodeStore(dir, { passphrase: "correct horse", ...FAST });
    expect(a.encryptsAtRest).toBe(true);
    await a.setItem("forge-keys-x", SECRET);
    expect(fileOf("forge-keys-x")).toMatch(/^enc:v2:/);
    expect(fileOf("forge-keys-x")).not.toContain("5e5e5e");

    const b = new NodeStore(dir, { passphrase: "correct horse", ...FAST });
    expect(await b.getItem("forge-keys-x")).toBe(SECRET);
    const wrong = new NodeStore(dir, { passphrase: "wrong", ...FAST });
    await expect(wrong.getItem("forge-keys-x")).rejects.toThrow();
  });

  it("uses the environment passphrase when none is passed", async () => {
    process.env.TAT_STORAGE_ENCRYPTION_KEY = "from-env";
    const s = new NodeStore(dir, FAST);
    await s.setItem("k", "v");
    expect(fileOf("k")).toMatch(/^enc:v2:/);
  });

  it("refuses plaintext it finds on disk, until migratePlaintext() encrypts it", async () => {
    writeFileSync(join(dir, "pocket-idkey-x.json"), SECRET);
    const s = new NodeStore(dir, { passphrase: "p", ...FAST });
    await expect(s.getItem("pocket-idkey-x")).rejects.toThrow(/unencrypted/i);

    expect(await s.migratePlaintext()).toBe(1);
    expect(fileOf("pocket-idkey-x")).toMatch(/^enc:v2:/);
    expect(await s.getItem("pocket-idkey-x")).toBe(SECRET);
  });

  it("still reads values written by the old enc:v1 scheme, and rewrites them as v2", async () => {
    const legacyKey = createHash("sha256").update("old-pass", "utf-8").digest();
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", legacyKey, iv);
    const ct = Buffer.concat([c.update(SECRET, "utf-8"), c.final()]);
    writeFileSync(
      join(dir, "legacy.json"),
      `enc:v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${ct.toString("base64")}`,
    );
    const s = new NodeStore(dir, { passphrase: "old-pass", ...FAST });
    expect(await s.getItem("legacy")).toBe(SECRET);
    expect(await s.migratePlaintext()).toBe(1);
    expect(fileOf("legacy")).toMatch(/^enc:v2:/);
  });

  it("will not open a ciphertext moved to a different key", async () => {
    // Without associated data every value sealed under the store's key opened
    // anywhere: a writer could copy one key's ciphertext over another's.
    const s = new NodeStore(dir, { passphrase: "p", ...FAST });
    await s.setItem("forge-state-a", JSON.stringify({ spent: ["x"] }));
    await s.setItem("forge-state-b", JSON.stringify({ spent: [] }));
    writeFileSync(join(dir, "forge-state-b.json"), fileOf("forge-state-a"));
    await expect(s.getItem("forge-state-b")).rejects.toThrow();
  });

  it("detects tampering", async () => {
    const s = new NodeStore(dir, { passphrase: "p", ...FAST });
    await s.setItem("k", SECRET);
    const raw = fileOf("k");
    writeFileSync(join(dir, "k.json"), raw.slice(0, -4) + (raw.endsWith("A") ? "BBBB" : "AAAA"));
    await expect(s.getItem("k")).rejects.toThrow();
  });

  it("stays usable as a plaintext store when explicitly asked", async () => {
    const s = new NodeStore(dir, { allowPlaintext: true });
    expect(s.encryptsAtRest).toBe(false);
    await s.setItem("k", "v");
    expect(fileOf("k")).toBe("v");
    expect(readdirSync(dir)).toEqual(["k.json"]);
  });
});

describe("BrowserStore encrypts by default and fails closed", () => {
  const ls = new Map<string, string>();
  let BrowserStore: any;
  beforeAll(async () => {
    (globalThis as any).window = {
      localStorage: {
        getItem: (k: string) => ls.get(k) ?? null,
        setItem: (k: string, v: string) => void ls.set(k, v),
        removeItem: (k: string) => void ls.delete(k),
        clear: () => ls.clear(),
        key: (i: number) => [...ls.keys()][i] ?? null,
        get length() {
          return ls.size;
        },
      },
    };
    ({ BrowserStore } = await import("../../packages/storage/src/BrowserStorage"));
  });
  afterAll(() => {
    delete (globalThis as any).window;
  });
  beforeEach(() => ls.clear());

  it("refuses to construct without a key unless plaintext is explicitly allowed", () => {
    expect(() => new BrowserStore()).toThrow(/encryption key/i);
    expect(() => new BrowserStore({ allowPlaintext: true })).not.toThrow();
  });

  it("keeps only ciphertext in localStorage", async () => {
    const s = new BrowserStore({ passphrase: "p", ...FAST });
    expect(s.encryptsAtRest).toBe(true);
    await s.setItem("pocket-state-x", SECRET);
    expect(ls.get("pocket-state-x")).toMatch(/^enc:v2:/);
    expect(await s.getItem("pocket-state-x")).toBe(SECRET);
  });

  it("will not open a ciphertext moved to a different key", async () => {
    const s = new BrowserStore({ passphrase: "p", ...FAST });
    await s.setItem("a", "1");
    await s.setItem("b", "2");
    ls.set("b", ls.get("a")!);
    await expect(s.getItem("b")).rejects.toThrow();
  });

  it("migrates only the keys it is told to, leaving other code's data alone", async () => {
    ls.set("pocket-idkey-x", SECRET);
    ls.set("some-other-app-setting", "dark-mode");
    const s = new BrowserStore({ passphrase: "p", ...FAST });
    expect(await s.migratePlaintext(["pocket-idkey-x"])).toBe(1);
    expect(ls.get("pocket-idkey-x")).toMatch(/^enc:v2:/);
    expect(ls.get("some-other-app-setting")).toBe("dark-mode");
  });

  it("refuses plaintext it finds", async () => {
    ls.set("pocket-idkey-x", SECRET);
    const s = new BrowserStore({ passphrase: "p", ...FAST });
    await expect(s.getItem("pocket-idkey-x")).rejects.toThrow(/unencrypted/i);
  });
});

describe("EncryptedStorage seals any backend", () => {
  it("stores ciphertext in the backend and refuses plaintext", async () => {
    const backend = new MemStore();
    const s = new EncryptedStorage(backend, { passphrase: "p", createSalt: true, ...FAST });
    await s.setItem("k", SECRET);
    expect(backend.m.get("k")).toMatch(/^enc:v2:/);
    expect(await s.getItem("k")).toBe(SECRET);
    backend.m.set("plain", SECRET);
    await expect(s.getItem("plain")).rejects.toThrow(/unencrypted/i);
    expect(await s.migratePlaintext(["plain"])).toBe(1);
    expect(await s.getItem("plain")).toBe(SECRET);
  });

  it("will not open a ciphertext moved to a different key", async () => {
    const backend = new MemStore();
    const s = new EncryptedStorage(backend, { passphrase: "p", createSalt: true, ...FAST });
    await s.setItem("a", "1");
    await s.setItem("b", "2");
    backend.m.set("b", backend.m.get("a")!);
    await expect(s.getItem("b")).rejects.toThrow();
  });
});

describe("EncryptedStorage replicas agree on one salt", () => {
  it("will not keep a salt in the backend unless told there is a single writer", () => {
    // The backend has no compare-and-set, so two replicas creating a salt
    // there can each write their own — and one replica's data is then lost.
    expect(() => new EncryptedStorage(new MemStore(), { passphrase: "p", ...FAST })).toThrow(/salt/i);
    expect(() => new EncryptedStorage(new MemStore(), { passphrase: "p", createSalt: true, ...FAST })).not.toThrow();
  });

  it("refuses to seal once another writer has replaced the stored salt", async () => {
    // Asymmetric latency: A creates, writes and re-reads its salt before B's
    // slower write lands. A must not go on sealing under a salt nobody else
    // will derive after a restart.
    const backend = new MemStore();
    const a = new EncryptedStorage(backend, { passphrase: "p", createSalt: true, ...FAST });
    await a.setItem("first", "1");
    backend.m.set("__tat_kdf_salt__", "cd".repeat(16)); // B's late write
    await expect(a.setItem("second", "2")).rejects.toThrow(/salt/i);
    expect(backend.m.has("second")).toBe(false);
  });

  it("rejects a malformed salt", () => {
    for (const salt of ["", "abc", "zz".repeat(16), "ab".repeat(4)]) {
      expect(() => new EncryptedStorage(new MemStore(), { passphrase: "p", salt, ...FAST })).toThrow(/salt/i);
    }
  });

  it("uses a salt supplied in config, so replicas need not race for one", async () => {
    const backend = new MemStore();
    const salt = "ab".repeat(16);
    const a = new EncryptedStorage(backend, { passphrase: "p", salt, ...FAST });
    await a.setItem("k", "v");
    expect(backend.m.has("__tat_kdf_salt__")).toBe(false);
    const b = new EncryptedStorage(backend, { passphrase: "p", salt, ...FAST });
    expect(await b.getItem("k")).toBe("v");
  });
});

describe("the forge and pocket refuse to write secrets to unencrypted storage", () => {
  const OWNER = "ab".repeat(32);

  it("forge: will not generate and persist a key into a non-encrypting store", async () => {
    const forge = new FungibleForge({ owner: OWNER, storage: new MemStore(), relays: [] } as any) as any;
    await expect(forge.initialize()).rejects.toThrow(/encrypt/i);
  });

  it("forge: persists a generated key only in sealed form", async () => {
    const backend = new MemStore();
    const forge = new FungibleForge({
      owner: OWNER,
      storage: new EncryptedStorage(backend, { passphrase: "p", createSalt: true, ...FAST }),
      relays: [],
    } as any) as any;
    await forge.initialize();
    const stored = [...backend.m.entries()].find(([k]) => k.startsWith("forge-keys-"));
    expect(stored?.[1]).toMatch(/^enc:v2:/);
  });

  it("forge: does not copy configured keys into storage at all", async () => {
    const backend = new MemStore();
    const forge = new FungibleForge({
      owner: OWNER,
      keys: { secretKey: "5e".repeat(32), publicKey: OWNER },
      storage: backend,
      relays: [],
    } as any) as any;
    await forge.initialize();
    expect([...backend.m.keys()].some((k) => k.startsWith("forge-keys-"))).toBe(false);
  });

  it("pocket: refuses a non-encrypting store passed in config", async () => {
    const backend = new MemStore();
    await expect(
      Pocket.create({ storage: backend as any, relays: [] } as any),
    ).rejects.toThrow(/encrypt/i);
    expect(backend.m.size).toBe(0);
  });
});
