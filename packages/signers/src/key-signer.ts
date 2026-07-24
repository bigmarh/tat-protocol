import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha256";
import { nip44 } from "nostr-tools";
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
export class KeySigner implements Signer {
  private secretKey: Uint8Array;
  private pubkey: string;

  /**
   * Create a new KeySigner with the given secret key
   * @param secretKey - The secret key as hex string or Uint8Array
   */
  constructor(secretKey: string | Uint8Array) {
    this.secretKey =
      typeof secretKey === "string" ? hexToBytes(secretKey) : secretKey;
    this.pubkey = bytesToHex(schnorr.getPublicKey(this.secretKey));
  }

  /**
   * Get the public key for this signer
   */
  async getPublicKey(): Promise<string> {
    return this.pubkey;
  }

  /**
   * Sign raw bytes using Schnorr signature
   * @param message - The message bytes to sign
   * @returns The signature as a hex string
   */
  async sign(message: Uint8Array): Promise<string> {
    const sig = schnorr.sign(message, this.secretKey);
    return bytesToHex(sig);
  }

  /**
   * Sign a Nostr event
   * @param event - The unsigned event to sign
   * @returns The fully signed event with id, pubkey, and sig
   */
  async signEvent(event: UnsignedNostrEvent): Promise<NostrEvent> {
    const serialized = JSON.stringify([
      0,
      this.pubkey,
      event.created_at,
      event.kind,
      event.tags,
      event.content,
    ]);
    const id = bytesToHex(sha256(new TextEncoder().encode(serialized)));
    const sig = await this.sign(hexToBytes(id));

    return {
      ...event,
      id,
      pubkey: this.pubkey,
      sig,
    };
  }

  /**
   * NIP-44 encryption/decryption methods
   */
  nip44 = {
    /**
     * Encrypt a message for a recipient using NIP-44
     * @param recipientPubkey - The recipient's public key
     * @param plaintext - The message to encrypt
     * @returns The encrypted ciphertext
     */
    encrypt: async (
      recipientPubkey: string,
      plaintext: string,
    ): Promise<string> => {
      const conversationKey = nip44.getConversationKey(
        this.secretKey,
        recipientPubkey,
      );
      return nip44.encrypt(plaintext, conversationKey);
    },

    /**
     * Decrypt a message from a sender using NIP-44
     * @param senderPubkey - The sender's public key
     * @param ciphertext - The encrypted message
     * @returns The decrypted plaintext
     */
    decrypt: async (
      senderPubkey: string,
      ciphertext: string,
    ): Promise<string> => {
      const conversationKey = nip44.getConversationKey(
        this.secretKey,
        senderPubkey,
      );
      return nip44.decrypt(ciphertext, conversationKey);
    },
  };
}
