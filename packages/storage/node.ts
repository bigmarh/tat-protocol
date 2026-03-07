export { Storage } from './src/Storage.js';
export { NodeStore } from './src/DiskStorage.js';
export { NodeStore as Backend } from './src/DiskStorage.js';
export * from './src/StorageInterface.js';

// Stub so packages that import BrowserStore don't crash when loaded in Node.js.
// Instantiating this in a Node environment will throw at runtime, which is correct.
export class BrowserStore {
  constructor() {
    throw new Error('BrowserStore is not available in Node.js. Use NodeStore instead.');
  }
}
