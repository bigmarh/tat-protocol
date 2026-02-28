import {
  generateSecretKey,
  getPublicKey,
  verifyEvent,
  Event,
} from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils";
import NDK, { NDKEvent, NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import type { Signer } from "@tat-protocol/types";
import { DebugLogger } from "./debug.js";

const Debug = DebugLogger.getInstance();

/**
 * Wrap a message for a recipient using a Signer interface.
 *
 * This creates a gift-wrapped (kind 1059) Nostr event with triple-layer encryption:
 * 1. Kind 14 (MMPC) with the message
 * 2. Kind 13 envelope encrypting the MMPC
 * 3. Kind 1059 gift-wrap encrypting the envelope with random postman key
 *
 * @param ndk - NDK instance for creating events
 * @param message - The message to wrap
 * @param signer - The signer interface for signing and encryption
 * @param to - The recipient's public key
 * @returns The wrapped NDKEvent ready to publish
 */
export async function WrapWithSigner(
  ndk: NDK,
  message: string,
  signer: Signer,
  to: string,
): Promise<NDKEvent> {
  const fromPubkey = await signer.getPublicKey();
  const timestamp = Math.floor(Date.now() / 1000);

  // Build MMPC of Kind 14
  const MMPC = new NDKEvent(ndk);
  MMPC.content = message;
  MMPC.pubkey = fromPubkey;
  MMPC.tags = [["p", to]];
  MMPC.kind = 14;
  MMPC.created_at = timestamp;

  // Seal Kind 14 in 13 envelope
  const envelope = new NDKEvent(ndk);
  envelope.pubkey = fromPubkey;
  envelope.created_at = timestamp;
  envelope.kind = 13;
  envelope.tags = [];
  envelope.content = await signer.nip44.encrypt(to, JSON.stringify(MMPC));

  // Sign the envelope using the signer
  const envelopeEvent = await signer.signEvent({
    kind: envelope.kind,
    content: envelope.content,
    tags: envelope.tags,
    created_at: envelope.created_at,
  });
  envelope.id = envelopeEvent.id;
  envelope.sig = envelopeEvent.sig;

  // Gift wrap envelope using random postman
  const postmanSecretKey = generateSecretKey();
  const postmanPubkey = getPublicKey(postmanSecretKey);
  const postmanSecretKeyHex = bytesToHex(postmanSecretKey);

  const giftwrap = new NDKEvent(ndk);
  giftwrap.pubkey = postmanPubkey;
  giftwrap.created_at = timestamp;
  giftwrap.kind = 1059;
  giftwrap.tags = [["p", to]];

  // Use nostr-tools nip44 for the postman encryption (we have the key)
  const { nip44 } = await import("nostr-tools");
  const postmanConversationKey = nip44.getConversationKey(postmanSecretKey, to);
  giftwrap.content = nip44.encrypt(
    JSON.stringify(envelope),
    postmanConversationKey,
  );

  // Sign the giftwrap using NDK's signer (we have the postman key)
  const giftwrapSigner = new NDKPrivateKeySigner(postmanSecretKeyHex);
  giftwrap.sig = await giftwrap.sign(giftwrapSigner);

  if (verifyEvent(giftwrap.rawEvent() as unknown as Event)) {
    return giftwrap;
  } else {
    throw new Error("Failed to verify giftwrap signature");
  }
}

/**
 * Unwrap result from a gift-wrapped message
 */
export interface UnwrapResult {
  verifiedSender: boolean;
  sender: string;
  kind: number;
  content: string;
}

/**
 * Unwrap a gift-wrapped message using a Signer interface.
 *
 * This decrypts a gift-wrapped (kind 1059) Nostr event and verifies the sender:
 * 1. Decrypt the kind 1059 gift-wrap
 * 2. Parse the kind 13 envelope
 * 3. Verify the envelope signature
 * 4. Decrypt the kind 14 (MMPC) message
 *
 * @param wrapped - The encrypted content from the gift-wrap event
 * @param signer - The signer interface for decryption
 * @param wrappedPubKey - The public key of the gift-wrap poster (postman)
 * @returns The unwrapped message with sender verification, or null/false on failure
 */
export async function UnwrapWithSigner(
  wrapped: string,
  signer: Signer,
  wrappedPubKey: string,
): Promise<UnwrapResult | false | null> {
  try {
    // Unwrap gift
    const unwrapped = JSON.parse(
      await signer.nip44.decrypt(wrappedPubKey, wrapped),
    );

    // Open envelope
    const openEnv = JSON.parse(
      await signer.nip44.decrypt(unwrapped.pubkey, unwrapped.content),
    );

    const ndk = new NDK();
    // Unwrap the event for verification
    const unW = new NDKEvent(ndk, unwrapped);

    if (!openEnv.content) return null;

    if (openEnv.pubkey === unwrapped.pubkey) {
      // Verify event is valid
      return {
        verifiedSender: unW.verifySignature(true) ?? false,
        sender: openEnv.pubkey,
        kind: openEnv.kind,
        content: openEnv.content,
      };
    } else {
      throw new Error("Pubkeys don't match, Sender doesn't match writer");
    }
  } catch (error: unknown) {
    Debug.error("Error Unwrapping Message" + error, "SignerNostr");
    return false;
  }
}
