#!/bin/bash

# Quick script to run specific test scenarios

SCENARIO="$1"

if [ -z "$SCENARIO" ]; then
    echo "Usage: ./scripts/run-scenario.sh <scenario>"
    echo ""
    echo "Available scenarios:"
    echo "  lifecycle    - Token lifecycle tests"
    echo "  integration  - Integration tests"
    echo "  performance  - Performance tests"
    echo "  e2e          - End-to-end scenarios"
    echo "  all          - All tests"
    exit 1
fi

case "$SCENARIO" in
    "lifecycle")
        echo "🔄 Running token lifecycle tests..."
        npm run test:lifecycle
        ;;
    "integration")
        echo "🔗 Running integration tests..."
        npm run test:integration
        ;;
    "performance")
        echo "⚡ Running performance tests..."
        npm run test:performance
        ;;
    "e2e")
        echo "🎭 Running end-to-end tests..."
        npm run test:e2e
        ;;
    "all")
        echo "🚀 Running all tests..."
        npm run test:all
        ;;
    *)
        echo "❌ Unknown scenario: $SCENARIO"
        exit 1
        ;;
esac
