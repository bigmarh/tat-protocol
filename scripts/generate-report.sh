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
