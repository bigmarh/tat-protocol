import { StorageInterface } from './StorageInterface';
import { BrowserStore } from './BrowserStorage';
import { NodeStore } from './NodeStorage';


export class Storage implements StorageInterface {
    private config: any;
    private isBrowser: boolean;
    private storage: StorageInterface;

    constructor(config?: any) {
        this.config = config;
        this.isBrowser = typeof globalThis !== 'undefined' && Object.prototype.hasOwnProperty.call(globalThis, 'window');
        this.storage = this.initializeStorage();
    }

    private initializeStorage(): StorageInterface {
        if (this.config?.storage) {
            return this.config.storage;
        }
        // Default to browser storage in browser environments
        if (this.isBrowser) {
            return new BrowserStore();
        }
        // Default to node storage in Node.js environments
        return new NodeStore();
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