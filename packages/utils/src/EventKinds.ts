/**
 * Nostr event kinds used by the TAT protocol.
 */

/**
 * Spent-token notice published by a forge.
 *
 * Pockets subscribe to these so a token spent on one device is reconciled on
 * the holder's other devices.
 *
 * PROVISIONAL — 7601 is in the regular range (1000-9999), which is the correct
 * range for events relays should retain, and was unallocated when chosen. It is
 * NOT yet registered in a NIP. Before this ships widely: re-check the kind
 * table at https://github.com/nostr-protocol/nips and open a PR registering the
 * choice rather than squatting the number. NIP-60/61 (Cashu wallet, kinds
 * 7374-7376 / 9321) is the precedent to follow.
 */
export const KIND_TOKEN_SPENT = 7601;

/**
 * The original spent-token notice kind.
 *
 * Kind 1 is the short-text-note kind, so these notices render as garbage posts
 * in every social client following the forge's pubkey. It is retained only so
 * pockets on an older SDK keep reconciling during the transition, and forges
 * can stop emitting it via `publishLegacySpentNotes: false` once their holders
 * have updated.
 *
 * @deprecated Use {@link KIND_TOKEN_SPENT}.
 */
export const LEGACY_KIND_TOKEN_SPENT = 1;

/**
 * Tag carrying the spent token hash.
 *
 * Deliberately multi-letter. NIP-01 indexes single-letter tags, and `t` is
 * specifically the *hashtag* tag — publishing token hashes there writes every
 * spend into the global hashtag index of every relay it reaches, which leaks
 * the transaction graph and gets forges rate-limited or banned for tag abuse.
 * Multi-letter tags are not indexed, so the hash travels with the event without
 * entering any relay's search index. Pockets filter on kind + author, never on
 * this tag.
 */
export const TAG_TOKEN_HASH = "token";
