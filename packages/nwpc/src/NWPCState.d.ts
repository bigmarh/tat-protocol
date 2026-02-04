/**
 * Serializable data for state persistence
 */
export interface SerializableData {
  [key: string]: unknown;
}
export interface NWPCState {
  relays: Set<string>;
  processedEventBloom?: SerializableData;
}
