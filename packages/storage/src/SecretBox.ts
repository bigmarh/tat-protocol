/**
 * Authenticated encryption for values at rest: AES-256-GCM under a key derived
 * from a passphrase with PBKDF2-SHA256, or supplied directly.
 *
 * Built on WebCrypto (`globalThis.crypto.subtle`), which Node (>= 19) and every
 * browser provide, so NodeStore, BrowserStore and EncryptedStorage share one
 * format and one implementation rather than one per platform.
 *
 * Sealed format: `enc:v2:<base64 iv>:<base64 ciphertext+tag>`. The salt is per
 * store, not per value — deriving a key per read would put a deliberately slow
 * KDF on every access — so each store keeps its salt alongside its data.
 */
export const SEALED_PREFIX = 'enc:v2:';

/** OWASP's 2023 recommendation for PBKDF2-HMAC-SHA256. */
export const DEFAULT_KDF_ITERATIONS = 600_000;

export interface SecretBoxOptions {
  /** Passphrase the key is derived from. */
  passphrase?: string;
  /** A raw 32-byte key, used as-is (no KDF). */
  key?: Uint8Array;
  /** PBKDF2 iterations for a passphrase. Lower only in tests. */
  kdfIterations?: number;
}

/** A value was found unencrypted in a store that encrypts at rest. */
export class UnencryptedDataError extends Error {
  constructor(key: string) {
    super(
      `"${key}" is stored unencrypted, and this store only reads encrypted values. ` +
        'Run migratePlaintext() once to encrypt existing data.'
    );
    this.name = 'UnencryptedDataError';
  }
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('SecretBox: WebCrypto (crypto.subtle) is not available');
  return s;
}

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function aad(context: string): BufferSource {
  return new TextEncoder().encode(`tat-storage-v2\n${context}`) as BufferSource;
}

export function randomSalt(): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(16));
}

export class SecretBox {
  private constructor(private readonly key: CryptoKey) {}

  static async create(opts: SecretBoxOptions, salt: Uint8Array): Promise<SecretBox> {
    if (opts.key) {
      if (opts.key.length !== 32) throw new Error('SecretBox: key must be 32 bytes');
      const key = await subtle().importKey('raw', opts.key as BufferSource, 'AES-GCM', false, [
        'encrypt',
        'decrypt',
      ]);
      return new SecretBox(key);
    }
    if (!opts.passphrase) throw new Error('SecretBox: a passphrase or key is required');
    const base = await subtle().importKey(
      'raw',
      new TextEncoder().encode(opts.passphrase) as BufferSource,
      'PBKDF2',
      false,
      ['deriveKey']
    );
    const key = await subtle().deriveKey(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: salt as BufferSource,
        iterations: opts.kdfIterations ?? DEFAULT_KDF_ITERATIONS,
      },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    return new SecretBox(key);
  }

  static isSealed(value: string): boolean {
    return value.startsWith(SEALED_PREFIX);
  }

  /**
   * @param context where the value lives (its storage key). It is bound in as
   *   AES-GCM associated data, so a ciphertext copied to another key does not
   *   open there. Rolling a key back to its own older value is NOT detected.
   */
  async seal(plaintext: string, context: string): Promise<string> {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(
      await subtle().encrypt(
        { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad(context) },
        this.key,
        new TextEncoder().encode(plaintext) as BufferSource
      )
    );
    return `${SEALED_PREFIX}${toB64(iv)}:${toB64(ct)}`;
  }

  /** Throws if the value is not sealed, was sealed under another key, or was altered. */
  async open(sealed: string, context: string): Promise<string> {
    if (!SecretBox.isSealed(sealed)) throw new Error('SecretBox: value is not sealed');
    const [ivB64, ctB64] = sealed.slice(SEALED_PREFIX.length).split(':');
    if (!ivB64 || !ctB64) throw new Error('SecretBox: malformed sealed value');
    try {
      const pt = await subtle().decrypt(
        {
          name: 'AES-GCM',
          iv: fromB64(ivB64) as BufferSource,
          additionalData: aad(context),
        },
        this.key,
        fromB64(ctB64) as BufferSource
      );
      return new TextDecoder().decode(pt);
    } catch {
      throw new Error('SecretBox: cannot decrypt — wrong key, or the value was altered or moved');
    }
  }
}
