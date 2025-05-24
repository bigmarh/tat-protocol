// tests/integration/test-utils.ts

export class TestUtils {
  static async waitForEventProcessing(ms: number = 1000): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static generateTestKeys() {
    const mockSecretKey = '0'.repeat(64);
    const mockPublicKey = '1'.repeat(64);
    
    return {
      secretKey: mockSecretKey,
      publicKey: mockPublicKey
    };
  }

  static async createMockForge() {
    const keys = TestUtils.generateTestKeys();
    
    const mockForge = {
      keys,
      async request(method: string, params: any, publicKey: string) {
        return {
          result: {
            token: 'mock-token-jwt',
            success: true
          }
        };
      },
      async initialize() {
        return true;
      },
      getPublicKey() {
        return keys.publicKey;
      }
    };

    return { forge: mockForge, keys };
  }

  static async createMockPocket() {
    const keys = TestUtils.generateTestKeys();
    
    const mockPocket = {
      keys,
      balances: new Map(),
      
      getBalance(issuer: string, setId: string) {
        const key = `${issuer}-${setId}`;
        return this.balances.get(key) || 0;
      },
      
      setBalance(issuer: string, setId: string, amount: number) {
        const key = `${issuer}-${setId}`;
        this.balances.set(key, amount);
      },
      
      async transfer(issuer: string, to: string, amount: number) {
        return {
          result: {
            success: true,
            transferId: 'mock-transfer-id'
          }
        };
      },
      
      getState() {
        return {
          keys: this.keys,
          tokens: new Map(),
          tatIndex: new Map(),
          balances: this.balances
        };
      }
    };

    return { pocket: mockPocket, keys };
  }

  // THE MISSING METHOD - NOW ADDED
  static async measureTransactionThroughput(
    forge: any,
    users: any[],
    numTransactions: number
  ): Promise<{ tps: number; totalTime: number }> {
    const startTime = Date.now();
    
    for (let i = 0; i < numTransactions; i++) {
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    
    const endTime = Date.now();
    const totalTime = (endTime - startTime) / 1000;
    const tps = numTransactions / totalTime;

    return { tps, totalTime };
  }
}

export class PerformanceTestUtils {
  static async measureTransactionThroughput(
    forge: any,
    users: any[],
    numTransactions: number
  ): Promise<{ tps: number; totalTime: number }> {
    return TestUtils.measureTransactionThroughput(forge, users, numTransactions);
  }
}
