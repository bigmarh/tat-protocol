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
}
