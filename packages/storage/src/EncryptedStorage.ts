import { StorageInterface } from './StorageInterface.js';
import { SecretBox, SecretBoxOptions, UnencryptedDataError, randomSalt } from './SecretBox.js';

const SALT_KEY = '__tat_kdf_salt__';

export interface EncryptedStorageOptions extends SecretBoxOptions {
  /**
   * KDF salt: at least 16 bytes, as hex or bytes. Give every replica of one
   * deployment the same value (from config); no salt is kept in the backend.
   * Required unless `createSalt` is set.
   */
  salt?: string | Uint8Array;
  /**
   * Create a random salt and keep it in the backend. ONLY for a single writer:
   * StorageInterface has no compare-and-set, so two replicas creating one can
   * each write their own, and data sealed under the losing salt never opens
   * again. As a backstop, a store refuses to seal once the stored salt is no
   * longer the one it derived its key from — best effort only: a salt another
   * replica writes while a value is being sealed is not seen, and nothing
   * short of compare-and-set can close that. Use `salt` for multiple writers.
   */
  createSalt?: boolean;
}

const MIN_SALT_BYTES = 16;
const toHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

function parseSalt(salt: string | Uint8Array, source: string): Uint8Array {
  const bytes =
    typeof salt === 'string'
      ? /^(?:[0-9a-fA-F]{2})+$/.test(salt)
        ? new Uint8Array(salt.match(/../g)!.map(x => parseInt(x, 16)))
        : undefined
      : salt;
  if (!bytes || bytes.length < MIN_SALT_BYTES) {
    throw new Error(
      `EncryptedStorage: ${source} salt must be at least ${MIN_SALT_BYTES} bytes of hex`
    );
  }
  return bytes;
}

/**
 * Encrypts every value before it reaches any {@link StorageInterface} backend
 * (Redis, S3, a database, an in-memory map), so secrets written through it are
 * ciphertext at rest wherever the backend puts them.
 *
 * Reads fail closed: a plaintext value in the backend is an error, not a value
 * to return, since a store that accepts plaintext accepts whatever an attacker
 * with write access to the backend chose to put there.
 *
 * With `createSalt`, the KDF salt lives in the backend under a reserved key;
 * losing it makes every value unreadable, so back it up with the data.
 */
export class EncryptedStorage implements StorageInterface {
  readonly encryptsAtRest = true;
  private box?: Promise<{ box: SecretBox; storedSalt?: string }>;

  constructor(
    private readonly backend: StorageInterface,
    private readonly options: EncryptedStorageOptions
  ) {
    if (!options.passphrase && !options.key) {
      throw new Error('EncryptedStorage: an encryption key (passphrase or key) is required');
    }
    if (options.salt !== undefined) {
      parseSalt(options.salt, 'the configured');
    } else if (!options.key && !options.createSalt) {
      throw new Error(
        'EncryptedStorage: pass the deployment `salt` (shared by every replica), ' +
          'or `createSalt: true` if this is the only writer'
      );
    }
  }

  private secretBox(): Promise<{ box: SecretBox; storedSalt?: string }> {
    this.box ??= (async () => {
      if (this.options.salt !== undefined) {
        return {
          box: await SecretBox.create(this.options, parseSalt(this.options.salt, 'the configured')),
        };
      }
      if (this.options.key) {
        return { box: await SecretBox.create(this.options, new Uint8Array(0)) };
      }
      let saltHex = await this.backend.getItem(SALT_KEY);
      if (!saltHex) {
        saltHex = toHex(randomSalt());
        await this.backend.setItem(SALT_KEY, saltHex);
      }
      return {
        box: await SecretBox.create(this.options, parseSalt(saltHex, 'the stored')),
        storedSalt: saltHex,
      };
    })();
    return this.box;
  }

  async getItem(key: string): Promise<string | null> {
    const raw = await this.backend.getItem(key);
    if (raw === null) return null;
    if (!SecretBox.isSealed(raw)) throw new UnencryptedDataError(key);
    return (await this.secretBox()).box.open(raw, key);
  }

  async setItem(key: string, value: string): Promise<void> {
    const { box, storedSalt } = await this.secretBox();
    if (storedSalt !== undefined && (await this.backend.getItem(SALT_KEY)) !== storedSalt) {
      // Another writer replaced the salt: anything sealed under ours would
      // never open once the key is derived again. Refuse rather than write it.
      throw new Error(
        'EncryptedStorage: the stored salt changed under this store — another writer is using ' +
          'createSalt. Configure one shared `salt` for every replica.'
      );
    }
    await this.backend.setItem(key, await box.seal(value, key));
  }

  async removeItem(key: string): Promise<void> {
    await this.backend.removeItem(key);
  }

  async clear(): Promise<void> {
    await this.backend.clear();
    this.box = undefined;
  }

  /**
   * Encrypt values already sitting in the backend in plaintext. The interface
   * cannot enumerate keys, so the caller names them.
   * @returns how many were rewritten.
   */
  async migratePlaintext(keys: string[]): Promise<number> {
    let migrated = 0;
    for (const key of keys) {
      const raw = await this.backend.getItem(key);
      if (raw === null || SecretBox.isSealed(raw)) continue;
      await this.setItem(key, raw);
      migrated++;
    }
    return migrated;
  }
}
