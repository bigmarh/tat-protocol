import type {
  Signer,
  UnsignedNostrEvent,
  NostrEvent,
} from "@tat-protocol/types";
/**
 * KeySigner - Direct key access signer implementation.
 *
 * This signer implementation provides direct access to signing operations
 * using a secret key. It's suitable for:
 * - Server-side applications (Node.js)
 * - Testing and development
 * - Backwards compatibility with existing code
 *
 * For browser environments where the secret key should not be exposed,
 * use NIP07Signer instead.
 *
 * @example
 * ```typescript
 * // From hex string
 * const signer = new KeySigner(secretKeyHex);
 *
 * // From Uint8Array
 * const signer = new KeySigner(secretKeyBytes);
 *
 * // Get public key
 * const pubkey = await signer.getPublicKey();
 *
 * // Sign a Nostr event
 * const signedEvent = await signer.signEvent({
 *   kind: 1,
 *   content: 'Hello!',
 *   tags: [],
 *   created_at: Math.floor(Date.now() / 1000)
 * });
 * ```
 */
export declare class KeySigner implements Signer {
  private secretKey;
  private pubkey;
  /**
   * Create a new KeySigner with the given secret key
   * @param secretKey - The secret key as hex string or Uint8Array
   */
  constructor(secretKey: string | Uint8Array);
  /**
   * Get the public key for this signer
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
     * Encrypt a message for a recipient using NIP-44
     * @param recipientPubkey - The recipient's public key
     * @param plaintext - The message to encrypt
     * @returns The encrypted ciphertext
     */
    encrypt: (recipientPubkey: string, plaintext: string) => Promise<string>;
    /**
     * Decrypt a message from a sender using NIP-44
     * @param senderPubkey - The sender's public key
     * @param ciphertext - The encrypted message
     * @returns The decrypted plaintext
     */
    decrypt: (senderPubkey: string, ciphertext: string) => Promise<string>;
  };
}
