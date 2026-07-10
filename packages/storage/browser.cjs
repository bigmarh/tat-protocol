const { Storage } = require("./dist-cjs/Storage.js");
const { BrowserStore } = require("./dist-cjs/BrowserStorage.js");
const iface = require("./dist-cjs/StorageInterface.js");

module.exports = {
  ...iface,
  Storage,
  BrowserStore,
};
