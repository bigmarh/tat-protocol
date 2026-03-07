export { Storage } from "./dist/Storage.js";
export { NodeStore } from "./dist/DiskStorage.js";
export { NodeStore as Backend } from "./dist/DiskStorage.js";
export * from "./dist/StorageInterface.js";

// Stub so packages that import BrowserStore compile/load in Node.js.
// Instantiating this throws at runtime, which is the correct behaviour.
export class BrowserStore {
  constructor() {
    throw new Error("BrowserStore is not available in Node.js. Use NodeStore instead.");
  }
}
