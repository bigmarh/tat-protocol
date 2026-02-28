// Key-based signer for direct key access
export { KeySigner } from "./key-signer.js";

// NIP-07 browser extension signer
export { NIP07Signer, isNIP07Available, waitForNIP07 } from "./nip07-signer.js";

// Re-export Signer types for convenience
export type {
  Signer,
  UnsignedNostrEvent,
  NostrEvent,
} from "@tat-protocol/types";
