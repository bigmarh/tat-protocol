#!/bin/bash

# Additional setup scripts to complement the main setup

# Create a script to quickly run specific test scenarios
cat > scripts/run-scenario.sh << 'EOF'
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
EOF

chmod +x scripts/run-scenario.sh

# Create a script to check test prerequisites
cat > scripts/check-test-prereqs.sh << 'EOF'
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
EOF

chmod +x scripts/check-test-prereqs.sh

# Create a test cleanup script
cat > scripts/cleanup-tests.sh << 'EOF'
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
EOF

chmod +x scripts/cleanup-tests.sh

# Create a script to generate test report
cat > scripts/generate-report.sh << 'EOF'
#!/bin/bash

# Generate comprehensive test report

echo "📊 Generating TAT Protocol Test Report..."

REPORT_DIR="test-results/reports"
mkdir -p "$REPORT_DIR"

TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
REPORT_FILE="$REPORT_DIR/test-report-$TIMESTAMP.html"

# Run tests with coverage
echo "Running tests with coverage..."
npm run test:coverage -- --ci --json --outputFile="$REPORT_DIR/test-results.json" 2>/dev/null || true

# Generate HTML report
cat > "$REPORT_FILE" << 'HTML_EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TAT Protocol Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .header { background: #2196F3; color: white; padding: 20px; border-radius: 8px; }
        .section { margin: 20px 0; padding: 20px; border: 1px solid #ddd; border-radius: 8px; }
        .success { background: #4CAF50; color: white; }
        .warning { background: #FF9800; color: white; }
        .error { background: #f44336; color: white; }
        .metric { display: inline-block; margin: 10px; padding: 10px; background: #f5f5f5; border-radius: 4px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🧪 TAT Protocol Test Report</h1>
        <p>Generated on: $(date)</p>
    </div>
    
    <div class="section">
        <h2>📋 Test Summary</h2>
        <div class="metric">
            <strong>Total Suites:</strong> Integration, Unit, E2E, Performance
        </div>
        <div class="metric">
            <strong>Test Framework:</strong> Jest + TypeScript
        </div>
        <div class="metric">
            <strong>Environment:</strong> Node.js $(node --version)
        </div>
    </div>
    
    <div class="section">
        <h2>🎯 Test Categories</h2>
        <table>
            <tr>
                <th>Category</th>
                <th>Description</th>
                <th>Command</th>
            </tr>
            <tr>
                <td>Token Lifecycle</td>
                <td>Complete token journey validation</td>
                <td>npm run test:lifecycle</td>
            </tr>
            <tr>
                <td>Integration</td>
                <td>Component interaction testing</td>
                <td>npm run test:integration</td>
            </tr>
            <tr>
                <td>Performance</td>
                <td>Load and stress testing</td>
                <td>npm run test:performance</td>
            </tr>
            <tr>
                <td>End-to-End</td>
                <td>Real-world scenario testing</td>
                <td>npm run test:e2e</td>
            </tr>
        </table>
    </div>
    
    <div class="section">
        <h2>🔧 Test Infrastructure</h2>
        <ul>
            <li>Mock Nostr Relay for isolated testing</li>
            <li>Automated CI/CD with GitHub Actions</li>
            <li>Performance benchmarking</li>
            <li>Security testing</li>
            <li>Coverage reporting</li>
        </ul>
    </div>
    
    <div class="section">
        <h2>📈 Coverage Information</h2>
        <p>Coverage reports are available in the <code>coverage/</code> directory after running <code>npm run test:coverage</code></p>
    </div>
    
    <div class="section">
        <h2>🚀 Quick Start</h2>
        <pre>
# Install dependencies
pnpm install

# Build packages  
pnpm build

# Run all tests
npm run test:all

# Run specific test category
npm run test:lifecycle
        </pre>
    </div>
</body>
</html>
HTML_EOF

echo "✅ Test report generated: $REPORT_FILE"
echo "📖 Open in browser to view detailed information"

# Also create a simple text summary
SUMMARY_FILE="$REPORT_DIR/test-summary-$TIMESTAMP.txt"
cat > "$SUMMARY_FILE" << 'TXT_EOF'
TAT Protocol Test Report Summary
================================

Generated: $(date)
Node.js Version: $(node --version)
pnpm Version: $(pnpm --version)

Test Categories:
- Token Lifecycle Tests: Complete token journey validation
- Integration Tests: Component interaction testing  
- Performance Tests: Load and stress testing
- End-to-End Tests: Real-world scenario testing

Quick Commands:
- npm run test:all         # Run all tests
- npm run test:lifecycle   # Token lifecycle only
- npm run test:integration # Integration tests only
- npm run test:performance # Performance tests only
- npm run test:coverage    # Generate coverage report

Files Structure:
- tests/integration/       # Integration test files
- tests/e2e/              # End-to-end scenarios
- tests/performance/      # Performance tests
- scripts/                # Test utility scripts
- .github/workflows/      # CI/CD configuration

For detailed results, check:
- coverage/ directory for coverage reports
- test-results/ directory for test artifacts
TXT_EOF

echo "✅ Summary report: $SUMMARY_FILE"
EOF

chmod +x scripts/generate-report.sh

# Create VS Code settings for better test development experience
mkdir -p .vscode
cat > .vscode/settings.json << 'EOF'
{
  "typescript.preferences.includePackageJsonAutoImports": "auto",
  "jest.jestCommandLine": "npm run test:unit",
  "jest.autoRun": {
    "watch": false,
    "onStartup": ["all-tests"]
  },
  "files.associations": {
    "*.test.ts": "typescript"
  },
  "editor.rulers": [80, 120],
  "editor.tabSize": 2,
  "search.exclude": {
    "**/node_modules": true,
    "**/coverage": true,
    "**/dist": true,
    "**/test-results": true
  },
  "files.exclude": {
    "**/coverage": true,
    "**/test-results": true
  }
}
EOF

# Create launch configuration for debugging tests
cat > .vscode/launch.json << 'EOF'
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Jest Tests",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/node_modules/.bin/jest",
      "args": [
        "--runInBand",
        "--no-cache",
        "--testNamePattern=${input:testName}"
      ],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen",
      "disableOptimisticBPs": true,
      "windows": {
        "program": "${workspaceFolder}/node_modules/jest/bin/jest"
      }
    },
    {
      "name": "Debug Token Lifecycle Tests",
      "type": "node", 
      "request": "launch",
      "program": "${workspaceFolder}/node_modules/.bin/jest",
      "args": [
        "--runInBand",
        "--testMatch=**/token-lifecycle.test.ts"
      ],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    }
  ],
  "inputs": [
    {
      "id": "testName",
      "description": "Test name pattern",
      "default": "",
      "type": "promptString"
    }
  ]
}
EOF

echo "✅ Created additional helper scripts:"
echo "   - scripts/run-scenario.sh (quick test scenario runner)"
echo "   - scripts/check-test-prereqs.sh (prerequisite checker)"  
echo "   - scripts/cleanup-tests.sh (cleanup test artifacts)"
echo "   - scripts/generate-report.sh (test report generator)"
echo "   - .vscode/ configuration for VS Code users"