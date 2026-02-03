// Core packages
export * from "@tat-protocol/forge";
export * from "@tat-protocol/hdkeys";
export * from "@tat-protocol/nwpc";
export * from "@tat-protocol/pocket";
export * from "@tat-protocol/utils";
export * from "@tat-protocol/storage";
export * from "@tat-protocol/token";

// Signer types and implementations
export type { Signer, UnsignedNostrEvent, NostrEvent } from "@tat-protocol/types";
export { KeySigner, NIP07Signer, isNIP07Available, waitForNIP07 } from "@tat-protocol/signers";

// Convenience factory functions
export {
  createPocketWithNIP07,
  createPocketWithKey,
  createFungibleForgeWithNIP07,
  createFungibleForgeWithKey,
  createTATForgeWithKey,
  detectSigner,
} from "./factories";