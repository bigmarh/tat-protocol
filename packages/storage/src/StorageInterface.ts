/**
 * Storage interface for persisting TAT Protocol data.
 *
 * This interface abstracts storage operations to support multiple backends
 * (localStorage, IndexedDB, file system, etc.). Implementations must provide
 * async key-value storage with string serialization.
 *
 * The TAT Protocol uses this interface to persist:
 * - Wallet state (keys, tokens, balances)
 * - Forge state (spent tokens, authorized forgers)
 * - NWPC state (processed events, subscriptions)
 *
 * @example
 * ```typescript
 * // Browser implementation
 * class BrowserStorage implements StorageInterface {
 *   async getItem(key: string) {
 *     return localStorage.getItem(key);
 *   }
 *   async setItem(key: string, value: string) {
 *     localStorage.setItem(key, value);
 *   }
 *   // ... other methods
 * }
 * ```
 */
export interface StorageInterface {
  /**
   * Retrieves an item from storage.
   *
   * @param key - The storage key to retrieve
   * @returns The stored value as a string, or null if not found
   *
   * @example
   * ```typescript
   * const value = await storage.getItem('wallet-state');
   * if (value) {
   *   const state = JSON.parse(value);
   * }
   * ```
   */
  getItem(key: string): Promise<string | null>;

  /**
   * Stores an item in persistent storage.
   *
   * @param key - The storage key to use
   * @param value - The value to store (must be a string)
   *
   * @example
   * ```typescript
   * await storage.setItem('wallet-state', JSON.stringify(state));
   * ```
   */
  setItem(key: string, value: string): Promise<void>;

  /**
   * Removes an item from storage.
   *
   * @param key - The storage key to remove
   *
   * @example
   * ```typescript
   * await storage.removeItem('old-wallet-state');
   * ```
   */
  removeItem(key: string): Promise<void>;

  /**
   * Clears all items from storage.
   *
   * WARNING: This will delete all stored data for this storage instance.
   * Use with caution.
   *
   * @example
   * ```typescript
   * await storage.clear();
   * ```
   */
  clear(): Promise<void>;
}
