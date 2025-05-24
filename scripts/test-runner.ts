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
    timeout: 60000,
    retries: 1
  },
  {
    name: 'E2E Tests',
    command: 'npm run test:e2e',
    timeout: 90000,
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

          console.log(`❌ ${config.name} failed (${duration}ms)`);
          console.log(`   Error: ${error instanceof Error ? error.message : String(error)}`);
          return false;
        }
      }
    }

    return false;
  }

  private executeCommand(command: string, timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = command.split(' ');
      const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        process.stdout.write(output);
      });

      child.stderr?.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        process.stderr.write(output);
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
          reject(new Error(`Command failed with code ${code}`));
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  async runAllTests(): Promise<void> {
    console.log('🚀 Starting TAT Protocol Test Suite (Fixed Version)\n');
    
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

    if (passedTests === totalTests) {
      console.log('\n🎉 All tests passed!');
      process.exit(0);
    } else {
      console.log('\n❌ Some tests failed');
      process.exit(1);
    }
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
    
    console.log(`📄 Test report: ${reportPath}`);
  }
}

// Run if executed directly
if (require.main === module) {
  const runner = new TestRunner();
  runner.runAllTests().catch(console.error);
}

export { TestRunner };
