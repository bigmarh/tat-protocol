#!/bin/bash

# Cleanup test artifacts and temporary files

echo "🧹 Cleaning up test artifacts..."

# Remove test results
if [ -d "test-results" ]; then
    rm -rf test-results/
    echo "✅ Removed test-results/"
fi

# Remove coverage reports
if [ -d "coverage" ]; then
    rm -rf coverage/
    echo "✅ Removed coverage/"
fi

# Remove Jest cache
if [ -d ".jest" ]; then
    rm -rf .jest/
    echo "✅ Removed Jest cache"
fi

# Remove temporary test files
find . -name "*.test.log" -delete 2>/dev/null
find . -name "test-*.tmp" -delete 2>/dev/null

echo "✅ Test cleanup complete!"
