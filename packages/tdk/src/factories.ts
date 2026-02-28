import { Pocket } from "@tat-protocol/pocket";
import { FungibleForge, TATForge } from "@tat-protocol/forge";
import { KeySigner, NIP07Signer, isNIP07Available, waitForNIP07 } from "@tat-protocol/signers";
import { StorageInterface } from "@tat-protocol/storage";
import type { Signer } from "@tat-protocol/types";

/**
 * Create a Pocket instance with a NIP-07 browser extension signer.
 *
 * This is the recommended way to create a Pocket in browser environments.
 * The user's keys are managed by their browser extension (NostrPass, Alby, etc.)
 * and never exposed to the application.
 *
 * @param options - Configuration options excluding the signer
 * @returns A fully initialized Pocket instance
 * @throws {Error} If no NIP-07 extension is available
 *
 * @example
 * ```typescript
 * // In a browser with NostrPass installed
 * const pocket = await createPocketWithNIP07({
 *   storage: new BrowserStorage(),
 *   relays: ['wss://relay.damus.io']
 * });
 *
 * // The pocket now uses the browser extension for signing
 * const balance = pocket.getBalance('issuerPubkey', '-');
 * ```
 */
export async function createPocketWithNIP07(options: {
  storage: StorageInterface;
  relays?: string[];
  timeoutMs?: number;
}): Promise<Pocket> {
  const available = await waitForNIP07(options.timeoutMs || 3000);
  if (!available) {
    throw new Error(
      "No NIP-07 signer available. Please install NostrPass, Alby, or another Nostr signer extension."
    );
  }

  return Pocket.create({
    signer: new NIP07Signer(),
    storage: options.storage,
    relays: options.relays,
  });
}

/**
 * Create a Pocket instance with a direct secret key.
 *
 * This is recommended for server-side use, testing, or when the user
 * has explicitly provided their key. The key is stored in memory.
 *
 * @param options - Configuration options including the secret key
 * @returns A fully initialized Pocket instance
 *
 * @example
 * ```typescript
 * // Server-side usage
 * const pocket = await createPocketWithKey({
 *   secretKey: process.env.USER_SECRET_KEY,
 *   storage: new NodeStorage({ path: './pocket' }),
 *   relays: ['wss://relay.damus.io']
 * });
 * ```
 */
export async function createPocketWithKey(options: {
  secretKey: string;
  storage: StorageInterface;
  relays?: string[];
}): Promise<Pocket> {
  return Pocket.create({
    signer: new KeySigner(options.secretKey),
    storage: options.storage,
    relays: options.relays,
  });
}

/**
 * Create a FungibleForge instance with a NIP-07 browser extension signer.
 *
 * Note: Running a forge in a browser with NIP-07 is unusual but supported.
 * This is primarily useful for testing or demo purposes.
 *
 * @param options - Configuration options excluding the signer
 * @returns A fully initialized FungibleForge instance
 * @throws {Error} If no NIP-07 extension is available
 */
export async function createFungibleForgeWithNIP07(options: {
  owner: string;
  storage: StorageInterface;
  relays?: string[];
  totalSupply?: number;
  timeoutMs?: number;
}): Promise<FungibleForge> {
  const available = await waitForNIP07(options.timeoutMs || 3000);
  if (!available) {
    throw new Error(
      "No NIP-07 signer available. Please install NostrPass, Alby, or another Nostr signer extension."
    );
  }

  const forge = new FungibleForge({
    signer: new NIP07Signer(),
    owner: options.owner,
    storage: options.storage,
    relays: options.relays,
    totalSupply: options.totalSupply,
  });
  await forge.initialize();
  return forge;
}

/**
 * Create a FungibleForge instance with a direct secret key.
 *
 * This is the recommended way to create a forge for server-side use.
 *
 * @param options - Configuration options including the secret key
 * @returns A fully initialized FungibleForge instance
 *
 * @example
 * ```typescript
 * // Server-side forge
 * const forge = await createFungibleForgeWithKey({
 *   secretKey: process.env.FORGE_SECRET_KEY,
 *   owner: 'ownerPubkey',
 *   storage: new NodeStorage({ path: './forge' }),
 *   relays: ['wss://relay.damus.io'],
 *   totalSupply: 1000000
 * });
 * ```
 */
export async function createFungibleForgeWithKey(options: {
  secretKey: string;
  owner: string;
  storage: StorageInterface;
  relays?: string[];
  totalSupply?: number;
}): Promise<FungibleForge> {
  const forge = new FungibleForge({
    signer: new KeySigner(options.secretKey),
    owner: options.owner,
    storage: options.storage,
    relays: options.relays,
    totalSupply: options.totalSupply,
  });
  await forge.initialize();
  return forge;
}

/**
 * Create a TATForge instance with a direct secret key.
 *
 * Use this for issuing Transferable Access Tokens (non-fungible tokens).
 *
 * @param options - Configuration options including the secret key
 * @returns A fully initialized TATForge instance
 *
 * @example
 * ```typescript
 * // Server-side TAT forge for event tickets
 * const forge = await createTATForgeWithKey({
 *   secretKey: process.env.FORGE_SECRET_KEY,
 *   owner: 'ownerPubkey',
 *   storage: new NodeStorage({ path: './tat-forge' }),
 *   relays: ['wss://relay.damus.io']
 * });
 * ```
 */
export async function createTATForgeWithKey(options: {
  secretKey: string;
  owner: string;
  storage: StorageInterface;
  relays?: string[];
}): Promise<TATForge> {
  const forge = new TATForge({
    signer: new KeySigner(options.secretKey),
    owner: options.owner,
    storage: options.storage,
    relays: options.relays,
  });
  await forge.initialize();
  return forge;
}

/**
 * Detect the best signer to use based on environment.
 *
 * In browser environments with NIP-07, returns a NIP07Signer.
 * Otherwise, requires a secret key to create a KeySigner.
 *
 * @param secretKey - Optional secret key for KeySigner fallback
 * @returns The appropriate signer for the environment
 * @throws {Error} If in browser without NIP-07 and no secretKey provided
 *
 * @example
 * ```typescript
 * // Works in any environment
 * const signer = await detectSigner(process.env.SECRET_KEY);
 * const pocket = await Pocket.create({
 *   signer,
 *   storage,
 *   relays
 * });
 * ```
 */
export async function detectSigner(secretKey?: string): Promise<Signer> {
  // In browser with NIP-07 available, use it
  if (isNIP07Available()) {
    return new NIP07Signer();
  }

  // Otherwise, require secret key
  if (!secretKey) {
    throw new Error(
      "No NIP-07 extension available and no secret key provided. " +
        "Either install a Nostr signer extension or provide a secret key."
    );
  }

  return new KeySigner(secretKey);
}
