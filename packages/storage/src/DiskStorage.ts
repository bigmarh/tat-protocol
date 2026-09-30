import { StorageInterface } from './StorageInterface.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { DebugLogger } from '@tat-protocol/utils';
import { createDecipheriv, createHash, randomBytes } from 'crypto';
import { SecretBox, UnencryptedDataError, randomSalt } from './SecretBox.js';

const Debug = DebugLogger.getInstance();

const SALT_FILE = '.tat-kdf-salt';

export interface NodeStoreOptions {
  /**
   * Passphrase the encryption key is derived from. Defaults to the
   * `TAT_STORAGE_ENCRYPTION_KEY` environment variable.
   */
  passphrase?: string;
  /** A raw 32-byte key, used as-is instead of a passphrase. */
  key?: Uint8Array;
  /**
   * Store values unencrypted. Required to construct a NodeStore with no key;
   * never needed otherwise. Anything written — forge keys, pocket mnemonics —
   * is then readable by whoever can read the directory.
   */
  allowPlaintext?: boolean;
  /** PBKDF2 iterations (default 600 000). Lower only in tests. */
  kdfIterations?: number;
}

/**
 * Node.js-based storage implementation using filesystem.
 *
 * Encrypts every value at rest by default (AES-256-GCM, key derived with
 * PBKDF2 from a passphrase and a per-directory salt kept in `.tat-kdf-salt`),
 * and refuses to read a plaintext value once a key is configured — a store that
 * returned plaintext it found would return whatever was put in its place.
 * Values written by the older `enc:v1` scheme (unsalted sha256 of the same
 * passphrase) are still read, and are rewritten as v2 by `migratePlaintext()`
 * or the next write.
 */
export class NodeStore implements StorageInterface {
  private baseDir: string;
  private options: NodeStoreOptions;
  private passphrase?: string;
  private legacyKey?: Buffer;
  private box?: Promise<SecretBox>;

  constructor(baseDir: string = '.storage', options: NodeStoreOptions = {}) {
    this.baseDir = baseDir;
    this.options = options;
    this.passphrase = options.passphrase ?? process.env.TAT_STORAGE_ENCRYPTION_KEY ?? undefined;
    if (!options.key && !this.passphrase && !options.allowPlaintext) {
      throw new Error(
        'NodeStore: no encryption key. Pass { passphrase } or { key }, or set TAT_STORAGE_ENCRYPTION_KEY. ' +
          'To store values unencrypted, pass { allowPlaintext: true }.'
      );
    }
    if (this.passphrase) {
      this.legacyKey = createHash('sha256').update(this.passphrase, 'utf-8').digest();
    }
    this.initializeStorage();
  }

  /** Whether values are encrypted before they reach the disk. */
  get encryptsAtRest(): boolean {
    return !!(this.options.key || this.passphrase);
  }

  private secretBox(): Promise<SecretBox> | undefined {
    if (!this.encryptsAtRest) return undefined;
    this.box ??= (async () => {
      await fs.mkdir(this.baseDir, { recursive: true, mode: 0o700 });
      return SecretBox.create(
        {
          key: this.options.key,
          passphrase: this.passphrase,
          kdfIterations: this.options.kdfIterations,
        },
        this.options.key ? new Uint8Array(0) : await this.loadOrCreateSalt()
      );
    })();
    return this.box;
  }

  private async loadOrCreateSalt(): Promise<Uint8Array> {
    const path = join(this.baseDir, SALT_FILE);
    try {
      return new Uint8Array(Buffer.from((await fs.readFile(path, 'utf-8')).trim(), 'hex'));
    } catch (error: unknown) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
        throw error;
      }
    }
    const salt = randomSalt();
    try {
      // 'wx': exclusive create, so two processes starting together cannot each
      // write a different salt and lock the other out of its own data.
      await fs.writeFile(path, Buffer.from(salt).toString('hex'), { flag: 'wx', mode: 0o600 });
      return salt;
    } catch {
      return new Uint8Array(Buffer.from((await fs.readFile(path, 'utf-8')).trim(), 'hex'));
    }
  }

  /** The pre-v2 scheme: AES-256-GCM under sha256(passphrase), no salt. Read-only. */
  private decryptV1(value: string): string {
    const parts = value.split(':');
    if (parts.length !== 5 || !this.legacyKey) {
      throw new Error('NodeStore: cannot read an enc:v1 value without its passphrase');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.legacyKey,
      Buffer.from(parts[2], 'base64')
    );
    decipher.setAuthTag(Buffer.from(parts[3], 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[4], 'base64')),
      decipher.final(),
    ]).toString('utf-8');
  }

  private async decode(key: string, raw: string): Promise<string> {
    const box = this.secretBox();
    if (!box) {
      if (SecretBox.isSealed(raw) || raw.startsWith('enc:v1:')) {
        throw new Error(`NodeStore: "${key}" is encrypted but no key is configured`);
      }
      return raw;
    }
    if (SecretBox.isSealed(raw)) return (await box).open(raw);
    if (raw.startsWith('enc:v1:')) return this.decryptV1(raw);
    throw new UnencryptedDataError(key);
  }

  private async encode(value: string): Promise<string> {
    const box = this.secretBox();
    return box ? (await box).seal(value) : value;
  }

  /**
   * Encrypt every value in this store that is not already v2 — plaintext left
   * by an unencrypted store, or enc:v1 values — in place.
   * @returns how many values were rewritten.
   */
  async migratePlaintext(): Promise<number> {
    const box = this.secretBox();
    if (!box) throw new Error('NodeStore: migratePlaintext() needs an encryption key');
    let migrated = 0;
    for (const name of await fs.readdir(this.baseDir)) {
      if (!name.endsWith('.json')) continue;
      const path = join(this.baseDir, name);
      const raw = await fs.readFile(path, 'utf-8');
      if (SecretBox.isSealed(raw)) continue;
      const value = raw.startsWith('enc:v1:') ? this.decryptV1(raw) : raw;
      await this.writeAtomic(path, await (await box).seal(value));
      migrated++;
    }
    return migrated;
  }

  private async initializeStorage(): Promise<void> {
    try {
      await fs.mkdir(this.baseDir, { recursive: true, mode: 0o700 });
    } catch (error) {
      Debug.error('Failed to initialize storage directory:' + error, 'NodeStore');
    }
  }

  private isSafeKey(key: string): boolean {
    return /^[A-Za-z0-9._-]+$/.test(key) && !key.includes('..');
  }

  private encodeKey(key: string): string {
    return Buffer.from(key, 'utf-8').toString('base64url');
  }

  private getFilePath(key: string): string {
    const safeKey = this.isSafeKey(key) ? key : this.encodeKey(key);
    return join(this.baseDir, `${safeKey}.json`);
  }

  async getItem(key: string): Promise<string | null> {
    try {
      const filePath = this.getFilePath(key);
      const data = await fs.readFile(filePath, 'utf-8');
      return await this.decode(key, data);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Write-to-temp, fsync, rename. `fs.writeFile` on the target truncates it and
   * then writes, so a crash or a failed write in between left the key holding a
   * torn value — for a forge, its whole state blob. rename(2) replaces the
   * target atomically, so a reader sees the old value or the new one, never
   * part of either; the directory fsync makes the rename itself survive power
   * loss.
   */
  async setItem(key: string, value: string): Promise<void> {
    await this.writeAtomic(this.getFilePath(key), await this.encode(value));
  }

  private async writeAtomic(filePath: string, payload: string): Promise<void> {
    const tmpPath = `${filePath}.tmp-${randomBytes(6).toString('hex')}`;
    try {
      await fs.writeFile(tmpPath, payload, { encoding: 'utf-8', mode: 0o600 });
      const handle = await fs.open(tmpPath, 'r');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(tmpPath, filePath);
    } catch (error) {
      await fs.unlink(tmpPath).catch(() => undefined);
      throw error;
    }
    await this.syncDir();
  }

  private async syncDir(): Promise<void> {
    let dir: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      dir = await fs.open(this.baseDir, 'r');
      await dir.sync();
    } catch {
      // Not every platform can fsync a directory (Windows cannot open one);
      // the rename is still atomic there, only its durability is weaker.
    } finally {
      await dir?.close();
    }
  }

  async removeItem(key: string): Promise<void> {
    const filePath = this.getFilePath(key);
    try {
      await fs.unlink(filePath);
    } catch (error: unknown) {
      // Ignore error if file doesn't exist
      if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async clear(): Promise<void> {
    await fs.rm(this.baseDir, { recursive: true, force: true });
    // The salt went with the directory; the next write derives a fresh key.
    this.box = undefined;
  }
}
