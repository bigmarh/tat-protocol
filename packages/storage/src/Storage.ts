import { StorageInterface } from './StorageInterface';
import { BrowserStore } from './BrowserStorage';

/**
 * Cross-platform Storage class.
 * - In the browser, use the synchronous constructor: `new Storage()`
 * - In Node.js, use the async factory: `await Storage.create()`
 * This avoids bundling Node-only modules (like fs) in browser builds.
 */
export class Storage implements StorageInterface {
  private storage: StorageInterface;

  /**
   * Synchronous constructor: safe for browser only.
   * In Node.js, use the async factory method instead.
   */
  constructor(storage?: StorageInterface) {
    if (typeof window === 'undefined') {
      // Node.js: throw to force use of async factory
      throw new Error('In Node.js, use Storage.create() instead of the constructor.');
    }
    // Browser: use BrowserStore or provided storage
    this.storage = storage || new BrowserStore();
  }

  /**
   * Async factory for universal (Node/browser) usage.
   * - In browser: returns BrowserStore
   * - In Node.js: dynamically imports and returns NodeStore
   */
  static async create(storage?: StorageInterface): Promise<StorageInterface> {
    if (storage) return storage;
    if (typeof window !== 'undefined') {
      // Browser: use BrowserStore
      return new BrowserStore();
    } else {
      // Node.js: dynamically import NodeStore (DiskStorage)
      const { NodeStore } = await import('./DiskStorage');
      return new NodeStore();
    }
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
