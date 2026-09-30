module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  testTimeout: 30000,
  // Agent worktrees live under .claude/; without this jest sees every package twice.
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/.claude/'],
  verbose: true,
  moduleNameMapper: {
    '^@tat-protocol/nwpc$': '<rootDir>/tests/mocks/nwpc.ts',
    '^@tat-protocol/token$': '<rootDir>/tests/mocks/token.ts',
    '^@tat-protocol/config$': '<rootDir>/packages/config/defaultConfig.ts',
    '^@tat-protocol/([^/]+)$': '<rootDir>/packages/$1/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1'
  }
};
