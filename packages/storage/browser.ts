export { Storage } from './src/Storage.js';
export { BrowserStore } from './src/BrowserStorage.js';
export * from './src/StorageInterface.js';
export * from './src/SpentSetStore.js';
export { MemorySpentSetStore } from './src/MemorySpentSetStore.js';
// SqliteSpentSetStore is exported here too: it imports no Node built-in, taking
// an injected driver handle instead, so it is inert in a browser bundle unless
// something actually constructs it. Pockets do not use the spent set at all —
// it is forge-side — so this costs browser targets nothing.
export { SqliteSpentSetStore } from './src/SqliteSpentSetStore.js';
