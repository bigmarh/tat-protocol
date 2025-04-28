export interface StorageInterface {
    /**
     * Get an item from storage
     * @param key - The key to retrieve
     * @returns The value or null if not found
     */
    getItem(key: string): Promise<string | null>;
    /**
     * Set an item in storage
     * @param key - The key to set
     * @param value - The value to store
     */
    setItem(key: string, value: string): Promise<void>;
    /**
     * Remove an item from storage
     * @param key - The key to remove
     */
    removeItem(key: string): Promise<void>;
    /**
     * Clear all items from storage
     */
    clear(): Promise<void>;
} 