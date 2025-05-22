import {
  generateSecretKey,
  getPublicKey,
  nip44,
  verifyEvent,
  Event,
} from "nostr-tools";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import NDK, {
  NDKEvent,
  NDKKind,
  NDKPrivateKeySigner,
  NDKTag,
} from "@nostr-dev-kit/ndk";
import { KeyPair } from "@tat-protocol/hdkeys";

export { generateSecretKey, getPublicKey, nip44, verifyEvent };

type ProfileData = {
  name: string;
  display_name: string;
  about: string;
  picture?: string; //url
  banner?: string; //url
  website?: string; //url
  nip05?: string; // NIP-05 verification
  lud16?: string; // Lightning address
  // You can add any other custom fields
  [key: string]: string | undefined;
};
// Helper to convert string private key to Uint8Array
export function toUint8Array(str: string): Uint8Array {
  return hexToBytes(str);
}

// Helper to convert Uint8Array private key to string
export function toString(u8a: Uint8Array): string {
  return bytesToHex(u8a);
}

export async function postToFeed(
  ndk: NDK,
  message: string,
  fromKeys: KeyPair,
  tags: NDKTag[] = [],
) {
  const signer = new NDKPrivateKeySigner(fromKeys.secretKey);
  const timestamp = Math.floor(Date.now() / 1000); // Use Unix timestamp in seconds

  const post = new NDKEvent(ndk);
  post.content = message;
  post.pubkey = String(fromKeys.publicKey);
  post.kind = 1;
  post.created_at = timestamp;
  post.tags = tags;
  post.sig = await post.sign(signer);
  return post;
}

export async function updateProfile(
  ndk: NDK,
  fromKeys: KeyPair,
  profileData: ProfileData,
) {
  const signer = new NDKPrivateKeySigner(fromKeys.secretKey);
  const timestamp = Math.floor(Date.now() / 1000); // Use Unix timestamp in seconds

  const profile = new NDKEvent(ndk);
  profile.content = JSON.stringify(profileData);
  profile.pubkey = String(fromKeys.publicKey);
  profile.kind = 0;
  profile.created_at = timestamp;
  profile.sig = await profile.sign(signer);
  return profile;
}

export async function follow(ndk: NDK, fromKeys: KeyPair, toPubkey: string) {
  const signer = new NDKPrivateKeySigner(fromKeys.secretKey);
  const event = new NDKEvent(ndk);
  // Set the kind to 3 (contact list)
  event.kind = NDKKind.Contacts;
  // Add p tags for each pubkey you want to follow
  event.tags.push(["p", toPubkey]);

  // Sign and publish the event
  try {
    event.created_at = Math.floor(Date.now() / 1000);
    event.sig = await event.sign(signer);
    await event.publish();
    console.log("Follow event published successfully!");
    return event.id;
  } catch (error) {
    console.error("Failed to publish follow event:", error);
    throw error;
  }
}

// Function to get users a person follows
export async function getFollows(ndk: NDK, pubkey: string) {
  const filter = {
    kinds: [3],
    authors: [pubkey],
  };

  const events = await ndk.fetchEvents(filter);
  // The latest kind:3 event contains the full list of follows
  const latestEvent = Array.from(events).sort(
    (a, b) => (b?.created_at ?? 0) - (a?.created_at ?? 0),
  )[0];

  if (latestEvent) {
    // Extract the pubkeys from the 'p' tags
    return latestEvent.tags
      .filter((tag) => tag[0] === "p")
      .map((tag) => tag[1]);
  }
  return [];
}

// Function to get followers of a user
export async function getFollowers(ndk: NDK, pubkey: string) {
  const filter = {
    kinds: [3],
    "#p": [pubkey],
  };

  const events = await ndk.fetchEvents(filter);
  // Extract authors who have this pubkey in their contact list
  return Array.from(events).map((event) => event.pubkey);
}

export async function Wrap(
  ndk: NDK,
  message: string,
  fromKeys: KeyPair,
  To: string,
) {
  const u8aFromKey = toUint8Array(fromKeys.secretKey);
  const timestamp = Math.floor(Date.now() / 1000); // Use Unix timestamp in seconds

  //Build MMPC of Kind 14
  const MMPC = new NDKEvent(ndk);
  MMPC.content = message;
  MMPC.pubkey = String(fromKeys.publicKey);
  MMPC.tags = [["p", To]];
  MMPC.kind = 14;
  MMPC.created_at = timestamp;

  //Seal Kind 14 in 13 envelope
  const envelope = new NDKEvent(ndk);
  envelope.pubkey = String(fromKeys.publicKey);
  envelope.created_at = timestamp;
  envelope.kind = 13;
  envelope.tags = [];
  envelope.content = nip44Encrypt(JSON.stringify(MMPC), u8aFromKey, To);

  // Sign the envelope using NDK's signer
  const envelopeSigner = new NDKPrivateKeySigner(bytesToHex(u8aFromKey));
  await envelope.sign(envelopeSigner);

  //giftwrap Envelope Using random Postman
  const secretKey = generateSecretKey();
  const postMan: KeyPair = {
    secretKey: toString(secretKey),
    publicKey: getPublicKey(secretKey),
  };

  const giftwrap = new NDKEvent(ndk);
  giftwrap.pubkey = postMan.publicKey;
  giftwrap.created_at = timestamp;
  giftwrap.kind = 1059;
  giftwrap.tags = [["p", To]];
  giftwrap.content = nip44Encrypt(
    JSON.stringify(envelope),
    toUint8Array(postMan.secretKey),
    To,
  );

  // Sign the giftwrap using NDK's signer
  const giftwrapSigner = new NDKPrivateKeySigner(postMan.secretKey);
  giftwrap.sig = await giftwrap.sign(giftwrapSigner);

  if (verifyEvent(giftwrap.rawEvent() as unknown as Event)) {
    return giftwrap;
  } else {
    throw new Error("Failed to verify giftwrap signature");
  }
}

export async function Unwrap(
  wrapped: string,
  localKeys: KeyPair,
  wrappedPubKey: string,
) {
  try {
    //Unwrap gift
    const unwrapped = JSON.parse(
      nip44Decrypt(wrapped, toUint8Array(localKeys.secretKey), wrappedPubKey),
    );
    //Open Envelope
    const openEnv = JSON.parse(
      nip44Decrypt(
        unwrapped.content,
        toUint8Array(localKeys.secretKey),
        unwrapped.pubkey,
      ),
    );

    if (!openEnv.content) return null;

    if (openEnv.pubkey == unwrapped.pubkey) {
      return {
        sender: openEnv.pubkey,
        kind: openEnv.kind,
        content: openEnv.content,
      };
    } else {
      throw new Error("Pubkeys don't match, Sender doesn't match writer");
    }
  } catch (error: any) {
    console.error("Error Unwrapping Message", error);
    return false;
  }
}

export function getRandomTimestampWithinTwoDays() {
  const now = Date.now();
  const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000; // 2 days in milliseconds

  // Generate a random time between now and two days ago
  const randomTimestamp = twoDaysAgo + Math.random() * (now - twoDaysAgo);
  return Math.round(randomTimestamp / 1000);
}

export function nip44Encrypt(
  message: string,
  senderPriv: Uint8Array,
  recPubKey: string,
) {
  const key = nip44.getConversationKey(senderPriv, recPubKey);
  return nip44.encrypt(message, key);
}

export function nip44Decrypt(
  ciphertext: string,
  recPriv: Uint8Array,
  senderPubKey: string,
) {
  const key = nip44.getConversationKey(recPriv, senderPubKey);
  return nip44.decrypt(ciphertext, key);
}
