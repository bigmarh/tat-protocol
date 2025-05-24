#!/bin/bash

# Check test prerequisites script

echo "🔍 Checking TAT Protocol Test Prerequisites..."
echo

# Check Node.js
if command -v node >/dev/null 2>&1; then
    NODE_VERSION=$(node --version)
    echo "✅ Node.js: $NODE_VERSION"
else
    echo "❌ Node.js: Not installed"
    exit 1
fi

# Check pnpm
if command -v pnpm >/dev/null 2>&1; then
    PNPM_VERSION=$(pnpm --version)
    echo "✅ pnpm: $PNPM_VERSION"
else
    echo "❌ pnpm: Not installed"
    echo "   Install with: npm install -g pnpm"
    exit 1
fi

# Check if packages are built
if [ -d "dist" ] || [ -d "*/dist" ]; then
    echo "✅ Packages: Built"
else
    echo "⚠️  Packages: Not built (run 'pnpm build')"
fi

# Check test directories
if [ -d "tests" ]; then
    echo "✅ Test structure: Present"
else
    echo "❌ Test structure: Missing (run setup script)"
    exit 1
fi

# Check Jest config
if [ -f "jest.config.js" ]; then
    echo "✅ Jest config: Present"
else
    echo "❌ Jest config: Missing"
    exit 1
fi

# Check if dependencies are installed
if [ -d "node_modules" ]; then
    echo "✅ Dependencies: Installed"
else
    echo "❌ Dependencies: Not installed (run 'pnpm install')"
    exit 1
fi

echo
echo "🎉 Prerequisites check complete!"
echo "Ready to run tests with: npm run test:all"
