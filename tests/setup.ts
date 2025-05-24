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
