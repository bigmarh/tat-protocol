import { StorageInterface } from './StorageInterface.js';
import { SecretBox, SecretBoxOptions, UnencryptedDataError, randomSalt } from './SecretBox.js';

const SALT_KEY = '__tat_kdf_salt__';

export interface EncryptedStorageOptions extends SecretBoxOptions {
  /**
   * KDF salt (hex, or bytes). Give every replica of one deployment the same
   * value to take the salt out of the backend altogether — StorageInterface
   * has no compare-and-set, so replicas creating one there can race.
   */
  salt?: string | Uint8Array;
}

const toHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => new Uint8Array(h.match(/../g)!.map(x => parseInt(x, 16)));

/**
 * Encrypts every value before it reaches any {@link StorageInterface} backend
 * (Redis, S3, a database, an in-memory map), so secrets written through it are
 * ciphertext at rest wherever the backend puts them.
 *
 * Reads fail closed: a plaintext value in the backend is an error, not a value
 * to return, since a store that accepts plaintext accepts whatever an attacker
 * with write access to the backend chose to put there.
 *
 * The KDF salt lives in the backend under a reserved key; losing it makes every
 * value unreadable, so back it up with the data.
 */
export class EncryptedStorage implements StorageInterface {
  readonly encryptsAtRest = true;
  private box?: Promise<SecretBox>;

  constructor(
    private readonly backend: StorageInterface,
    private readonly options: EncryptedStorageOptions
  ) {
    if (!options.passphrase && !options.key) {
      throw new Error('EncryptedStorage: an encryption key (passphrase or key) is required');
    }
  }

  private secretBox(): Promise<SecretBox> {
    this.box ??= (async () => {
      if (this.options.salt !== undefined) {
        const salt =
          typeof this.options.salt === 'string' ? fromHex(this.options.salt) : this.options.salt;
        return SecretBox.create(this.options, salt);
      }
      let saltHex = await this.backend.getItem(SALT_KEY);
      if (!saltHex) {
        await this.backend.setItem(SALT_KEY, toHex(randomSalt()));
        // Re-read rather than trusting our own write: if another replica wrote
        // one concurrently, the stored value is the one everyone will use.
        saltHex = await this.backend.getItem(SALT_KEY);
        if (!saltHex) throw new Error('EncryptedStorage: could not persist the KDF salt');
      }
      return SecretBox.create(this.options, fromHex(saltHex));
    })();
    return this.box;
  }

  async getItem(key: string): Promise<string | null> {
    const raw = await this.backend.getItem(key);
    if (raw === null) return null;
    if (!SecretBox.isSealed(raw)) throw new UnencryptedDataError(key);
    return (await this.secretBox()).open(raw, key);
  }

  async setItem(key: string, value: string): Promise<void> {
    await this.backend.setItem(key, await (await this.secretBox()).seal(value, key));
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
