import type {
  Signer,
  UnsignedNostrEvent,
  NostrEvent,
} from "@tat-protocol/types";
/**
 * Type declaration for window.nostr (NIP-07 extension interface)
 */
declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>;
      signEvent(event: UnsignedNostrEvent): Promise<NostrEvent>;
      nip04: {
        encrypt(pubkey: string, plaintext: string): Promise<string>;
        decrypt(pubkey: string, ciphertext: string): Promise<string>;
      };
      nip44?: {
        encrypt(recipientPubkey: string, plaintext: string): Promise<string>;
        decrypt(senderPubkey: string, ciphertext: string): Promise<string>;
      };
      signSchnorr?(message: string): Promise<string>;
    };
  }
}
/**
 * NIP07Signer - Browser extension signer implementation.
 *
 * This signer implementation works with NIP-07 browser extensions such as:
 * - NostrPass
 * - Alby
 * - nos2x
 * - Flamingo
 *
 * The secret key never leaves the extension, providing better security
 * for browser-based applications.
 *
 * @example
 * ```typescript
 * // Check if NIP-07 is available
 * if (isNIP07Available()) {
 *   const signer = new NIP07Signer();
 *
 *   // Get public key (may prompt user)
 *   const pubkey = await signer.getPublicKey();
 *
 *   // Sign a Nostr event (will prompt user)
 *   const signedEvent = await signer.signEvent({
 *     kind: 1,
 *     content: 'Hello!',
 *     tags: [],
 *     created_at: Math.floor(Date.now() / 1000)
 *   });
 * }
 * ```
 */
export declare class NIP07Signer implements Signer {
  private cachedPubkey;
  /**
   * Get the window.nostr object or throw if unavailable
   */
  private getNostr;
  /**
   * Get the public key for this signer.
   * The public key is cached after the first call to avoid repeated prompts.
   */
  getPublicKey(): Promise<string>;
  /**
   * Sign raw bytes using Schnorr signature.
   *
   * Note: Not all NIP-07 extensions support raw signing.
   * If unsupported, this method will throw an error.
   * For better compatibility, use signEvent instead.
   *
   * @param message - The message bytes to sign
   * @returns The signature as a hex string
   * @throws {Error} If the extension doesn't support raw signing
   */
  sign(message: Uint8Array): Promise<string>;
  /**
   * Sign a Nostr event using the NIP-07 extension.
   * This will prompt the user to approve the signature.
   *
   * @param event - The unsigned event to sign
   * @returns The fully signed event with id, pubkey, and sig
   */
  signEvent(event: UnsignedNostrEvent): Promise<NostrEvent>;
  /**
   * NIP-44 encryption/decryption methods.
   *
   * Note: Some extensions expose NIP-44 through the nip04 interface
   * (NostrPass does this). We try nip44 first, then fall back to nip04.
   */
  nip44: {
    /**
     * Encrypt a message for a recipient
     * @param recipientPubkey - The recipient's public key
     * @param plaintext - The message to encrypt
     * @returns The encrypted ciphertext
     */
    encrypt: (recipientPubkey: string, plaintext: string) => Promise<string>;
    /**
     * Decrypt a message from a sender
     * @param senderPubkey - The sender's public key
     * @param ciphertext - The encrypted message
     * @returns The decrypted plaintext
     */
    decrypt: (senderPubkey: string, ciphertext: string) => Promise<string>;
  };
}
/**
 * Check if NIP-07 is available in the current environment
 * @returns true if window.nostr is available
 */
export declare function isNIP07Available(): boolean;
/**
 * Wait for NIP-07 extension to be injected.
 *
 * Some extensions load asynchronously after the page loads.
 * This function polls for the extension to become available.
 *
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 3000)
 * @returns true if extension became available, false if timeout
 *
 * @example
 * ```typescript
 * const available = await waitForNIP07(5000);
 * if (available) {
 *   const signer = new NIP07Signer();
 *   // Use the signer...
 * } else {
 *   console.log('Please install a Nostr signer extension');
 * }
 * ```
 */
export declare function waitForNIP07(timeoutMs?: number): Promise<boolean>;
