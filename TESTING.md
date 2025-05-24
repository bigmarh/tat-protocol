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
