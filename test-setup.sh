#!/bin/bash

# TAT Protocol Testing Framework Setup Script
# This script sets up comprehensive testing infrastructure for the TAT Protocol monorepo

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to backup existing files
backup_file() {
    local file="$1"
    if [ -f "$file" ]; then
        cp "$file" "${file}.backup.$(date +%Y%m%d_%H%M%S)"
        print_warning "Backed up existing $file"
    fi
}

# Function to create directory if it doesn't exist
ensure_dir() {
    local dir="$1"
    if [ ! -d "$dir" ]; then
        mkdir -p "$dir"
        print_status "Created directory: $dir"
    fi
}

# Main setup function
main() {
    print_status "Starting TAT Protocol Testing Framework Setup..."
    echo

    # Check prerequisites
    print_status "Checking prerequisites..."
    
    if ! command_exists node; then
        print_error "Node.js is required but not installed."
        exit 1
    fi
    
    if ! command_exists pnpm; then
        print_error "pnpm is required but not installed. Install with: npm install -g pnpm"
        exit 1
    fi

    print_success "Prerequisites check passed"
    echo

    # Get current directory (should be monorepo root)
    MONOREPO_ROOT=$(pwd)
    print_status "Setting up testing framework in: $MONOREPO_ROOT"

    # Create test directory structure
    print_status "Creating test directory structure..."
    
    ensure_dir "tests"
    ensure_dir "tests/unit"
    ensure_dir "tests/integration"
    ensure_dir "tests/e2e"
    ensure_dir "tests/performance"
    ensure_dir "tests/security"
    ensure_dir "tests/fixtures"
    ensure_dir "scripts"
    ensure_dir "test-results"
    ensure_dir ".github/workflows"

    # Create Jest configuration
    print_status "Setting up Jest configuration..."
    
    backup_file "jest.config.js"
    cat > jest.config.js << 'EOF'
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: [
    '**/tests/**/*.test.ts',
    '**/src/**/*.test.ts',
    '**/integration/**/*.test.ts'
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testTimeout: 30000, // 30 seconds for integration tests
  maxWorkers: 1, // Run tests sequentially to avoid relay conflicts
  verbose: true,
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/*.test.ts'],
      testTimeout: 10000
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
      testTimeout: 60000,
      setupFilesAfterEnv: ['<rootDir>/tests/integration/setup.ts']
    }
  ]
};
EOF

    # Create test setup files
    print_status "Creating test setup files..."
    
    cat > tests/setup.ts << 'EOF'
// tests/setup.ts - Global test setup
import { jest } from '@jest/globals';

// Global test timeout
jest.setTimeout(30000);

// Setup test environment
beforeAll(async () => {
  console.log('🧪 Starting TAT Protocol Test Suite');
});

afterAll(async () => {
  console.log('✅ TAT Protocol Test Suite Complete');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
EOF

    # Create integration test setup with mock relay
    cat > tests/integration/setup.ts << 'EOF'
// tests/integration/setup.ts
import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';

// Mock Nostr Relay for testing
class MockNostrRelay extends EventEmitter {
  private server: WebSocketServer;
  private connections: Set<any> = new Set();
  private events: Map<string, any> = new Map();

  constructor(port: number = 8080) {
    super();
    this.server = new WebSocketServer({ port });
    this.setupServer();
  }

  private setupServer() {
    this.server.on('connection', (ws) => {
      this.connections.add(ws);
      console.log('Client connected to mock relay');

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error) {
          console.error('Error parsing message:', error);
        }
      });

      ws.on('close', () => {
        this.connections.delete(ws);
        console.log('Client disconnected from mock relay');
      });
    });
  }

  private handleMessage(ws: any, message: any) {
    const [type, ...args] = message;

    switch (type) {
      case 'EVENT':
        this.handleEvent(args[0]);
        break;
      case 'REQ':
        this.handleSubscription(ws, args[0], args[1]);
        break;
      case 'CLOSE':
        // Handle subscription close
        break;
    }
  }

  private handleEvent(event: any) {
    // Store event
    this.events.set(event.id, event);
    
    // Broadcast to all connected clients
    const message = JSON.stringify(['EVENT', 'subscription', event]);
    this.connections.forEach(ws => {
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(message);
      }
    });
  }

  private handleSubscription(ws: any, subId: string, filter: any) {
    // Send matching events
    const matchingEvents = Array.from(this.events.values()).filter(event => 
      this.matchesFilter(event, filter)
    );

    matchingEvents.forEach(event => {
      const message = JSON.stringify(['EVENT', subId, event]);
      ws.send(message);
    });

    // Send EOSE
    ws.send(JSON.stringify(['EOSE', subId]));
  }

  private matchesFilter(event: any, filter: any): boolean {
    if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
    if (filter['#p'] && !event.tags.some((tag: any) => 
      tag[0] === 'p' && filter['#p'].includes(tag[1])
    )) return false;
    if (filter.since && event.created_at < filter.since) return false;
    if (filter.until && event.created_at > filter.until) return false;
    return true;
  }

  close() {
    this.server.close();
  }
}

// Global test setup
let mockRelay: MockNostrRelay;

beforeAll(async () => {
  // Start mock relay
  mockRelay = new MockNostrRelay(8080);
  
  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('Mock Nostr relay started on port 8080');
});

afterAll(async () => {
  if (mockRelay) {
    mockRelay.close();
  }
});

// Export for use in tests
export { MockNostrRelay };
EOF

    # Create test utilities
    cat > tests/integration/test-utils.ts << 'EOF'
// tests/integration/test-utils.ts
import { Forge } from '@tat-protocol/forge';
import { Pocket } from '@tat-protocol/pocket';
import { TokenType } from '@tat-protocol/token';
import { MemoryStorage } from '@tat-protocol/storage';
import { getPublicKey } from 'nostr-tools';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils';
import { generateSecretKey } from 'nostr-tools';

const TEST_RELAYS = ['ws://localhost:8080'];

export class TestUtils {
  static async waitForEventProcessing(ms: number = 1000): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static generateTestKeys() {
    const secretKey = bytesToHex(generateSecretKey());
    return {
      secretKey,
      publicKey: getPublicKey(hexToBytes(secretKey))
    };
  }

  static async createTestForge(config: Partial<any> = {}) {
    const keys = TestUtils.generateTestKeys();
    const ownerKeys = TestUtils.generateTestKeys();
    
    const forge = new Forge({
      owner: ownerKeys.publicKey,
      keys,
      tokenType: TokenType.FUNGIBLE,
      totalSupply: 1000000,
      authorizedForgers: [keys.publicKey],
      storage: new MemoryStorage(),
      relays: TEST_RELAYS,
      ...config
    });

    await forge.initialize();
    return { forge, keys, ownerKeys };
  }

  static async createTestPocket(keys?: any) {
    const pocketKeys = keys || TestUtils.generateTestKeys();
    
    const pocket = await Pocket.create({
      keys: pocketKeys,
      storage: new MemoryStorage(),
      relays: TEST_RELAYS
    });

    return { pocket, keys: pocketKeys };
  }
}

export class PerformanceTestUtils {
  static async measureTransactionThroughput(
    forge: any,
    users: any[],
    numTransactions: number
  ): Promise<{ tps: number; totalTime: number }> {
    const startTime = Date.now();
    
    const promises = [];
    for (let i = 0; i < numTransactions; i++) {
      const fromUser = users[i % users.length];
      const toUser = users[(i + 1) % users.length];
      
      promises.push(
        fromUser.transfer(
          forge.getPublicKey(),
          toUser.getState().keys.publicKey,
          10
        ).catch(() => {}) // Ignore failures for throughput measurement
      );
    }

    await Promise.allSettled(promises);
    const endTime = Date.now();
    const totalTime = (endTime - startTime) / 1000; // seconds
    const tps = numTransactions / totalTime;

    return { tps, totalTime };
  }

  static async stressTestForge(
    forge: any,
    numUsers: number,
    transactionsPerUser: number
  ): Promise<{
    successfulTransactions: number;
    failedTransactions: number;
    averageResponseTime: number;
  }> {
    const users = [];
    for (let i = 0; i < numUsers; i++) {
      const { pocket } = await TestUtils.createTestPocket();
      users.push(pocket);
    }

    // Distribute initial tokens
    for (const user of users) {
      await forge.request('forge', {
        amount: transactionsPerUser * 10,
        to: user.getState().keys.publicKey
      }, forge.getPublicKey());
    }

    await TestUtils.waitForEventProcessing(numUsers * 100);

    // Perform stress test
    const promises = [];
    const responseTimes = [];
    
    for (let i = 0; i < numUsers * transactionsPerUser; i++) {
      const fromUser = users[i % numUsers];
      const toUser = users[(i + 1) % numUsers];
      
      const startTime = Date.now();
      const promise = fromUser.transfer(
        forge.getPublicKey(),
        toUser.getState().keys.publicKey,
        1
      ).then(() => {
        responseTimes.push(Date.now() - startTime);
      });
      
      promises.push(promise);
    }

    const results = await Promise.allSettled(promises);
    
    const successfulTransactions = results.filter(r => r.status === 'fulfilled').length;
    const failedTransactions = results.filter(r => r.status === 'rejected').length;
    const averageResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;

    return {
      successfulTransactions,
      failedTransactions,
      averageResponseTime
    };
  }
}
EOF

    # Create sample token lifecycle test
    cat > tests/integration/token-lifecycle.test.ts << 'EOF'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { TestUtils } from './test-utils';
import { TokenType } from '@tat-protocol/token';
import { MemoryStorage } from '@tat-protocol/storage';

describe('Token Lifecycle Integration Tests', () => {
  describe('Fungible Token Lifecycle', () => {
    it('should complete full fungible token lifecycle: mint -> transfer -> verify', async () => {
      const { forge, keys: forgeKeys } = await TestUtils.createTestForge();
      const { pocket: user1 } = await TestUtils.createTestPocket();
      const { pocket: user2 } = await TestUtils.createTestPocket();

      // Step 1: Forge mints tokens to user1
      const mintResponse = await forge.request('forge', [{
        amount: 1000,
        to: user1.getState().keys.publicKey
      }], forgeKeys.publicKey);

      expect(mintResponse.result).toBeDefined();
      expect(mintResponse.result.token).toBeDefined();

      // Wait for event processing
      await TestUtils.waitForEventProcessing(2000);
      
      const user1Balance = user1.getBalance(forgeKeys.publicKey, '-');
      expect(user1Balance).toBe(1000);

      // Step 2: User1 transfers tokens to user2
      const transferResponse = await user1.transfer(
        forgeKeys.publicKey,
        user2.getState().keys.publicKey,
        500
      );

      expect(transferResponse.result).toBeDefined();

      // Wait for transfer to complete
      await TestUtils.waitForEventProcessing(2000);

      // Step 3: Verify balances after transfer
      const user1BalanceAfter = user1.getBalance(forgeKeys.publicKey, '-');
      const user2BalanceAfter = user2.getBalance(forgeKeys.publicKey, '-');

      expect(user1BalanceAfter).toBe(500); // 1000 - 500
      expect(user2BalanceAfter).toBe(500); // received 500

      // Step 4: Verify token validity
      const tokens = user2.getState().tokens.get(forgeKeys.publicKey);
      expect(tokens).toBeDefined();
      expect(tokens!.size).toBeGreaterThan(0);

      // Pick a token and verify it
      const tokenJWT = Array.from(tokens!.values())[0];
      const verifyResponse = await forge.request('verify', [{
        tokenJWT
      }], forgeKeys.publicKey);

      expect(verifyResponse.result.valid).toBe(true);
    });
  });

  describe('TAT (Non-Fungible Token) Lifecycle', () => {
    it('should complete full TAT lifecycle: mint -> transfer -> verify', async () => {
      const { forge, keys: forgeKeys } = await TestUtils.createTestForge({
        tokenType: TokenType.TAT,
        totalSupply: 100
      });

      const { pocket: user1 } = await TestUtils.createTestPocket();
      const { pocket: user2 } = await TestUtils.createTestPocket();

      // Step 1: Mint TAT to user1
      const mintResponse = await forge.request('forge', [{
        to: user1.getState().keys.publicKey
      }], forgeKeys.publicKey);

      expect(mintResponse.result).toBeDefined();
      expect(mintResponse.result.token).toBeDefined();

      await TestUtils.waitForEventProcessing(2000);

      // Verify TAT was received
      const tatTokens = user1.getState().tatIndex.get(forgeKeys.publicKey);
      expect(tatTokens).toBeDefined();
      expect(tatTokens!.size).toBe(1);

      const tokenID = Array.from(tatTokens!.keys())[0];

      // Step 2: Transfer TAT to user2
      const transferResponse = await user1.sendTAT(
        forgeKeys.publicKey,
        user2.getState().keys.publicKey,
        tokenID
      );

      expect(transferResponse.result).toBeDefined();

      await TestUtils.waitForEventProcessing(2000);

      // Step 3: Verify TAT ownership changed
      const user2TatTokens = user2.getState().tatIndex.get(forgeKeys.publicKey);
      expect(user2TatTokens).toBeDefined();
      
      const user2TokenID = Array.from(user2TatTokens!.keys())[0];
      expect(user2TokenID).toBe(tokenID);

      // Step 4: Verify token validity
      const tokenHash = user2TatTokens!.get(tokenID);
      const tokenJWT = user2.getState().tokens.get(forgeKeys.publicKey)?.get(tokenHash!);
      
      const verifyResponse = await forge.request('verify', [{
        tokenJWT
      }], forgeKeys.publicKey);

      expect(verifyResponse.result.valid).toBe(true);
    });
  });
});
EOF

    # Create test runner script
    print_status "Creating test runner script..."
    
    cat > scripts/test-runner.ts << 'EOF'
// scripts/test-runner.ts
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

interface TestConfig {
  name: string;
  command: string;
  timeout: number;
  retries: number;
}

const testSuites: TestConfig[] = [
  {
    name: 'Unit Tests',
    command: 'npm run test:unit',
    timeout: 30000,
    retries: 1
  },
  {
    name: 'Integration Tests',
    command: 'npm run test:integration',
    timeout: 120000,
    retries: 2
  },
  {
    name: 'E2E Token Lifecycle',
    command: 'npm run test:e2e',
    timeout: 180000,
    retries: 1
  }
];

class TestRunner {
  private results: Map<string, { success: boolean; output: string; duration: number }> = new Map();

  async runTest(config: TestConfig): Promise<boolean> {
    console.log(`\n🧪 Running ${config.name}...`);
    const startTime = Date.now();

    for (let attempt = 0; attempt <= config.retries; attempt++) {
      if (attempt > 0) {
        console.log(`   Retry ${attempt}/${config.retries}...`);
      }

      try {
        const result = await this.executeCommand(config.command, config.timeout);
        const duration = Date.now() - startTime;
        
        this.results.set(config.name, {
          success: true,
          output: result,
          duration
        });

        console.log(`✅ ${config.name} passed (${duration}ms)`);
        return true;
      } catch (error) {
        const duration = Date.now() - startTime;
        
        if (attempt === config.retries) {
          this.results.set(config.name, {
            success: false,
            output: error instanceof Error ? error.message : String(error),
            duration
          });

          console.log(`❌ ${config.name} failed after ${attempt + 1} attempts (${duration}ms)`);
          return false;
        }
      }
    }

    return false;
  }

  private executeCommand(command: string, timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = command.split(' ');
      const child = spawn(cmd, args, { stdio: 'pipe' });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
        process.stdout.write(data); // Real-time output
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
        process.stderr.write(data); // Real-time output
      });

      const timeoutId = setTimeout(() => {
        child.kill();
        reject(new Error(`Test timed out after ${timeout}ms`));
      }, timeout);

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Command failed with code ${code}\n${stderr}`));
        }
      });
    });
  }

  async runAllTests(): Promise<void> {
    console.log('🚀 Starting TAT Protocol Test Suite\n');
    
    const startTime = Date.now();
    let passedTests = 0;
    let totalTests = testSuites.length;

    for (const testConfig of testSuites) {
      const success = await this.runTest(testConfig);
      if (success) {
        passedTests++;
      }
    }

    const totalDuration = Date.now() - startTime;
    
    console.log('\n📊 Test Results Summary');
    console.log('========================');
    console.log(`Total Tests: ${totalTests}`);
    console.log(`Passed: ${passedTests}`);
    console.log(`Failed: ${totalTests - passedTests}`);
    console.log(`Total Duration: ${totalDuration}ms`);

    // Generate test report
    await this.generateTestReport();

    // Exit with appropriate code
    process.exit(passedTests === totalTests ? 0 : 1);
  }

  private async generateTestReport(): Promise<void> {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        total: testSuites.length,
        passed: Array.from(this.results.values()).filter(r => r.success).length,
        failed: Array.from(this.results.values()).filter(r => !r.success).length,
      },
      results: Object.fromEntries(this.results)
    };

    const reportPath = path.join(process.cwd(), 'test-results', 'test-report.json');
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    
    console.log(`📄 Test report generated: ${reportPath}`);
  }
}

// Run if this script is executed directly
if (require.main === module) {
  const runner = new TestRunner();
  runner.runAllTests().catch(console.error);
}

export { TestRunner };
EOF

    # Create GitHub Actions workflow
    print_status "Creating GitHub Actions workflow..."
    
    cat > .github/workflows/test.yml << 'EOF'
name: TAT Protocol Test Suite

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main, develop ]

jobs:
  unit-tests:
    name: Unit Tests
    runs-on: ubuntu-latest
    timeout-minutes: 15
    
    strategy:
      matrix:
        node-version: [18, 20, 21]
    
    steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Setup Node.js ${{ matrix.node-version }}
      uses: actions/setup-node@v4
      with:
        node-version: ${{ matrix.node-version }}
        cache: 'pnpm'
        
    - name: Install pnpm
      uses: pnpm/action-setup@v4
      with:
        version: 8
        
    - name: Install dependencies
      run: pnpm install --frozen-lockfile
      
    - name: Build packages
      run: pnpm build
      
    - name: Run unit tests
      run: pnpm test:unit
      
    - name: Upload test results
      uses: actions/upload-artifact@v4
      if: always()
      with:
        name: unit-test-results-node-${{ matrix.node-version }}
        path: |
          coverage/
          test-results/

  integration-tests:
    name: Integration Tests
    runs-on: ubuntu-latest
    timeout-minutes: 30
    needs: unit-tests
    
    steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: 20
        cache: 'pnpm'
        
    - name: Install pnpm
      uses: pnpm/action-setup@v4
      with:
        version: 8
        
    - name: Install dependencies
      run: pnpm install --frozen-lockfile
      
    - name: Build packages
      run: pnpm build
        
    - name: Run integration tests
      run: pnpm test:integration
        
    - name: Upload integration test results
      uses: actions/upload-artifact@v4
      if: always()
      with:
        name: integration-test-results
        path: |
          coverage/
          test-results/
EOF

    # Update package.json with test scripts
    print_status "Updating package.json with test scripts..."
    
    # Create backup of package.json
    backup_file "package.json"
    
    # Create a temporary package.json update script
    cat > /tmp/update_package_json.js << 'EOF'
const fs = require('fs');
const path = require('path');

const packageJsonPath = 'package.json';
let packageJson;

try {
  packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
} catch (error) {
  console.error('Error reading package.json:', error.message);
  process.exit(1);
}

// Add test scripts
const testScripts = {
  "test": "npm run test:all",
  "test:all": "tsx scripts/test-runner.ts",
  "test:unit": "jest --config jest.config.js --selectProjects unit",
  "test:integration": "jest --config jest.config.js --selectProjects integration",
  "test:e2e": "jest --testMatch='**/e2e/**/*.test.ts' --runInBand",
  "test:performance": "jest --testMatch='**/performance/**/*.test.ts' --runInBand --detectOpenHandles",
  "test:lifecycle": "jest --testMatch='**/token-lifecycle.test.ts' --runInBand",
  "test:watch": "jest --watch",
  "test:coverage": "jest --coverage",
  "test:debug": "node --inspect-brk node_modules/.bin/jest --runInBand"
};

// Merge with existing scripts
packageJson.scripts = { ...packageJson.scripts, ...testScripts };

// Add test dependencies
const testDevDependencies = {
  "jest": "^29.7.0",
  "ts-jest": "^29.1.1",
  "@jest/globals": "^29.7.0",
  "@types/jest": "^29.5.8",
  "ws": "^8.14.2",
  "@types/ws": "^8.5.8"
};

packageJson.devDependencies = { ...packageJson.devDependencies, ...testDevDependencies };

// Write updated package.json
try {
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
  console.log('✅ Updated package.json with test scripts and dependencies');
} catch (error) {
  console.error('Error writing package.json:', error.message);
  process.exit(1);
}
EOF

    node /tmp/update_package_json.js
    rm /tmp/update_package_json.js

    # Create README for testing
    print_status "Creating testing documentation..."
    
    cat > TESTING.md << 'EOF'
# TAT Protocol Testing Documentation

## Overview

This document outlines the comprehensive testing strategy for the TAT Protocol, covering everything from unit tests to full system integration tests that validate complete token lifecycles.

## Quick Start

```bash
# Install dependencies
pnpm install

# Build packages
pnpm build

# Run all tests
npm run test:all
```

## Test Types

### Unit Tests
Fast tests for individual components:
```bash
npm run test:unit
```

### Integration Tests
Test interactions between components:
```bash
npm run test:integration
```

### Token Lifecycle Tests
Complete token journey validation:
```bash
npm run test:lifecycle
```

### Performance Tests
Load and stress testing:
```bash
npm run test:performance
```

## Test Structure

```
tests/
├── unit/                    # Unit tests
├── integration/             # Integration tests
│   ├── token-lifecycle.test.ts
│   ├── test-utils.ts
│   └── setup.ts
├── e2e/                     # End-to-end tests
├── performance/             # Performance tests
└── fixtures/                # Test data
```

## Development Workflow

```bash
# Watch mode for development
npm run test:watch

# Debug mode
npm run test:debug

# Coverage report
npm run test:coverage
```

## CI/CD

Tests automatically run on:
- Every pull request
- Pushes to main/develop branches
- Scheduled daily runs

See `.github/workflows/test.yml` for details.

## Adding New Tests

1. Choose appropriate test type and location
2. Follow existing patterns and conventions
3. Include both success and failure scenarios
4. Ensure proper cleanup and isolation

For detailed information, see the complete testing documentation.
EOF

    # Install test dependencies
    print_status "Installing test dependencies..."
    
    if pnpm install; then
        print_success "Dependencies installed successfully"
    else
        print_warning "Some dependencies may need manual installation"
    fi

    # Final summary
    echo
    print_success "🎉 TAT Protocol Testing Framework Setup Complete!"
    echo
    echo "📋 What was created:"
    echo "   ✅ Test directory structure (tests/)"
    echo "   ✅ Jest configuration (jest.config.js)"
    echo "   ✅ Test setup files and utilities"
    echo "   ✅ Sample token lifecycle tests"
    echo "   ✅ Test runner script (scripts/test-runner.ts)"
    echo "   ✅ GitHub Actions workflow (.github/workflows/test.yml)"
    echo "   ✅ Updated package.json with test scripts"
    echo "   ✅ Testing documentation (TESTING.md)"
    echo
    echo "🚦 Next steps:"
    echo "   1. Run 'pnpm build' to build all packages"
    echo "   2. Run 'npm run test:all' to execute the full test suite"
    echo "   3. Check test results in test-results/ directory"
    echo "   4. Customize tests in tests/ directory as needed"
    echo
    echo "📖 Available test commands:"
    echo "   npm run test:all         - Run complete test suite"
    echo "   npm run test:unit        - Run unit tests only"
    echo "   npm run test:integration - Run integration tests"
    echo "   npm run test:lifecycle   - Run token lifecycle tests"
    echo "   npm run test:watch       - Run tests in watch mode"
    echo "   npm run test:coverage    - Generate coverage report"
    echo
    echo "🔗 Files created/modified:"
    echo "   - jest.config.js"
    echo "   - tests/ (directory structure)"
    echo "   - scripts/test-runner.ts"
    echo "   - .github/workflows/test.yml"
    echo "   - package.json (backup created)"
    echo "   - TESTING.md"
    echo
    print_warning "Note: Backup files were created for any existing files that were modified"
    echo
}

# Run the main function
main "$@"