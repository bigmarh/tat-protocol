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
export class NIP07Signer {
    cachedPubkey = null;
    /**
     * Get the window.nostr object or throw if unavailable
     */
    getNostr() {
        if (typeof window === "undefined" || !window.nostr) {
            throw new Error("NIP-07 extension not available. Install NostrPass, Alby, or another Nostr signer.");
        }
        return window.nostr;
    }
    /**
     * Get the public key for this signer.
     * The public key is cached after the first call to avoid repeated prompts.
     */
    async getPublicKey() {
        if (this.cachedPubkey)
            return this.cachedPubkey;
        this.cachedPubkey = await this.getNostr().getPublicKey();
        return this.cachedPubkey;
    }
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
    async sign(message) {
        const nostr = this.getNostr();
        // Convert to hex string for signSchnorr
        const messageHex = Array.from(message)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
        // If extension supports signSchnorr, use it
        if (nostr.signSchnorr) {
            return nostr.signSchnorr(messageHex);
        }
        // Fallback: some extensions don't support raw signing
        throw new Error("NIP-07 extension does not support raw data signing. Use signEvent instead.");
    }
    /**
     * Sign a Nostr event using the NIP-07 extension.
     * This will prompt the user to approve the signature.
     *
     * @param event - The unsigned event to sign
     * @returns The fully signed event with id, pubkey, and sig
     */
    async signEvent(event) {
        return this.getNostr().signEvent(event);
    }
    /**
     * NIP-44 encryption/decryption methods.
     *
     * Note: Some extensions expose NIP-44 through the nip04 interface
     * (NostrPass does this). We try nip44 first, then fall back to nip04.
     */
    nip44 = {
        /**
         * Encrypt a message for a recipient
         * @param recipientPubkey - The recipient's public key
         * @param plaintext - The message to encrypt
         * @returns The encrypted ciphertext
         */
        encrypt: async (recipientPubkey, plaintext) => {
            const nostr = this.getNostr();
            // Try NIP-44 first, fall back to NIP-04
            if (nostr.nip44?.encrypt) {
                return nostr.nip44.encrypt(recipientPubkey, plaintext);
            }
            // Fall back to nip04 (some extensions implement NIP-44 through this interface)
            return nostr.nip04.encrypt(recipientPubkey, plaintext);
        },
        /**
         * Decrypt a message from a sender
         * @param senderPubkey - The sender's public key
         * @param ciphertext - The encrypted message
         * @returns The decrypted plaintext
         */
        decrypt: async (senderPubkey, ciphertext) => {
            const nostr = this.getNostr();
            // Try NIP-44 first, fall back to NIP-04
            if (nostr.nip44?.decrypt) {
                return nostr.nip44.decrypt(senderPubkey, ciphertext);
            }
            // Fall back to nip04 (some extensions implement NIP-44 through this interface)
            return nostr.nip04.decrypt(senderPubkey, ciphertext);
        },
    };
}
/**
 * Check if NIP-07 is available in the current environment
 * @returns true if window.nostr is available
 */
export function isNIP07Available() {
    return typeof window !== "undefined" && !!window.nostr;
}
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
export async function waitForNIP07(timeoutMs = 3000) {
    if (isNIP07Available())
        return true;
    return new Promise((resolve) => {
        const start = Date.now();
        const check = () => {
            if (isNIP07Available()) {
                resolve(true);
            }
            else if (Date.now() - start > timeoutMs) {
                resolve(false);
            }
            else {
                setTimeout(check, 100);
            }
        };
        check();
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibmlwMDctc2lnbmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsibmlwMDctc2lnbmVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQXVCQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBOEJHO0FBQ0gsTUFBTSxPQUFPLFdBQVc7SUFDZCxZQUFZLEdBQWtCLElBQUksQ0FBQztJQUUzQzs7T0FFRztJQUNLLFFBQVE7UUFDZCxJQUFJLE9BQU8sTUFBTSxLQUFLLFdBQVcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUNuRCxNQUFNLElBQUksS0FBSyxDQUNiLG1GQUFtRixDQUNwRixDQUFDO1FBQ0osQ0FBQztRQUNELE9BQU8sTUFBTSxDQUFDLEtBQUssQ0FBQztJQUN0QixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLFlBQVk7UUFDaEIsSUFBSSxJQUFJLENBQUMsWUFBWTtZQUFFLE9BQU8sSUFBSSxDQUFDLFlBQVksQ0FBQztRQUNoRCxJQUFJLENBQUMsWUFBWSxHQUFHLE1BQU0sSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDLFlBQVksRUFBRSxDQUFDO1FBQ3pELE9BQU8sSUFBSSxDQUFDLFlBQVksQ0FBQztJQUMzQixDQUFDO0lBRUQ7Ozs7Ozs7Ozs7T0FVRztJQUNILEtBQUssQ0FBQyxJQUFJLENBQUMsT0FBbUI7UUFDNUIsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1FBRTlCLHdDQUF3QztRQUN4QyxNQUFNLFVBQVUsR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQzthQUNuQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQzthQUMzQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7UUFFWiw0Q0FBNEM7UUFDNUMsSUFBSSxLQUFLLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDdEIsT0FBTyxLQUFLLENBQUMsV0FBVyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQ3ZDLENBQUM7UUFFRCxzREFBc0Q7UUFDdEQsTUFBTSxJQUFJLEtBQUssQ0FDYiw0RUFBNEUsQ0FDN0UsQ0FBQztJQUNKLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsU0FBUyxDQUFDLEtBQXlCO1FBQ3ZDLE9BQU8sSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUMxQyxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLEdBQUc7UUFDTjs7Ozs7V0FLRztRQUNILE9BQU8sRUFBRSxLQUFLLEVBQ1osZUFBdUIsRUFDdkIsU0FBaUIsRUFDQSxFQUFFO1lBQ25CLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUU5Qix3Q0FBd0M7WUFDeEMsSUFBSSxLQUFLLENBQUMsS0FBSyxFQUFFLE9BQU8sRUFBRSxDQUFDO2dCQUN6QixPQUFPLEtBQUssQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLGVBQWUsRUFBRSxTQUFTLENBQUMsQ0FBQztZQUN6RCxDQUFDO1lBRUQsK0VBQStFO1lBQy9FLE9BQU8sS0FBSyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsZUFBZSxFQUFFLFNBQVMsQ0FBQyxDQUFDO1FBQ3pELENBQUM7UUFFRDs7Ozs7V0FLRztRQUNILE9BQU8sRUFBRSxLQUFLLEVBQ1osWUFBb0IsRUFDcEIsVUFBa0IsRUFDRCxFQUFFO1lBQ25CLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUU5Qix3Q0FBd0M7WUFDeEMsSUFBSSxLQUFLLENBQUMsS0FBSyxFQUFFLE9BQU8sRUFBRSxDQUFDO2dCQUN6QixPQUFPLEtBQUssQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLFlBQVksRUFBRSxVQUFVLENBQUMsQ0FBQztZQUN2RCxDQUFDO1lBRUQsK0VBQStFO1lBQy9FLE9BQU8sS0FBSyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsWUFBWSxFQUFFLFVBQVUsQ0FBQyxDQUFDO1FBQ3ZELENBQUM7S0FDRixDQUFDO0NBQ0g7QUFFRDs7O0dBR0c7QUFDSCxNQUFNLFVBQVUsZ0JBQWdCO0lBQzlCLE9BQU8sT0FBTyxNQUFNLEtBQUssV0FBVyxJQUFJLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDO0FBQ3pELENBQUM7QUFFRDs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW1CRztBQUNILE1BQU0sQ0FBQyxLQUFLLFVBQVUsWUFBWSxDQUFDLFNBQVMsR0FBRyxJQUFJO0lBQ2pELElBQUksZ0JBQWdCLEVBQUU7UUFBRSxPQUFPLElBQUksQ0FBQztJQUVwQyxPQUFPLElBQUksT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUU7UUFDN0IsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBQ3pCLE1BQU0sS0FBSyxHQUFHLEdBQUcsRUFBRTtZQUNqQixJQUFJLGdCQUFnQixFQUFFLEVBQUUsQ0FBQztnQkFDdkIsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQ2hCLENBQUM7aUJBQU0sSUFBSSxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsS0FBSyxHQUFHLFNBQVMsRUFBRSxDQUFDO2dCQUMxQyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUM7WUFDakIsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLFVBQVUsQ0FBQyxLQUFLLEVBQUUsR0FBRyxDQUFDLENBQUM7WUFDekIsQ0FBQztRQUNILENBQUMsQ0FBQztRQUNGLEtBQUssRUFBRSxDQUFDO0lBQ1YsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBTaWduZXIsIFVuc2lnbmVkTm9zdHJFdmVudCwgTm9zdHJFdmVudCB9IGZyb20gXCJAdGF0LXByb3RvY29sL3R5cGVzXCI7XG5cbi8qKlxuICogVHlwZSBkZWNsYXJhdGlvbiBmb3Igd2luZG93Lm5vc3RyIChOSVAtMDcgZXh0ZW5zaW9uIGludGVyZmFjZSlcbiAqL1xuZGVjbGFyZSBnbG9iYWwge1xuICBpbnRlcmZhY2UgV2luZG93IHtcbiAgICBub3N0cj86IHtcbiAgICAgIGdldFB1YmxpY0tleSgpOiBQcm9taXNlPHN0cmluZz47XG4gICAgICBzaWduRXZlbnQoZXZlbnQ6IFVuc2lnbmVkTm9zdHJFdmVudCk6IFByb21pc2U8Tm9zdHJFdmVudD47XG4gICAgICBuaXAwNDoge1xuICAgICAgICBlbmNyeXB0KHB1YmtleTogc3RyaW5nLCBwbGFpbnRleHQ6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPjtcbiAgICAgICAgZGVjcnlwdChwdWJrZXk6IHN0cmluZywgY2lwaGVydGV4dDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+O1xuICAgICAgfTtcbiAgICAgIG5pcDQ0Pzoge1xuICAgICAgICBlbmNyeXB0KHJlY2lwaWVudFB1YmtleTogc3RyaW5nLCBwbGFpbnRleHQ6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPjtcbiAgICAgICAgZGVjcnlwdChzZW5kZXJQdWJrZXk6IHN0cmluZywgY2lwaGVydGV4dDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+O1xuICAgICAgfTtcbiAgICAgIHNpZ25TY2hub3JyPyhtZXNzYWdlOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz47XG4gICAgfTtcbiAgfVxufVxuXG4vKipcbiAqIE5JUDA3U2lnbmVyIC0gQnJvd3NlciBleHRlbnNpb24gc2lnbmVyIGltcGxlbWVudGF0aW9uLlxuICpcbiAqIFRoaXMgc2lnbmVyIGltcGxlbWVudGF0aW9uIHdvcmtzIHdpdGggTklQLTA3IGJyb3dzZXIgZXh0ZW5zaW9ucyBzdWNoIGFzOlxuICogLSBOb3N0clBhc3NcbiAqIC0gQWxieVxuICogLSBub3MyeFxuICogLSBGbGFtaW5nb1xuICpcbiAqIFRoZSBzZWNyZXQga2V5IG5ldmVyIGxlYXZlcyB0aGUgZXh0ZW5zaW9uLCBwcm92aWRpbmcgYmV0dGVyIHNlY3VyaXR5XG4gKiBmb3IgYnJvd3Nlci1iYXNlZCBhcHBsaWNhdGlvbnMuXG4gKlxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIENoZWNrIGlmIE5JUC0wNyBpcyBhdmFpbGFibGVcbiAqIGlmIChpc05JUDA3QXZhaWxhYmxlKCkpIHtcbiAqICAgY29uc3Qgc2lnbmVyID0gbmV3IE5JUDA3U2lnbmVyKCk7XG4gKlxuICogICAvLyBHZXQgcHVibGljIGtleSAobWF5IHByb21wdCB1c2VyKVxuICogICBjb25zdCBwdWJrZXkgPSBhd2FpdCBzaWduZXIuZ2V0UHVibGljS2V5KCk7XG4gKlxuICogICAvLyBTaWduIGEgTm9zdHIgZXZlbnQgKHdpbGwgcHJvbXB0IHVzZXIpXG4gKiAgIGNvbnN0IHNpZ25lZEV2ZW50ID0gYXdhaXQgc2lnbmVyLnNpZ25FdmVudCh7XG4gKiAgICAga2luZDogMSxcbiAqICAgICBjb250ZW50OiAnSGVsbG8hJyxcbiAqICAgICB0YWdzOiBbXSxcbiAqICAgICBjcmVhdGVkX2F0OiBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKVxuICogICB9KTtcbiAqIH1cbiAqIGBgYFxuICovXG5leHBvcnQgY2xhc3MgTklQMDdTaWduZXIgaW1wbGVtZW50cyBTaWduZXIge1xuICBwcml2YXRlIGNhY2hlZFB1YmtleTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG5cbiAgLyoqXG4gICAqIEdldCB0aGUgd2luZG93Lm5vc3RyIG9iamVjdCBvciB0aHJvdyBpZiB1bmF2YWlsYWJsZVxuICAgKi9cbiAgcHJpdmF0ZSBnZXROb3N0cigpIHtcbiAgICBpZiAodHlwZW9mIHdpbmRvdyA9PT0gXCJ1bmRlZmluZWRcIiB8fCAhd2luZG93Lm5vc3RyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiTklQLTA3IGV4dGVuc2lvbiBub3QgYXZhaWxhYmxlLiBJbnN0YWxsIE5vc3RyUGFzcywgQWxieSwgb3IgYW5vdGhlciBOb3N0ciBzaWduZXIuXCJcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiB3aW5kb3cubm9zdHI7XG4gIH1cblxuICAvKipcbiAgICogR2V0IHRoZSBwdWJsaWMga2V5IGZvciB0aGlzIHNpZ25lci5cbiAgICogVGhlIHB1YmxpYyBrZXkgaXMgY2FjaGVkIGFmdGVyIHRoZSBmaXJzdCBjYWxsIHRvIGF2b2lkIHJlcGVhdGVkIHByb21wdHMuXG4gICAqL1xuICBhc3luYyBnZXRQdWJsaWNLZXkoKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBpZiAodGhpcy5jYWNoZWRQdWJrZXkpIHJldHVybiB0aGlzLmNhY2hlZFB1YmtleTtcbiAgICB0aGlzLmNhY2hlZFB1YmtleSA9IGF3YWl0IHRoaXMuZ2V0Tm9zdHIoKS5nZXRQdWJsaWNLZXkoKTtcbiAgICByZXR1cm4gdGhpcy5jYWNoZWRQdWJrZXk7XG4gIH1cblxuICAvKipcbiAgICogU2lnbiByYXcgYnl0ZXMgdXNpbmcgU2Nobm9yciBzaWduYXR1cmUuXG4gICAqXG4gICAqIE5vdGU6IE5vdCBhbGwgTklQLTA3IGV4dGVuc2lvbnMgc3VwcG9ydCByYXcgc2lnbmluZy5cbiAgICogSWYgdW5zdXBwb3J0ZWQsIHRoaXMgbWV0aG9kIHdpbGwgdGhyb3cgYW4gZXJyb3IuXG4gICAqIEZvciBiZXR0ZXIgY29tcGF0aWJpbGl0eSwgdXNlIHNpZ25FdmVudCBpbnN0ZWFkLlxuICAgKlxuICAgKiBAcGFyYW0gbWVzc2FnZSAtIFRoZSBtZXNzYWdlIGJ5dGVzIHRvIHNpZ25cbiAgICogQHJldHVybnMgVGhlIHNpZ25hdHVyZSBhcyBhIGhleCBzdHJpbmdcbiAgICogQHRocm93cyB7RXJyb3J9IElmIHRoZSBleHRlbnNpb24gZG9lc24ndCBzdXBwb3J0IHJhdyBzaWduaW5nXG4gICAqL1xuICBhc3luYyBzaWduKG1lc3NhZ2U6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGNvbnN0IG5vc3RyID0gdGhpcy5nZXROb3N0cigpO1xuXG4gICAgLy8gQ29udmVydCB0byBoZXggc3RyaW5nIGZvciBzaWduU2Nobm9yclxuICAgIGNvbnN0IG1lc3NhZ2VIZXggPSBBcnJheS5mcm9tKG1lc3NhZ2UpXG4gICAgICAubWFwKChiKSA9PiBiLnRvU3RyaW5nKDE2KS5wYWRTdGFydCgyLCBcIjBcIikpXG4gICAgICAuam9pbihcIlwiKTtcblxuICAgIC8vIElmIGV4dGVuc2lvbiBzdXBwb3J0cyBzaWduU2Nobm9yciwgdXNlIGl0XG4gICAgaWYgKG5vc3RyLnNpZ25TY2hub3JyKSB7XG4gICAgICByZXR1cm4gbm9zdHIuc2lnblNjaG5vcnIobWVzc2FnZUhleCk7XG4gICAgfVxuXG4gICAgLy8gRmFsbGJhY2s6IHNvbWUgZXh0ZW5zaW9ucyBkb24ndCBzdXBwb3J0IHJhdyBzaWduaW5nXG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgXCJOSVAtMDcgZXh0ZW5zaW9uIGRvZXMgbm90IHN1cHBvcnQgcmF3IGRhdGEgc2lnbmluZy4gVXNlIHNpZ25FdmVudCBpbnN0ZWFkLlwiXG4gICAgKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTaWduIGEgTm9zdHIgZXZlbnQgdXNpbmcgdGhlIE5JUC0wNyBleHRlbnNpb24uXG4gICAqIFRoaXMgd2lsbCBwcm9tcHQgdGhlIHVzZXIgdG8gYXBwcm92ZSB0aGUgc2lnbmF0dXJlLlxuICAgKlxuICAgKiBAcGFyYW0gZXZlbnQgLSBUaGUgdW5zaWduZWQgZXZlbnQgdG8gc2lnblxuICAgKiBAcmV0dXJucyBUaGUgZnVsbHkgc2lnbmVkIGV2ZW50IHdpdGggaWQsIHB1YmtleSwgYW5kIHNpZ1xuICAgKi9cbiAgYXN5bmMgc2lnbkV2ZW50KGV2ZW50OiBVbnNpZ25lZE5vc3RyRXZlbnQpOiBQcm9taXNlPE5vc3RyRXZlbnQ+IHtcbiAgICByZXR1cm4gdGhpcy5nZXROb3N0cigpLnNpZ25FdmVudChldmVudCk7XG4gIH1cblxuICAvKipcbiAgICogTklQLTQ0IGVuY3J5cHRpb24vZGVjcnlwdGlvbiBtZXRob2RzLlxuICAgKlxuICAgKiBOb3RlOiBTb21lIGV4dGVuc2lvbnMgZXhwb3NlIE5JUC00NCB0aHJvdWdoIHRoZSBuaXAwNCBpbnRlcmZhY2VcbiAgICogKE5vc3RyUGFzcyBkb2VzIHRoaXMpLiBXZSB0cnkgbmlwNDQgZmlyc3QsIHRoZW4gZmFsbCBiYWNrIHRvIG5pcDA0LlxuICAgKi9cbiAgbmlwNDQgPSB7XG4gICAgLyoqXG4gICAgICogRW5jcnlwdCBhIG1lc3NhZ2UgZm9yIGEgcmVjaXBpZW50XG4gICAgICogQHBhcmFtIHJlY2lwaWVudFB1YmtleSAtIFRoZSByZWNpcGllbnQncyBwdWJsaWMga2V5XG4gICAgICogQHBhcmFtIHBsYWludGV4dCAtIFRoZSBtZXNzYWdlIHRvIGVuY3J5cHRcbiAgICAgKiBAcmV0dXJucyBUaGUgZW5jcnlwdGVkIGNpcGhlcnRleHRcbiAgICAgKi9cbiAgICBlbmNyeXB0OiBhc3luYyAoXG4gICAgICByZWNpcGllbnRQdWJrZXk6IHN0cmluZyxcbiAgICAgIHBsYWludGV4dDogc3RyaW5nXG4gICAgKTogUHJvbWlzZTxzdHJpbmc+ID0+IHtcbiAgICAgIGNvbnN0IG5vc3RyID0gdGhpcy5nZXROb3N0cigpO1xuXG4gICAgICAvLyBUcnkgTklQLTQ0IGZpcnN0LCBmYWxsIGJhY2sgdG8gTklQLTA0XG4gICAgICBpZiAobm9zdHIubmlwNDQ/LmVuY3J5cHQpIHtcbiAgICAgICAgcmV0dXJuIG5vc3RyLm5pcDQ0LmVuY3J5cHQocmVjaXBpZW50UHVia2V5LCBwbGFpbnRleHQpO1xuICAgICAgfVxuXG4gICAgICAvLyBGYWxsIGJhY2sgdG8gbmlwMDQgKHNvbWUgZXh0ZW5zaW9ucyBpbXBsZW1lbnQgTklQLTQ0IHRocm91Z2ggdGhpcyBpbnRlcmZhY2UpXG4gICAgICByZXR1cm4gbm9zdHIubmlwMDQuZW5jcnlwdChyZWNpcGllbnRQdWJrZXksIHBsYWludGV4dCk7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIERlY3J5cHQgYSBtZXNzYWdlIGZyb20gYSBzZW5kZXJcbiAgICAgKiBAcGFyYW0gc2VuZGVyUHVia2V5IC0gVGhlIHNlbmRlcidzIHB1YmxpYyBrZXlcbiAgICAgKiBAcGFyYW0gY2lwaGVydGV4dCAtIFRoZSBlbmNyeXB0ZWQgbWVzc2FnZVxuICAgICAqIEByZXR1cm5zIFRoZSBkZWNyeXB0ZWQgcGxhaW50ZXh0XG4gICAgICovXG4gICAgZGVjcnlwdDogYXN5bmMgKFxuICAgICAgc2VuZGVyUHVia2V5OiBzdHJpbmcsXG4gICAgICBjaXBoZXJ0ZXh0OiBzdHJpbmdcbiAgICApOiBQcm9taXNlPHN0cmluZz4gPT4ge1xuICAgICAgY29uc3Qgbm9zdHIgPSB0aGlzLmdldE5vc3RyKCk7XG5cbiAgICAgIC8vIFRyeSBOSVAtNDQgZmlyc3QsIGZhbGwgYmFjayB0byBOSVAtMDRcbiAgICAgIGlmIChub3N0ci5uaXA0ND8uZGVjcnlwdCkge1xuICAgICAgICByZXR1cm4gbm9zdHIubmlwNDQuZGVjcnlwdChzZW5kZXJQdWJrZXksIGNpcGhlcnRleHQpO1xuICAgICAgfVxuXG4gICAgICAvLyBGYWxsIGJhY2sgdG8gbmlwMDQgKHNvbWUgZXh0ZW5zaW9ucyBpbXBsZW1lbnQgTklQLTQ0IHRocm91Z2ggdGhpcyBpbnRlcmZhY2UpXG4gICAgICByZXR1cm4gbm9zdHIubmlwMDQuZGVjcnlwdChzZW5kZXJQdWJrZXksIGNpcGhlcnRleHQpO1xuICAgIH0sXG4gIH07XG59XG5cbi8qKlxuICogQ2hlY2sgaWYgTklQLTA3IGlzIGF2YWlsYWJsZSBpbiB0aGUgY3VycmVudCBlbnZpcm9ubWVudFxuICogQHJldHVybnMgdHJ1ZSBpZiB3aW5kb3cubm9zdHIgaXMgYXZhaWxhYmxlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc05JUDA3QXZhaWxhYmxlKCk6IGJvb2xlYW4ge1xuICByZXR1cm4gdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiAmJiAhIXdpbmRvdy5ub3N0cjtcbn1cblxuLyoqXG4gKiBXYWl0IGZvciBOSVAtMDcgZXh0ZW5zaW9uIHRvIGJlIGluamVjdGVkLlxuICpcbiAqIFNvbWUgZXh0ZW5zaW9ucyBsb2FkIGFzeW5jaHJvbm91c2x5IGFmdGVyIHRoZSBwYWdlIGxvYWRzLlxuICogVGhpcyBmdW5jdGlvbiBwb2xscyBmb3IgdGhlIGV4dGVuc2lvbiB0byBiZWNvbWUgYXZhaWxhYmxlLlxuICpcbiAqIEBwYXJhbSB0aW1lb3V0TXMgLSBNYXhpbXVtIHRpbWUgdG8gd2FpdCBpbiBtaWxsaXNlY29uZHMgKGRlZmF1bHQ6IDMwMDApXG4gKiBAcmV0dXJucyB0cnVlIGlmIGV4dGVuc2lvbiBiZWNhbWUgYXZhaWxhYmxlLCBmYWxzZSBpZiB0aW1lb3V0XG4gKlxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNvbnN0IGF2YWlsYWJsZSA9IGF3YWl0IHdhaXRGb3JOSVAwNyg1MDAwKTtcbiAqIGlmIChhdmFpbGFibGUpIHtcbiAqICAgY29uc3Qgc2lnbmVyID0gbmV3IE5JUDA3U2lnbmVyKCk7XG4gKiAgIC8vIFVzZSB0aGUgc2lnbmVyLi4uXG4gKiB9IGVsc2Uge1xuICogICBjb25zb2xlLmxvZygnUGxlYXNlIGluc3RhbGwgYSBOb3N0ciBzaWduZXIgZXh0ZW5zaW9uJyk7XG4gKiB9XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHdhaXRGb3JOSVAwNyh0aW1lb3V0TXMgPSAzMDAwKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIGlmIChpc05JUDA3QXZhaWxhYmxlKCkpIHJldHVybiB0cnVlO1xuXG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgIGNvbnN0IHN0YXJ0ID0gRGF0ZS5ub3coKTtcbiAgICBjb25zdCBjaGVjayA9ICgpID0+IHtcbiAgICAgIGlmIChpc05JUDA3QXZhaWxhYmxlKCkpIHtcbiAgICAgICAgcmVzb2x2ZSh0cnVlKTtcbiAgICAgIH0gZWxzZSBpZiAoRGF0ZS5ub3coKSAtIHN0YXJ0ID4gdGltZW91dE1zKSB7XG4gICAgICAgIHJlc29sdmUoZmFsc2UpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc2V0VGltZW91dChjaGVjaywgMTAwKTtcbiAgICAgIH1cbiAgICB9O1xuICAgIGNoZWNrKCk7XG4gIH0pO1xufVxuIl19