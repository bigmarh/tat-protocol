import { schnorr } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha256";
import { nip44 } from "nostr-tools";
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
export class KeySigner {
    secretKey;
    pubkey;
    /**
     * Create a new KeySigner with the given secret key
     * @param secretKey - The secret key as hex string or Uint8Array
     */
    constructor(secretKey) {
        this.secretKey =
            typeof secretKey === "string" ? hexToBytes(secretKey) : secretKey;
        this.pubkey = bytesToHex(schnorr.getPublicKey(this.secretKey));
    }
    /**
     * Get the public key for this signer
     */
    async getPublicKey() {
        return this.pubkey;
    }
    /**
     * Sign raw bytes using Schnorr signature
     * @param message - The message bytes to sign
     * @returns The signature as a hex string
     */
    async sign(message) {
        const sig = schnorr.sign(message, this.secretKey);
        return bytesToHex(sig);
    }
    /**
     * Sign a Nostr event
     * @param event - The unsigned event to sign
     * @returns The fully signed event with id, pubkey, and sig
     */
    async signEvent(event) {
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
        encrypt: async (recipientPubkey, plaintext) => {
            const conversationKey = nip44.getConversationKey(this.secretKey, recipientPubkey);
            return nip44.encrypt(plaintext, conversationKey);
        },
        /**
         * Decrypt a message from a sender using NIP-44
         * @param senderPubkey - The sender's public key
         * @param ciphertext - The encrypted message
         * @returns The decrypted plaintext
         */
        decrypt: async (senderPubkey, ciphertext) => {
            const conversationKey = nip44.getConversationKey(this.secretKey, senderPubkey);
            return nip44.decrypt(ciphertext, conversationKey);
        },
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoia2V5LXNpZ25lci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImtleS1zaWduZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxFQUFFLE9BQU8sRUFBRSxNQUFNLHlCQUF5QixDQUFDO0FBQ2xELE9BQU8sRUFBRSxVQUFVLEVBQUUsVUFBVSxFQUFFLE1BQU0scUJBQXFCLENBQUM7QUFDN0QsT0FBTyxFQUFFLE1BQU0sRUFBRSxNQUFNLHNCQUFzQixDQUFDO0FBQzlDLE9BQU8sRUFBRSxLQUFLLEVBQUUsTUFBTSxhQUFhLENBQUM7QUFHcEM7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0ErQkc7QUFDSCxNQUFNLE9BQU8sU0FBUztJQUNaLFNBQVMsQ0FBYTtJQUN0QixNQUFNLENBQVM7SUFFdkI7OztPQUdHO0lBQ0gsWUFBWSxTQUE4QjtRQUN4QyxJQUFJLENBQUMsU0FBUztZQUNaLE9BQU8sU0FBUyxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUM7UUFDcEUsSUFBSSxDQUFDLE1BQU0sR0FBRyxVQUFVLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQztJQUNqRSxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsWUFBWTtRQUNoQixPQUFPLElBQUksQ0FBQyxNQUFNLENBQUM7SUFDckIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsSUFBSSxDQUFDLE9BQW1CO1FBQzVCLE1BQU0sR0FBRyxHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUNsRCxPQUFPLFVBQVUsQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUN6QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxTQUFTLENBQUMsS0FBeUI7UUFDdkMsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQztZQUNoQyxDQUFDO1lBQ0QsSUFBSSxDQUFDLE1BQU07WUFDWCxLQUFLLENBQUMsVUFBVTtZQUNoQixLQUFLLENBQUMsSUFBSTtZQUNWLEtBQUssQ0FBQyxJQUFJO1lBQ1YsS0FBSyxDQUFDLE9BQU87U0FDZCxDQUFDLENBQUM7UUFDSCxNQUFNLEVBQUUsR0FBRyxVQUFVLENBQUMsTUFBTSxDQUFDLElBQUksV0FBVyxFQUFFLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNwRSxNQUFNLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7UUFFNUMsT0FBTztZQUNMLEdBQUcsS0FBSztZQUNSLEVBQUU7WUFDRixNQUFNLEVBQUUsSUFBSSxDQUFDLE1BQU07WUFDbkIsR0FBRztTQUNKLENBQUM7SUFDSixDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLEdBQUc7UUFDTjs7Ozs7V0FLRztRQUNILE9BQU8sRUFBRSxLQUFLLEVBQ1osZUFBdUIsRUFDdkIsU0FBaUIsRUFDQSxFQUFFO1lBQ25CLE1BQU0sZUFBZSxHQUFHLEtBQUssQ0FBQyxrQkFBa0IsQ0FDOUMsSUFBSSxDQUFDLFNBQVMsRUFDZCxlQUFlLENBQ2hCLENBQUM7WUFDRixPQUFPLEtBQUssQ0FBQyxPQUFPLENBQUMsU0FBUyxFQUFFLGVBQWUsQ0FBQyxDQUFDO1FBQ25ELENBQUM7UUFFRDs7Ozs7V0FLRztRQUNILE9BQU8sRUFBRSxLQUFLLEVBQ1osWUFBb0IsRUFDcEIsVUFBa0IsRUFDRCxFQUFFO1lBQ25CLE1BQU0sZUFBZSxHQUFHLEtBQUssQ0FBQyxrQkFBa0IsQ0FDOUMsSUFBSSxDQUFDLFNBQVMsRUFDZCxZQUFZLENBQ2IsQ0FBQztZQUNGLE9BQU8sS0FBSyxDQUFDLE9BQU8sQ0FBQyxVQUFVLEVBQUUsZUFBZSxDQUFDLENBQUM7UUFDcEQsQ0FBQztLQUNGLENBQUM7Q0FDSCIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHNjaG5vcnIgfSBmcm9tIFwiQG5vYmxlL2N1cnZlcy9zZWNwMjU2azFcIjtcbmltcG9ydCB7IGJ5dGVzVG9IZXgsIGhleFRvQnl0ZXMgfSBmcm9tIFwiQG5vYmxlL2hhc2hlcy91dGlsc1wiO1xuaW1wb3J0IHsgc2hhMjU2IH0gZnJvbSBcIkBub2JsZS9oYXNoZXMvc2hhMjU2XCI7XG5pbXBvcnQgeyBuaXA0NCB9IGZyb20gXCJub3N0ci10b29sc1wiO1xuaW1wb3J0IHR5cGUgeyBTaWduZXIsIFVuc2lnbmVkTm9zdHJFdmVudCwgTm9zdHJFdmVudCB9IGZyb20gXCJAdGF0LXByb3RvY29sL3R5cGVzXCI7XG5cbi8qKlxuICogS2V5U2lnbmVyIC0gRGlyZWN0IGtleSBhY2Nlc3Mgc2lnbmVyIGltcGxlbWVudGF0aW9uLlxuICpcbiAqIFRoaXMgc2lnbmVyIGltcGxlbWVudGF0aW9uIHByb3ZpZGVzIGRpcmVjdCBhY2Nlc3MgdG8gc2lnbmluZyBvcGVyYXRpb25zXG4gKiB1c2luZyBhIHNlY3JldCBrZXkuIEl0J3Mgc3VpdGFibGUgZm9yOlxuICogLSBTZXJ2ZXItc2lkZSBhcHBsaWNhdGlvbnMgKE5vZGUuanMpXG4gKiAtIFRlc3RpbmcgYW5kIGRldmVsb3BtZW50XG4gKiAtIEJhY2t3YXJkcyBjb21wYXRpYmlsaXR5IHdpdGggZXhpc3RpbmcgY29kZVxuICpcbiAqIEZvciBicm93c2VyIGVudmlyb25tZW50cyB3aGVyZSB0aGUgc2VjcmV0IGtleSBzaG91bGQgbm90IGJlIGV4cG9zZWQsXG4gKiB1c2UgTklQMDdTaWduZXIgaW5zdGVhZC5cbiAqXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gRnJvbSBoZXggc3RyaW5nXG4gKiBjb25zdCBzaWduZXIgPSBuZXcgS2V5U2lnbmVyKHNlY3JldEtleUhleCk7XG4gKlxuICogLy8gRnJvbSBVaW50OEFycmF5XG4gKiBjb25zdCBzaWduZXIgPSBuZXcgS2V5U2lnbmVyKHNlY3JldEtleUJ5dGVzKTtcbiAqXG4gKiAvLyBHZXQgcHVibGljIGtleVxuICogY29uc3QgcHVia2V5ID0gYXdhaXQgc2lnbmVyLmdldFB1YmxpY0tleSgpO1xuICpcbiAqIC8vIFNpZ24gYSBOb3N0ciBldmVudFxuICogY29uc3Qgc2lnbmVkRXZlbnQgPSBhd2FpdCBzaWduZXIuc2lnbkV2ZW50KHtcbiAqICAga2luZDogMSxcbiAqICAgY29udGVudDogJ0hlbGxvIScsXG4gKiAgIHRhZ3M6IFtdLFxuICogICBjcmVhdGVkX2F0OiBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKVxuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNsYXNzIEtleVNpZ25lciBpbXBsZW1lbnRzIFNpZ25lciB7XG4gIHByaXZhdGUgc2VjcmV0S2V5OiBVaW50OEFycmF5O1xuICBwcml2YXRlIHB1YmtleTogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBDcmVhdGUgYSBuZXcgS2V5U2lnbmVyIHdpdGggdGhlIGdpdmVuIHNlY3JldCBrZXlcbiAgICogQHBhcmFtIHNlY3JldEtleSAtIFRoZSBzZWNyZXQga2V5IGFzIGhleCBzdHJpbmcgb3IgVWludDhBcnJheVxuICAgKi9cbiAgY29uc3RydWN0b3Ioc2VjcmV0S2V5OiBzdHJpbmcgfCBVaW50OEFycmF5KSB7XG4gICAgdGhpcy5zZWNyZXRLZXkgPVxuICAgICAgdHlwZW9mIHNlY3JldEtleSA9PT0gXCJzdHJpbmdcIiA/IGhleFRvQnl0ZXMoc2VjcmV0S2V5KSA6IHNlY3JldEtleTtcbiAgICB0aGlzLnB1YmtleSA9IGJ5dGVzVG9IZXgoc2Nobm9yci5nZXRQdWJsaWNLZXkodGhpcy5zZWNyZXRLZXkpKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgdGhlIHB1YmxpYyBrZXkgZm9yIHRoaXMgc2lnbmVyXG4gICAqL1xuICBhc3luYyBnZXRQdWJsaWNLZXkoKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICByZXR1cm4gdGhpcy5wdWJrZXk7XG4gIH1cblxuICAvKipcbiAgICogU2lnbiByYXcgYnl0ZXMgdXNpbmcgU2Nobm9yciBzaWduYXR1cmVcbiAgICogQHBhcmFtIG1lc3NhZ2UgLSBUaGUgbWVzc2FnZSBieXRlcyB0byBzaWduXG4gICAqIEByZXR1cm5zIFRoZSBzaWduYXR1cmUgYXMgYSBoZXggc3RyaW5nXG4gICAqL1xuICBhc3luYyBzaWduKG1lc3NhZ2U6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGNvbnN0IHNpZyA9IHNjaG5vcnIuc2lnbihtZXNzYWdlLCB0aGlzLnNlY3JldEtleSk7XG4gICAgcmV0dXJuIGJ5dGVzVG9IZXgoc2lnKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTaWduIGEgTm9zdHIgZXZlbnRcbiAgICogQHBhcmFtIGV2ZW50IC0gVGhlIHVuc2lnbmVkIGV2ZW50IHRvIHNpZ25cbiAgICogQHJldHVybnMgVGhlIGZ1bGx5IHNpZ25lZCBldmVudCB3aXRoIGlkLCBwdWJrZXksIGFuZCBzaWdcbiAgICovXG4gIGFzeW5jIHNpZ25FdmVudChldmVudDogVW5zaWduZWROb3N0ckV2ZW50KTogUHJvbWlzZTxOb3N0ckV2ZW50PiB7XG4gICAgY29uc3Qgc2VyaWFsaXplZCA9IEpTT04uc3RyaW5naWZ5KFtcbiAgICAgIDAsXG4gICAgICB0aGlzLnB1YmtleSxcbiAgICAgIGV2ZW50LmNyZWF0ZWRfYXQsXG4gICAgICBldmVudC5raW5kLFxuICAgICAgZXZlbnQudGFncyxcbiAgICAgIGV2ZW50LmNvbnRlbnQsXG4gICAgXSk7XG4gICAgY29uc3QgaWQgPSBieXRlc1RvSGV4KHNoYTI1NihuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoc2VyaWFsaXplZCkpKTtcbiAgICBjb25zdCBzaWcgPSBhd2FpdCB0aGlzLnNpZ24oaGV4VG9CeXRlcyhpZCkpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLmV2ZW50LFxuICAgICAgaWQsXG4gICAgICBwdWJrZXk6IHRoaXMucHVia2V5LFxuICAgICAgc2lnLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogTklQLTQ0IGVuY3J5cHRpb24vZGVjcnlwdGlvbiBtZXRob2RzXG4gICAqL1xuICBuaXA0NCA9IHtcbiAgICAvKipcbiAgICAgKiBFbmNyeXB0IGEgbWVzc2FnZSBmb3IgYSByZWNpcGllbnQgdXNpbmcgTklQLTQ0XG4gICAgICogQHBhcmFtIHJlY2lwaWVudFB1YmtleSAtIFRoZSByZWNpcGllbnQncyBwdWJsaWMga2V5XG4gICAgICogQHBhcmFtIHBsYWludGV4dCAtIFRoZSBtZXNzYWdlIHRvIGVuY3J5cHRcbiAgICAgKiBAcmV0dXJucyBUaGUgZW5jcnlwdGVkIGNpcGhlcnRleHRcbiAgICAgKi9cbiAgICBlbmNyeXB0OiBhc3luYyAoXG4gICAgICByZWNpcGllbnRQdWJrZXk6IHN0cmluZyxcbiAgICAgIHBsYWludGV4dDogc3RyaW5nXG4gICAgKTogUHJvbWlzZTxzdHJpbmc+ID0+IHtcbiAgICAgIGNvbnN0IGNvbnZlcnNhdGlvbktleSA9IG5pcDQ0LmdldENvbnZlcnNhdGlvbktleShcbiAgICAgICAgdGhpcy5zZWNyZXRLZXksXG4gICAgICAgIHJlY2lwaWVudFB1YmtleVxuICAgICAgKTtcbiAgICAgIHJldHVybiBuaXA0NC5lbmNyeXB0KHBsYWludGV4dCwgY29udmVyc2F0aW9uS2V5KTtcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogRGVjcnlwdCBhIG1lc3NhZ2UgZnJvbSBhIHNlbmRlciB1c2luZyBOSVAtNDRcbiAgICAgKiBAcGFyYW0gc2VuZGVyUHVia2V5IC0gVGhlIHNlbmRlcidzIHB1YmxpYyBrZXlcbiAgICAgKiBAcGFyYW0gY2lwaGVydGV4dCAtIFRoZSBlbmNyeXB0ZWQgbWVzc2FnZVxuICAgICAqIEByZXR1cm5zIFRoZSBkZWNyeXB0ZWQgcGxhaW50ZXh0XG4gICAgICovXG4gICAgZGVjcnlwdDogYXN5bmMgKFxuICAgICAgc2VuZGVyUHVia2V5OiBzdHJpbmcsXG4gICAgICBjaXBoZXJ0ZXh0OiBzdHJpbmdcbiAgICApOiBQcm9taXNlPHN0cmluZz4gPT4ge1xuICAgICAgY29uc3QgY29udmVyc2F0aW9uS2V5ID0gbmlwNDQuZ2V0Q29udmVyc2F0aW9uS2V5KFxuICAgICAgICB0aGlzLnNlY3JldEtleSxcbiAgICAgICAgc2VuZGVyUHVia2V5XG4gICAgICApO1xuICAgICAgcmV0dXJuIG5pcDQ0LmRlY3J5cHQoY2lwaGVydGV4dCwgY29udmVyc2F0aW9uS2V5KTtcbiAgICB9LFxuICB9O1xufVxuIl19