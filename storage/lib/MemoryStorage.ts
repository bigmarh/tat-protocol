import { StorageInterface } from "./StorageInterface";

export class MemoryStorage implements StorageInterface {
  private storage: Map<string, string>;

  constructor() {
    this.storage = new Map<string, string>();
  }

  async getItem(key: string): Promise<string | null> {
    return this.storage.has(key) ? this.storage.get(key)! : null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.storage.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.storage.delete(key);
  }

  async clear(): Promise<void> {
    this.storage.clear();
  }
}