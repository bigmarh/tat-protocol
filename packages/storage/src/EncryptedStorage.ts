import { StorageInterface } from './StorageInterface.js';
import { SecretBox, SecretBoxOptions, UnencryptedDataError, randomSalt } from './SecretBox.js';

const SALT_KEY = '__tat_kdf_salt__';

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
    private readonly options: SecretBoxOptions
  ) {
    if (!options.passphrase && !options.key) {
      throw new Error('EncryptedStorage: an encryption key (passphrase or key) is required');
    }
  }

  private secretBox(): Promise<SecretBox> {
    this.box ??= (async () => {
      let saltHex = await this.backend.getItem(SALT_KEY);
      if (!saltHex) {
        saltHex = Array.from(randomSalt(), b => b.toString(16).padStart(2, '0')).join('');
        await this.backend.setItem(SALT_KEY, saltHex);
      }
      const salt = new Uint8Array(saltHex.match(/../g)!.map(h => parseInt(h, 16)));
      return SecretBox.create(this.options, salt);
    })();
    return this.box;
  }

  async getItem(key: string): Promise<string | null> {
    const raw = await this.backend.getItem(key);
    if (raw === null) return null;
    if (!SecretBox.isSealed(raw)) throw new UnencryptedDataError(key);
    return (await this.secretBox()).open(raw);
  }

  async setItem(key: string, value: string): Promise<void> {
    await this.backend.setItem(key, await (await this.secretBox()).seal(value));
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
