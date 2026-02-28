import { StorageInterface } from './StorageInterface.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { DebugLogger } from '@tat-protocol/utils';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const Debug = DebugLogger.getInstance();

/**
 * Node.js-based storage implementation using filesystem
 */
export class NodeStore implements StorageInterface {
  private baseDir: string;
  private encryptionKey?: Buffer;

  constructor(baseDir: string = '.storage') {
    this.baseDir = baseDir;
    this.encryptionKey = this.deriveEncryptionKey();
    this.initializeStorage();
  }

  private deriveEncryptionKey(): Buffer | undefined {
    const keyMaterial = process.env.TAT_STORAGE_ENCRYPTION_KEY;
    if (!keyMaterial) return undefined;
    return createHash('sha256').update(keyMaterial, 'utf-8').digest();
  }

  private encrypt(value: string): string {
    if (!this.encryptionKey) return value;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  private decrypt(value: string): string {
    if (!this.encryptionKey) return value;
    if (!value.startsWith('enc:v1:')) return value;
    const parts = value.split(':');
    if (parts.length !== 5) return value;
    const iv = Buffer.from(parts[2], 'base64');
    const tag = Buffer.from(parts[3], 'base64');
    const data = Buffer.from(parts[4], 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf-8');
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
      return this.decrypt(data);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    const filePath = this.getFilePath(key);
    const payload = this.encrypt(value);
    await fs.writeFile(filePath, payload, { encoding: 'utf-8', mode: 0o600 });
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
  }
}
