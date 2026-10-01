/**
 * Serializable data for state persistence
 */
export interface SerializableData {
  [key: string]: unknown;
}

export interface NWPCState {
  relays: Set<string>;
  // processedEventIds?: Set<string>; // No longer used for runtime checks
  processedEventBloom?: SerializableData; // Bloom filter JSON
  /**
   * `created_at` (unix seconds) of the newest event received. Subscriptions
   * resume from here, so a peer that was offline asks for what it missed
   * instead of only the last few minutes.
   */
  lastSeenAt?: number;
}
