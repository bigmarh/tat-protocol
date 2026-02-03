import { StorageInterface } from './StorageInterface';
import { DebugLogger } from '@tat-protocol/utils';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const Debug = DebugLogger.getInstance();

/**
 * SQLite database interface
 */
interface SQLiteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SQLiteStatement;
  close?(): void;
}

/**
 * SQLite prepared statement interface
 */
interface SQLiteStatement {
  get(params: unknown): { value: string } | undefined;
  run(...params: unknown[]): void;
}

export class SQLiteStorage implements StorageInterface {
  private db: SQLiteDatabase;
  private tableName: string;
  private encryptionKey?: Buffer;

  constructor(db: SQLiteDatabase, tableName: string = 'key_value_store') {
    this.db = db;
    this.encryptionKey = this.deriveEncryptionKey();
    this.tableName = this.sanitizeTableName(tableName);
    this.initTable();
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

  private sanitizeTableName(tableName: string): string {
    if (!/^[A-Za-z0-9_]+$/.test(tableName)) {
      throw new Error('Invalid table name');
    }
    return tableName;
  }

  private initTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
  }

  async getItem(key: string): Promise<string | null> {
    try {
      const stmt = this.db.prepare(`SELECT value FROM ${this.tableName} WHERE key = ?`);
      const row = stmt.get(key);
      return row ? this.decrypt(row.value) : null;
    } catch (error) {
      Debug.error('Error getting item from SQLite:' + error, 'SQLiteStorage');
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    try {
      const payload = this.encrypt(value);
      const stmt = this.db.prepare(`
        INSERT INTO ${this.tableName} (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = ?
      `);
      stmt.run(key, payload, payload);
    } catch (error) {
      Debug.error('Error setting item in SQLite:' + error, 'SQLiteStorage');
      throw error;
    }
  }

  async removeItem(key: string): Promise<void> {
    try {
      const stmt = this.db.prepare(`DELETE FROM ${this.tableName} WHERE key = ?`);
      stmt.run(key);
    } catch (error) {
      Debug.error('Error removing item from SQLite:' + error, 'SQLiteStorage');
      throw error;
    }
  }

  async clear(): Promise<void> {
    try {
      this.db.exec(`DELETE FROM ${this.tableName}`);
    } catch (error) {
      Debug.error('Error clearing SQLite table:' + error, 'SQLiteStorage');
      throw error;
    }
  }
}
