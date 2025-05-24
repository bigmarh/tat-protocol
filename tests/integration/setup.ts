// tests/integration/setup.ts
import { EventEmitter } from 'events';

// Simplified Mock Relay (without TypeScript private fields that cause issues)
export class MockNostrRelay extends EventEmitter {
  public server: any;
  public connections: Set<any> = new Set();
  public events: Map<string, any> = new Map();

  constructor(port: number = 8080) {
    super();
    
    // Use a simple mock instead of actual WebSocketServer for now
    this.server = {
      close: () => {
        console.log('Mock relay closed');
      }
    };
    
    console.log(`Mock Nostr relay initialized on port ${port}`);
  }

  handleEvent(event: any) {
    this.events.set(event.id, event);
  }

  close() {
    if (this.server && this.server.close) {
      this.server.close();
    }
  }
}

// Global test setup
let mockRelay: MockNostrRelay;

beforeAll(async () => {
  console.log('Setting up integration test environment...');
  mockRelay = new MockNostrRelay(8080);
  
  // Wait for setup
  await new Promise(resolve => setTimeout(resolve, 100));
});

afterAll(async () => {
  if (mockRelay) {
    mockRelay.close();
  }
  console.log('Integration test environment cleaned up');
});

export { mockRelay };
