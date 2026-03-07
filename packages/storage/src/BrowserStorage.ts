/// <reference lib="dom" />

import { StorageInterface } from './StorageInterface.js';

declare global {
  interface Window {
    localStorage: Storage;
  }
}

const isBrowser = typeof window !== 'undefined' && 'localStorage' in window;

/**
 * Browser-based storage implementation using localStorage
 */
export class BrowserStore implements StorageInterface {
  private storage: Storage;

  constructor() {
    // Check if localStorage is available
    if (isBrowser) {
      this.storage = window.localStorage;
    } else {
      throw new Error('localStorage is not available');
    }
  }

  async getItem(key: string): Promise<string | null> {
    if (isBrowser) {
      return this.storage.getItem(key);
    }
    return null;
  }

  async setItem(key: string, value: string): Promise<void> {
    if (!isBrowser) return;
    try {
      this.storage.setItem(key, value);
    } catch (e) {
      const isQuota =
        e instanceof DOMException &&
        (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
      if (!isQuota) throw e;

      // Evict stale bloom-filter data (largest, least critical keys) and retry once.
      const bloomKeys: string[] = [];
      for (let i = 0; i < this.storage.length; i++) {
        const k = this.storage.key(i);
        if (k && (k.endsWith('-bloom') || k.includes('processedEventBloom'))) {
          bloomKeys.push(k);
        }
      }
      for (const k of bloomKeys) this.storage.removeItem(k);

      try {
        this.storage.setItem(key, value);
      } catch (retryErr) {
        console.error('[BrowserStore] localStorage full even after eviction:', retryErr);
        throw retryErr;
      }
    }
  }

  async removeItem(key: string): Promise<void> {
    if (isBrowser) {
      this.storage.removeItem(key);
    }
  }

  async clear(): Promise<void> {
    if (isBrowser) {
      this.storage.clear();
    }
  }
}
