// The package entry for Node. Compiled with the rest of src into dist/ and
// dist-cjs/, which the root node.js / node.cjs re-export — so the published entry can
// never again lag what this file exports (the hand-written ones did, for months).
export { Storage } from './Storage.js';
export { NodeStore } from './DiskStorage.js';
export type { NodeStoreOptions } from './DiskStorage.js';
export { NodeStore as Backend } from './DiskStorage.js';
export * from './StorageInterface.js';
export * from './SecretBox.js';
export { EncryptedStorage } from './EncryptedStorage.js';
export type { EncryptedStorageOptions } from './EncryptedStorage.js';
export * from './SpentSetStore.js';
export * from './ProcessedRequestStore.js';
export * from './SupplyStore.js';
export * from './ForgeLedger.js';
export { MemoryForgeLedger } from './MemoryForgeLedger.js';
export { SqliteForgeLedger } from './SqliteForgeLedger.js';
export { MemorySupplyStore } from './MemorySupplyStore.js';
export { SqliteSupplyStore } from './SqliteSupplyStore.js';
export { MemoryProcessedRequestStore } from './MemoryProcessedRequestStore.js';
export { SqliteProcessedRequestStore } from './SqliteProcessedRequestStore.js';
export type { MemoryProcessedRequestStoreOptions } from './MemoryProcessedRequestStore.js';
export { MemorySpentSetStore } from './MemorySpentSetStore.js';
export { SqliteSpentSetStore, tokenHashToBytes } from './SqliteSpentSetStore.js';
export type {
  SqliteDatabaseHandle,
  SqliteStatementHandle,
  SqliteSpentSetStoreOptions,
} from './SqliteSpentSetStore.js';

// Stub so packages that import BrowserStore don't crash when loaded in Node.js.
// Instantiating this in a Node environment will throw at runtime, which is correct.
export class BrowserStore {
  constructor(_options?: unknown) {
    throw new Error('BrowserStore is not available in Node.js. Use NodeStore instead.');
  }
}
