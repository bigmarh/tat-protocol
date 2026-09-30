/// <reference lib="dom" />

import { StorageInterface } from './StorageInterface.js';
import { SecretBox, SecretBoxOptions, UnencryptedDataError, randomSalt } from './SecretBox.js';

const SALT_KEY = '__tat_kdf_salt__';

export interface BrowserStoreOptions extends SecretBoxOptions {
  /**
   * Store values unencrypted in localStorage. Required to construct a
   * BrowserStore with no key; anything written — a pocket's mnemonic and keys —
   * is then readable by any script on the origin and by anyone with the disk.
   */
  allowPlaintext?: boolean;
}

declare global {
  interface Window {
    localStorage: Storage;
  }
}

// Checked per call rather than at module load, so a bundle evaluated before
// `window` exists (SSR, workers) does not freeze the answer.
const isBrowser = (): boolean => typeof window !== 'undefined' && 'localStorage' in window;

/**
 * Browser-based storage implementation using localStorage
 */
/**
 * localStorage-backed storage. Encrypts every value by default (see
 * {@link SecretBox}) and refuses to read plaintext once a key is configured.
 */
export class BrowserStore implements StorageInterface {
  private storage: Storage;
  private options: BrowserStoreOptions;
  private box?: Promise<SecretBox>;

  constructor(options: BrowserStoreOptions = {}) {
    // Check if localStorage is available
    if (isBrowser()) {
      this.storage = window.localStorage;
    } else {
      throw new Error('localStorage is not available');
    }
    if (!options.passphrase && !options.key && !options.allowPlaintext) {
      throw new Error(
        'BrowserStore: no encryption key. Pass { passphrase } or { key }; ' +
          'to store values unencrypted, pass { allowPlaintext: true }.'
      );
    }
    this.options = options;
  }

  /** Whether values are encrypted before they reach localStorage. */
  get encryptsAtRest(): boolean {
    return !!(this.options.passphrase || this.options.key);
  }

  private secretBox(): Promise<SecretBox> | undefined {
    if (!this.encryptsAtRest) return undefined;
    this.box ??= (async () => {
      let saltHex = this.storage.getItem(SALT_KEY);
      if (!saltHex) {
        saltHex = Array.from(randomSalt(), b => b.toString(16).padStart(2, '0')).join('');
        this.storage.setItem(SALT_KEY, saltHex);
      }
      const salt = new Uint8Array(saltHex.match(/../g)!.map(h => parseInt(h, 16)));
      return SecretBox.create(this.options, salt);
    })();
    return this.box;
  }

  async getItem(key: string): Promise<string | null> {
    if (!isBrowser()) return null;
    const raw = this.storage.getItem(key);
    if (raw === null) return null;
    const box = this.secretBox();
    if (!box) return raw;
    if (!SecretBox.isSealed(raw)) throw new UnencryptedDataError(key);
    return (await box).open(raw, key);
  }

  /**
   * Encrypt the named plaintext values in place. The keys are explicit because
   * localStorage is shared by everything on the origin: sealing keys that
   * belong to other code would break it. @returns how many were rewritten.
   */
  async migratePlaintext(keys: string[]): Promise<number> {
    const box = this.secretBox();
    if (!box) throw new Error('BrowserStore: migratePlaintext() needs an encryption key');
    let migrated = 0;
    for (const k of keys) {
      if (k === SALT_KEY) continue;
      const raw = this.storage.getItem(k);
      if (raw === null || SecretBox.isSealed(raw)) continue;
      this.storage.setItem(k, await (await box).seal(raw, k));
      migrated++;
    }
    return migrated;
  }

  async setItem(key: string, plaintext: string): Promise<void> {
    if (!isBrowser()) return;
    const box = this.secretBox();
    const value = box ? await (await box).seal(plaintext, key) : plaintext;
    try {
      this.storage.setItem(key, value);
    } catch (e) {
      const isQuota =
        e instanceof DOMException &&
        (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
      if (!isQuota) throw e;

      // Evict stale bloom-filter data (largest, least critical keys) and retry once.
      const bloomKeys: string[] = [];
      for (let i = 0; i < this.storage.length; i++) {
        const k = this.storage.key(i);
        if (k && (k.endsWith('-bloom') || k.includes('processedEventBloom'))) {
          bloomKeys.push(k);
        }
      }
      for (const k of bloomKeys) this.storage.removeItem(k);

      try {
        this.storage.setItem(key, value);
      } catch (retryErr) {
        console.error('[BrowserStore] localStorage full even after eviction:', retryErr);
        throw retryErr;
      }
    }
  }

  async removeItem(key: string): Promise<void> {
    if (isBrowser()) {
      this.storage.removeItem(key);
    }
  }

  async clear(): Promise<void> {
    if (isBrowser()) {
      this.storage.clear();
      this.box = undefined;
    }
  }
}
