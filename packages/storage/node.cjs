const { Storage } = require("./dist-cjs/Storage.js");
const { NodeStore } = require("./dist-cjs/DiskStorage.js");
const iface = require("./dist-cjs/StorageInterface.js");

// Stub so packages that import BrowserStore load in Node.js.
// Instantiating this throws at runtime, which is the correct behaviour.
class BrowserStore {
  constructor() {
    throw new Error(
      "BrowserStore is not available in Node.js. Use NodeStore instead.",
    );
  }
}

module.exports = {
  ...iface,
  Storage,
  NodeStore,
  Backend: NodeStore,
  BrowserStore,
};
