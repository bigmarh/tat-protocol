export interface NWPCState {
  relays: Set<string>;
  // processedEventIds?: Set<string>; // No longer used for runtime checks
  processedEventBloom?: any; // Bloom filter JSON
}
