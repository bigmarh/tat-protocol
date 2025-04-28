import { StorageInterface } from './StorageInterface';

declare global {
    interface Window {
        localStorage: Storage;
    }
}

const isBrowser = typeof globalThis !== 'undefined' && 
    globalThis.hasOwnProperty('window') && 
    typeof (globalThis as any).window.localStorage !== 'undefined';

/**
 * Browser-based storage implementation using localStorage
 */
export class BrowserStore implements StorageInterface {
    async getItem(key: string): Promise<string | null> {
        if (isBrowser) {
            return (globalThis as any).window.localStorage.getItem(key);
        }
        throw new Error('Browser storage is not available in this environment');
    }

    async setItem(key: string, value: string): Promise<void> {
        if (isBrowser) {
            (globalThis as any).window.localStorage.setItem(key, value);
        } else {
            throw new Error('Browser storage is not available in this environment');
        }
    }

    async removeItem(key: string): Promise<void> {
        if (isBrowser) {
            (globalThis as any).window.localStorage.removeItem(key);
        } else {
            throw new Error('Browser storage is not available in this environment');
        }
    }

    async clear(): Promise<void> {
        if (isBrowser) {
            (globalThis as any).window.localStorage.clear();
        } else {
            throw new Error('Browser storage is not available in this environment');
        }
    }
} 