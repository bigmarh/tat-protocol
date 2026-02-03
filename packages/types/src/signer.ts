/**
 * Unsigned Nostr event structure (before signing)
 */
export interface UnsignedNostrEvent {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
}

/**
 * Signed Nostr event structure
 */
export interface NostrEvent extends UnsignedNostrEvent {
  id: string;
  pubkey: string;
  sig: string;
}

/**
 * Signer interface for abstracting key management.
 *
 * This interface enables integration with various signing backends including:
 * - Direct key access (KeySigner) for server-side use
 * - NIP-07 browser extensions (NIP07Signer) like NostrPass, Alby, nos2x
 * - Hardware wallets or other secure signing solutions
 *
 * By abstracting signing operations, applications can work with different
 * key management solutions without changing their core logic.
 *
 * @example
 * ```typescript
 * // Server-side with direct key access
 * const signer = new KeySigner(secretKey);
 *
 * // Browser with NIP-07 extension
 * const signer = new NIP07Signer();
 *
 * // Both work identically
 * const pubkey = await signer.getPublicKey();
 * const signedEvent = await signer.signEvent(unsignedEvent);
 * ```
 */
export interface Signer {
  /**
   * Get the public key for this signer
   * @returns The public key as a hex string
   */
  getPublicKey(): Promise<string>;

  /**
   * Sign raw bytes using Schnorr signature
   * @param message - The message bytes to sign
   * @returns The signature as a hex string
   */
  sign(message: Uint8Array): Promise<string>;

  /**
   * Sign a Nostr event
   * @param event - The unsigned event to sign
   * @returns The fully signed event with id, pubkey, and sig
   */
  signEvent(event: UnsignedNostrEvent): Promise<NostrEvent>;

  /**
   * NIP-44 encryption/decryption methods
   */
  nip44: {
    /**
     * Encrypt a message for a recipient
     * @param recipientPubkey - The recipient's public key
     * @param plaintext - The message to encrypt
     * @returns The encrypted ciphertext
     */
    encrypt(recipientPubkey: string, plaintext: string): Promise<string>;

    /**
     * Decrypt a message from a sender
     * @param senderPubkey - The sender's public key
     * @param ciphertext - The encrypted message
     * @returns The decrypted plaintext
     */
    decrypt(senderPubkey: string, ciphertext: string): Promise<string>;
  };
}
