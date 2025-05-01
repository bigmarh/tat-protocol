/// <reference lib="dom" />

import { StorageInterface } from './StorageInterface';

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
    if (isBrowser) {
      this.storage.setItem(key, value);
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
