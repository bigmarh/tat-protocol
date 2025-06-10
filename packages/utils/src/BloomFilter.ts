interface BloomFilterStats {
  size: number;
  hashFunctions: number;
  itemsAdded: number;
  expectedItems: number;
  targetFalsePositiveRate: number;
  currentFalsePositiveRate: number;
  fillRatio: number;
  memoryUsage: number;
}

interface SerializedBloomFilter {
  metadata: string;
  bits: string;
}

interface BloomFilterMetadata {
  size: number;
  hashFunctions: number;
  expectedItems: number;
  falsePositiveRate: number;
  itemsAdded: number;
  hashSeeds: number[];
}

type BloomFilterInput = string | number | boolean | Date | ArrayBufferView | object | null | undefined;

class BloomFilter {
  private readonly size: number;
  private readonly hashFunctions: number;
  private readonly expectedItems: number;
  private readonly falsePositiveRate: number;
  private readonly bits: Uint8Array;
  private readonly hashSeeds: number[];
  private itemsAdded: number = 0;

  constructor(expectedItems: number = 1000, falsePositiveRate: number = 0.01) {
    // Validate inputs
    if (expectedItems <= 0 || falsePositiveRate <= 0 || falsePositiveRate >= 1) {
      throw new Error('Invalid parameters: expectedItems must be > 0, falsePositiveRate must be between 0 and 1');
    }

    // Calculate optimal size and hash functions
    this.expectedItems = expectedItems;
    this.falsePositiveRate = falsePositiveRate;
    this.size = this.calculateOptimalSize(expectedItems, falsePositiveRate);
    this.hashFunctions = this.calculateOptimalHashFunctions(this.size, expectedItems);
    this.bits = new Uint8Array(Math.ceil(this.size / 8));

    // Pre-compute hash constants for better distribution
    this.hashSeeds = this.generateHashSeeds(this.hashFunctions);
  }

  // Calculate optimal bit array size
  private calculateOptimalSize(n: number, p: number): number {
    return Math.ceil(-n * Math.log(p) / (Math.log(2) ** 2));
  }

  // Calculate optimal number of hash functions
  private calculateOptimalHashFunctions(m: number, n: number): number {
    return Math.max(1, Math.round((m / n) * Math.log(2)));
  }

  // Generate independent hash seeds
  private generateHashSeeds(count: number): number[] {
    const seeds: number[] = [];
    let seed = 0x9747b28c; // Starting seed
    
    for (let i = 0; i < count; i++) {
      seeds.push(seed);
      // Linear congruential generator for next seed
      seed = (seed * 1664525 + 1013904223) >>> 0;
    }
    
    return seeds;
  }

  // Improved hash function using MurmurHash3-like algorithm
  private hash(item: BloomFilterInput, seed: number): number {
    const str = this.normalizeInput(item);
    const data = new TextEncoder().encode(str);
    
    let hash = seed;
    const c1 = 0xcc9e2d51;
    const c2 = 0x1b873593;
    const r1 = 15;
    const r2 = 13;
    const m = 5;
    const n = 0xe6546b64;

    // Process 4-byte chunks
    for (let i = 0; i < data.length - 3; i += 4) {
      let k = data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24);
      
      k = Math.imul(k, c1);
      k = (k << r1) | (k >>> (32 - r1));
      k = Math.imul(k, c2);
      
      hash ^= k;
      hash = (hash << r2) | (hash >>> (32 - r2));
      hash = Math.imul(hash, m) + n;
    }

    // Handle remaining bytes
    let k = 0;
    const remaining = data.length % 4;
    if (remaining >= 3) k ^= data[data.length - remaining + 2] << 16;
    if (remaining >= 2) k ^= data[data.length - remaining + 1] << 8;
    if (remaining >= 1) {
      k ^= data[data.length - remaining];
      k = Math.imul(k, c1);
      k = (k << r1) | (k >>> (32 - r1));
      k = Math.imul(k, c2);
      hash ^= k;
    }

    // Finalization
    hash ^= data.length;
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x85ebca6b);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2ae35);
    hash ^= hash >>> 16;

    return (hash >>> 0) % this.size; // Ensure positive
  }

  // Normalize input for consistent hashing
  private normalizeInput(item: BloomFilterInput): string {
    if (item === null || item === undefined) {
      throw new Error('Cannot add null or undefined to bloom filter');
    }
    
    if (typeof item === 'string') return item;
    if (typeof item === 'number') return item.toString();
    if (typeof item === 'boolean') return item.toString();
    if (item instanceof Date) return item.toISOString();
    if (ArrayBuffer.isView(item)) return Array.from(item as Uint8Array).toString();
    
    try {
      return JSON.stringify(item);
    } catch (e) {
      throw new Error('Cannot serialize item for bloom filter');
    }
  }

  // Set a bit at the given position
  private setBit(position: number): void {
    const byteIndex = Math.floor(position / 8);
    const bitIndex = position % 8;
    this.bits[byteIndex] |= (1 << bitIndex);
  }

  // Check if a bit is set at the given position
  private getBit(position: number): boolean {
    const byteIndex = Math.floor(position / 8);
    const bitIndex = position % 8;
    return (this.bits[byteIndex] & (1 << bitIndex)) !== 0;
  }

  // Add an item to the bloom filter
  add(item: BloomFilterInput): void {
    for (let i = 0; i < this.hashFunctions; i++) {
      const position = this.hash(item, this.hashSeeds[i]);
      this.setBit(position);
    }
    this.itemsAdded++;
  }

  // Check if an item might be in the set
  contains(item: BloomFilterInput): boolean {
    for (let i = 0; i < this.hashFunctions; i++) {
      const position = this.hash(item, this.hashSeeds[i]);
      if (!this.getBit(position)) {
        return false; // Definitely not in the set
      }
    }
    return true; // Might be in the set
  }

  // Get current false positive probability
  getCurrentFalsePositiveRate(): number {
    if (this.itemsAdded === 0) return 0;
    
    const k = this.hashFunctions;
    const m = this.size;
    const n = this.itemsAdded;
    
    return Math.pow(1 - Math.exp(-k * n / m), k);
  }

  // Check if filter is approaching capacity
  isNearCapacity(threshold: number = 0.8): boolean {
    return this.getCurrentFalsePositiveRate() > (this.falsePositiveRate * threshold);
  }

  // Get filter statistics
  getStats(): BloomFilterStats {
    return {
      size: this.size,
      hashFunctions: this.hashFunctions,
      itemsAdded: this.itemsAdded,
      expectedItems: this.expectedItems,
      targetFalsePositiveRate: this.falsePositiveRate,
      currentFalsePositiveRate: this.getCurrentFalsePositiveRate(),
      fillRatio: this.getFillRatio(),
      memoryUsage: this.bits.length
    };
  }

  // Get the ratio of set bits
  getFillRatio(): number {
    let setBits = 0;
    for (let i = 0; i < this.size; i++) {
      if (this.getBit(i)) setBits++;
    }
    return setBits / this.size;
  }

  // Serialize to base64 with metadata
  serialize(): string {
    const metadata: BloomFilterMetadata = {
      size: this.size,
      hashFunctions: this.hashFunctions,
      expectedItems: this.expectedItems,
      falsePositiveRate: this.falsePositiveRate,
      itemsAdded: this.itemsAdded,
      hashSeeds: this.hashSeeds
    };
    
    const metadataStr = JSON.stringify(metadata);
    const bitsStr = btoa(String.fromCharCode(...this.bits));
    
    const serialized: SerializedBloomFilter = {
      metadata: metadataStr,
      bits: bitsStr
    };
    
    return JSON.stringify(serialized);
  }

  // Deserialize from serialized data
  static deserialize(serializedData: string): BloomFilter {
    try {
      const parsed: SerializedBloomFilter = JSON.parse(serializedData);
      const metadata: BloomFilterMetadata = JSON.parse(parsed.metadata);
      
      const filter = new BloomFilter(1, 0.1); // Temporary values
      
      // Restore metadata using type assertion to bypass readonly
      (filter as any).size = metadata.size;
      (filter as any).hashFunctions = metadata.hashFunctions;
      (filter as any).expectedItems = metadata.expectedItems;
      (filter as any).falsePositiveRate = metadata.falsePositiveRate;
      (filter as any).hashSeeds = metadata.hashSeeds;
      filter.itemsAdded = metadata.itemsAdded;
      
      // Restore bits
      const binaryString = atob(parsed.bits);
      (filter as any).bits = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        (filter as any).bits[i] = binaryString.charCodeAt(i);
      }
      
      return filter;
    } catch (e) {
      throw new Error(`Invalid serialized bloom filter data: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }

  // Union with another bloom filter (must have same parameters)
  union(other: BloomFilter): BloomFilter {
    if (this.size !== other.size || this.hashFunctions !== other.hashFunctions) {
      throw new Error('Cannot union bloom filters with different parameters');
    }
    
    const result = new BloomFilter(this.expectedItems, this.falsePositiveRate);
    
    // Override readonly properties for result filter
    (result as any).size = this.size;
    (result as any).hashFunctions = this.hashFunctions;
    (result as any).hashSeeds = [...this.hashSeeds];
    (result as any).bits = new Uint8Array(this.bits.length);
    
    // OR the bits together
    for (let i = 0; i < this.bits.length; i++) {
      (result as any).bits[i] = this.bits[i] | other.bits[i];
    }
    
    result.itemsAdded = this.itemsAdded + other.itemsAdded;
    return result;
  }

  // Clear all bits
  clear(): void {
    this.bits.fill(0);
    this.itemsAdded = 0;
  }

  // Get the number of items added
  getItemsAdded(): number {
    return this.itemsAdded;
  }

  // Get the size of the bit array
  getSize(): number {
    return this.size;
  }

  // Get the number of hash functions
  getHashFunctions(): number {
    return this.hashFunctions;
  }
}

export { BloomFilter, type BloomFilterStats, type BloomFilterInput };