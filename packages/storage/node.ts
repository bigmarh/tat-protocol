export { Storage } from './src/Storage.js';
export { NodeStore } from './src/DiskStorage.js';
export { NodeStore as Backend } from './src/DiskStorage.js';
export * from './src/StorageInterface.js';
export * from './src/SpentSetStore.js';
export * from './src/ProcessedRequestStore.js';
export * from './src/SupplyStore.js';
export { MemorySupplyStore } from './src/MemorySupplyStore.js';
export { SqliteSupplyStore } from './src/SqliteSupplyStore.js';
export { MemoryProcessedRequestStore } from './src/MemoryProcessedRequestStore.js';
export { SqliteProcessedRequestStore } from './src/SqliteProcessedRequestStore.js';
export type { MemoryProcessedRequestStoreOptions } from './src/MemoryProcessedRequestStore.js';
export { MemorySpentSetStore } from './src/MemorySpentSetStore.js';
export { SqliteSpentSetStore } from './src/SqliteSpentSetStore.js';
export type {
  SqliteDatabaseHandle,
  SqliteStatementHandle,
  SqliteSpentSetStoreOptions,
} from './src/SqliteSpentSetStore.js';

// Stub so packages that import BrowserStore don't crash when loaded in Node.js.
// Instantiating this in a Node environment will throw at runtime, which is correct.
export class BrowserStore {
  constructor() {
    throw new Error('BrowserStore is not available in Node.js. Use NodeStore instead.');
  }
}
