import { StorageInterface } from './StorageInterface';
import { promises as fs } from 'fs';
import { join } from 'path';

/**
 * Node.js-based storage implementation using filesystem
 */
export class NodeStore implements StorageInterface {
  private baseDir: string;

  constructor(baseDir: string = '.storage') {
    this.baseDir = baseDir;
    this.initializeStorage();
  }

  private async initializeStorage(): Promise<void> {
    try {
      await fs.mkdir(this.baseDir, { recursive: true });
    } catch (error) {
      console.error('Failed to initialize storage directory:', error);
    }
  }

  private getFilePath(key: string): string {
    return join(this.baseDir, `${key}.json`);
  }

  async getItem(key: string): Promise<string | null> {
    try {
      const filePath = this.getFilePath(key);
      const data = await fs.readFile(filePath, 'utf-8');
      return data;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    const filePath = this.getFilePath(key);
    await fs.writeFile(filePath, value, 'utf-8');
  }

  async removeItem(key: string): Promise<void> {
    const filePath = this.getFilePath(key);
    try {
      await fs.unlink(filePath);
    } catch (error: any) {
      // Ignore error if file doesn't exist
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async clear(): Promise<void> {
    await fs.rm(this.baseDir, { recursive: true, force: true });
  }
}
