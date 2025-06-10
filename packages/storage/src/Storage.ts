import { StorageInterface } from './StorageInterface';

/**
 * Universal Storage class. Requires explicit backend injection.
 */
export class Storage implements StorageInterface {
  private storage: StorageInterface;

  constructor(storage: StorageInterface) {
    if (!storage) {
      throw new Error('A StorageInterface implementation must be provided.');
    }
    this.storage = storage;
  }

  async getItem(key: string): Promise<string | null> {
    return this.storage.getItem(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    return this.storage.setItem(key, value);
  }

  async removeItem(key: string): Promise<void> {
    return this.storage.removeItem(key);
  }

  async clear(): Promise<void> {
    return this.storage.clear();
  }
}
