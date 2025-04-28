import { StorageInterface } from './StorageInterface';
import LocalDrive from 'localdrive';

/**
 * Pear-based storage implementation using LocalDrive for P2P storage
 */
export class PearStore implements StorageInterface {
    private drive: LocalDrive;

    constructor(storagePath: string = '.storage') {
        this.drive = new LocalDrive(storagePath);
    }

    async getItem(key: string): Promise<string | null> {
        try {
            const buffer = await this.drive.get(`/${key}`);
            return buffer ? buffer.toString('utf-8') : null;
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                return null;
            }
            throw error;
        }
    }

    async setItem(key: string, value: string): Promise<void> {
        try {
            await this.drive.put(`/${key}`, Buffer.from(value, 'utf-8'));
        } catch (error: any) {
            throw new Error(`Failed to write to Pear storage: ${error}`);
        }
    }

    /**
     * Get the underlying LocalDrive instance
     */
    getDrive(): LocalDrive {
        return this.drive;
    }

    /**
     * List all stored items
     */
    async listItems(): Promise<string[]> {
        const items: string[] = [];
        for await (const entry of this.drive.list('/')) {
            if (entry.key) {
                items.push(entry.key.slice(1)); // Remove leading slash
            }
        }
        return items;
    }

    async removeItem(key: string): Promise<void> {
        try {
            await this.drive.del(`/${key}`);
        } catch (error: any) {
            // Ignore error if file doesn't exist
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    }

    async clear(): Promise<void> {
        await this.drive.clear();
    }

    /**
     * Get file entry metadata
     */
    async getEntry(key: string): Promise<any> {
        try {
            const entry = await this.drive.entry(`/${key}`);
            return entry;
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                return null;
            }
            throw error;
        }
    }
} 