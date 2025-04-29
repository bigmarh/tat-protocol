import { StorageInterface } from './StorageInterface';

export class SQLiteStorage implements StorageInterface {
  private db: any; // Database connection
  private tableName: string;

  constructor(db: any, tableName: string = 'key_value_store') {
    this.db = db;
    this.tableName = tableName;
    this.initTable();
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
      return row ? row.value : null;
    } catch (error) {
      console.error('Error getting item from SQLite:', error);
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO ${this.tableName} (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = ?
      `);
      stmt.run(key, value, value);
    } catch (error) {
      console.error('Error setting item in SQLite:', error);
      throw error;
    }
  }

  async removeItem(key: string): Promise<void> {
    try {
      const stmt = this.db.prepare(`DELETE FROM ${this.tableName} WHERE key = ?`);
      stmt.run(key);
    } catch (error) {
      console.error('Error removing item from SQLite:', error);
      throw error;
    }
  }

  async clear(): Promise<void> {
    try {
      this.db.exec(`DELETE FROM ${this.tableName}`);
    } catch (error) {
      console.error('Error clearing SQLite table:', error);
      throw error;
    }
  }
}
