/**
 * Generic Test Orchestrator Utility
 * Provides flexible conditional test execution where tests run only if specified dependencies pass
 * 
 * Features:
 * - Accept array of test case names as dependencies
 * - Only run if ALL specified dependencies have passed
 * - Support for custom run conditions
 * - Integration with existing dependency manager
 * - Flexible fixture support (shared page or individual page)
 * - Comprehensive logging and error handling
 */

import { test } from '@/framework/core/test-fixtures';
import { dependencyManager } from '@/framework/core/dependency-manager';
import { TestExecutionResult, TestMetadata } from '@/types';
import { sharedBrowserManager } from '@/framework/core/shared-browser-manager';
import { resetStepTracker, getStepTracker } from './step-tracker';
import fs from 'fs';
import path from 'path';

export interface TestDependency {
  testName: string;
  required?: boolean; // Default: true - if false, test can run even if this dependency failed
}

export interface OrchestratedTestConfig {
  name: string;
  dependencies?: (string | TestDependency)[]; // Array of test names (strings) or dependency objects with required flag
  metadata?: TestMetadata;
  runRegardless?: boolean; // If true, ignores all dependencies and always runs
  customCondition?: (results: Map<string, TestExecutionResult>) => { shouldRun: boolean; reason?: string };
  testFunction: (fixtures: any) => Promise<void> | void;
  timeout?: number; // Custom timeout for this test
  retries?: number; // Number of retries for this test
}

export interface OrchestratorOptions {
  useSharedPage?: boolean; // Default: true
  sequential?: boolean; // Default: true - run tests in sequence
  continueOnFailure?: boolean; // Default: false - stop suite if a test fails
  logLevel?: 'minimal' | 'detailed' | 'verbose'; // Default: 'detailed'
  suiteName?: string; // Optional suite name for grouping
}


export class TestOrchestrator {
  private suiteResults = new Map<string, TestExecutionResult>();
  private options: Required<OrchestratorOptions>;

  constructor(options: OrchestratorOptions = {}) {
    this.options = {
      useSharedPage: true,
      sequential: true,
      continueOnFailure: false,
      logLevel: 'detailed',
      suiteName: 'Orchestrated Test Suite',
      ...options
    };
  }

  /**
   * Create an orchestrated test suite with conditional execution
   */
  createSuite(suiteName: string, tests: OrchestratedTestConfig[], options?: Partial<OrchestratorOptions>): void {
    const suiteOptions = { ...this.options, ...options };

    // Configure execution mode based on options
    // IMPORTANT: We need serial mode for dependencies to work correctly
    // In continueOnFailure mode, our error handling prevents suite from stopping
    if (suiteOptions.sequential) {
      test.describe.configure({ mode: 'serial' });
    }

    test.describe(suiteName, () => {
      this.log(` Starting orchestrated test suite: "${suiteName}"`, 'detailed');
      this.log(` Suite contains ${tests.length} tests with conditional execution`, 'detailed');

      // Pre-register all tests in suiteResults so they appear in reports even if not executed
      // This is critical for accurate reporting when tests don't run due to worker termination (timeouts in serial mode)
      tests.forEach((testConfig) => {
        this.suiteResults.set(testConfig.name, {
          testName: testConfig.name,
          fullTitle: testConfig.name,
          status: 'skipped',
          reason: 'Test did not execute (suite stopped early)',
          duration: 0,
          priority: testConfig.metadata?.priority,
          dependencies: this.extractDependencyNames(testConfig.dependencies),
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString()
        });
      });

      // Set global flag for shared page fixture to know about continueOnFailure mode
      (globalThis as any).__ORCHESTRATOR_CONTINUE_ON_FAILURE__ = suiteOptions.continueOnFailure;

      tests.forEach((testConfig) => {
        this.createOrchestratedTest(testConfig, suiteOptions);
      });

      // Add a final test to log the summary
      test(' Test Suite Summary', async () => {
        const summary = this.getSummary();
        this.log(`\n Test Execution Summary:`, 'minimal');
        this.log(`   Total: ${summary.total}`, 'minimal');
        this.log(`    Passed: ${summary.passed}`, 'minimal');
        this.log(`    Failed: ${summary.failed}`, 'minimal');
        this.log(`   ⏭ Skipped: ${summary.skipped}`, 'minimal');
        this.log(`   📈 Pass Rate: ${summary.passRate.toFixed(1)}%`, 'minimal');

        // Save orchestrator results to JSON file for the custom reporter
        if (suiteOptions.continueOnFailure) {
          try {
            const resultsDir = path.join(process.cwd(), 'reports');
            if (!fs.existsSync(resultsDir)) {
              fs.mkdirSync(resultsDir, { recursive: true });
            }

            const resultsFile = path.join(resultsDir, 'orchestrator-results.json');
            const resultsObj = Object.fromEntries(this.suiteResults.entries());
            fs.writeFileSync(resultsFile, JSON.stringify(resultsObj, null, 2));
            this.log(`💾 Orchestrator results saved to: ${resultsFile}`, 'detailed');
          } catch (error) {
            console.error('Failed to save orchestrator results:', error);
          }
        }

        // Clean up global flag and restore page close functionality
        if (suiteOptions.continueOnFailure) {
          sharedBrowserManager.restorePageCloseFunctionality();
        }
        delete (globalThis as any).__ORCHESTRATOR_CONTINUE_ON_FAILURE__;
      });
    });
  }

  /**
   * Create a single orchestrated test
   */
  private createOrchestratedTest(testConfig: OrchestratedTestConfig, suiteOptions: Required<OrchestratorOptions>): void {
    const testName = testConfig.name;

    // Register test with dependency manager if metadata provided
    if (testConfig.metadata) {
      dependencyManager.registerTest(testName, testConfig.metadata);
    }

    // Configure test timeout and retries
    const testOptions: any = {};
    if (testConfig.timeout) testOptions.timeout = testConfig.timeout;

    // Create the test with proper failure reporting and browser protection
    if (suiteOptions.useSharedPage) {
      test(testName, testOptions, async ({ sharedPage }, testInfo) => {
        if (suiteOptions.continueOnFailure) {
          // In continueOnFailure mode, handle failures but preserve browser session
          try {
            await this.executeTest(testConfig, { sharedPage }, suiteOptions, testInfo);
          } catch (error: any) {
            // Re-throw if it's a skip error - these must propagate to Playwright
            if (error && error.toString && error.toString().includes('Test is skipped')) {
              throw error;
            }

            // Take screenshot manually BEFORE marking test as failed
            // Check if error already has a screenshot path from API validation
            let screenshotPath: string | undefined;
            const screenshotPaths: string[] = [];
            
            if (error && typeof error === 'object' && 'screenshotPath' in error) {
              screenshotPath = (error as any).screenshotPath;
              console.log(` Using screenshot from API validation: ${screenshotPath}`);
            } else {
              // Check if this is a multi-user test with both contexts
              const multiUserInstance = (globalThis as any).__MULTI_USER_CHAT_INSTANCE__;
              
              if (multiUserInstance && typeof multiUserInstance.captureFailureScreenshots === 'function') {
                // Multi-user test - capture from both contexts
                console.log(` Detected multi-user test - capturing screenshots from both contexts`);
                try {
                  const paths = await multiUserInstance.captureFailureScreenshots(testName);
                  screenshotPaths.push(...paths);
                  
                  // Attach all screenshots to Playwright test
                  for (const imgPath of paths) {
                    await testInfo.attach(path.basename(imgPath), {
                      path: imgPath,
                      contentType: 'image/png'
                    });
                    console.log(` Attached screenshot: ${imgPath}`);
                  }
                  
                  // Use first screenshot as primary
                  if (paths.length > 0) {
                    screenshotPath = paths[0];
                  }
                } catch (multiUserError) {
                  console.error('Failed to capture multi-user screenshots:', multiUserError);
                  // Fall back to single screenshot
                }
              }
              
              // Single page screenshot (or fallback)
              if (!screenshotPath) {
                screenshotPath = testInfo.outputPath(`failure-${Date.now()}.png`);
                try {
                  // Check if page is still open before taking screenshot
                  const pageOpen = sharedPage?.page && !sharedPage.page.isClosed();
                  if (pageOpen) {
                    // Add timeout to screenshot capture (5 seconds) to handle unresponsive pages
                    await Promise.race([
                      sharedPage.page.screenshot({ path: screenshotPath, fullPage: true }),
                      new Promise((_, reject) => setTimeout(() => reject(new Error('Screenshot timeout')), 5000))
                    ]).catch((screenshotError) => {
                      console.warn(`  Screenshot capture failed (page may be unresponsive): ${screenshotError.message}`);
                      // Try a simple screenshot without fullPage option
                      return sharedPage.page.screenshot({ path: screenshotPath, timeout: 3000 });
                    });
                    console.log(` Screenshot captured: ${screenshotPath}`);
                  } else {
                    console.log(`  Page closed - screenshot not available`);
                    screenshotPath = undefined;
                  }
                } catch (screenshotError) {
                  console.error('Failed to capture screenshot:', screenshotError);
                  screenshotPath = undefined;
                }
              }
            }

            // Update the result with screenshot path for the reporter
            if (screenshotPath) {
              const result = this.suiteResults.get(testName);
              if (result) {
                result.screenshotPath = screenshotPath;
                this.suiteResults.set(testName, result);
              }
            }

            // Mark test as failed using soft assertion approach
            // This marks the test as failed WITHOUT throwing an error (keeping browser alive)
            const errorMessage = error instanceof Error ? error.message : String(error);
            testInfo.annotations.push({
              type: 'orchestrator-failed',
              description: errorMessage
            });

            // Force test to fail by setting error in testInfo
            // This doesn't close the browser but marks test as failed in reports
            if (!testInfo.errors || testInfo.errors.length === 0) {
              testInfo.errors = [];
            }
            testInfo.errors.push({
              message: errorMessage,
              stack: error instanceof Error ? error.stack : undefined,
              value: error
            });
          }
        } else {
          // Normal mode: let errors propagate to fail the test and stop suite
          await this.executeTest(testConfig, { sharedPage }, suiteOptions, testInfo);
        }
      });
    } else {
      test(testName, testOptions, async ({ page }, testInfo) => {
        if (suiteOptions.continueOnFailure) {
          // In continueOnFailure mode, handle failures but preserve browser session
          try {
            await this.executeTest(testConfig, { page }, suiteOptions, testInfo);
          } catch (error: any) {
            // Re-throw if it's a skip error - these must propagate to Playwright
            if (error && error.toString && error.toString().includes('Test is skipped')) {
              throw error;
            }

            // Take screenshot manually
            // Check if error already has a screenshot path from API validation
            let screenshotPath: string | undefined;
            if (error && typeof error === 'object' && 'screenshotPath' in error) {
              screenshotPath = (error as any).screenshotPath;
              console.log(` Using screenshot from API validation: ${screenshotPath}`);
            } else {
              // Handle timeout failures by adding a timeout to screenshot capture
              screenshotPath = testInfo.outputPath(`failure-${Date.now()}.png`);
              try {
                // Check if page is still open before taking screenshot
                const pageOpen = page && !page.isClosed();
                if (pageOpen) {
                  // Add timeout to screenshot capture (5 seconds) to handle unresponsive pages
                  await Promise.race([
                    page.screenshot({ path: screenshotPath, fullPage: true }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Screenshot timeout')), 5000))
                  ]).catch((screenshotError) => {
                    console.warn(`  Screenshot capture failed (page may be unresponsive): ${screenshotError.message}`);
                    // Try a simple screenshot without fullPage option
                    return page.screenshot({ path: screenshotPath, timeout: 3000 });
                  });
                  console.log(` Screenshot captured: ${screenshotPath}`);
                } else {
                  console.log(`  Page closed - screenshot not available`);
                  screenshotPath = undefined;
                }
              } catch (screenshotError) {
                console.error('Failed to capture screenshot:', screenshotError);
                screenshotPath = undefined;
              }
            }

            // Update the result with screenshot path for the reporter
            if (screenshotPath) {
              const result = this.suiteResults.get(testName);
              if (result) {
                result.screenshotPath = screenshotPath;
                this.suiteResults.set(testName, result);
              }
            }

            // DON'T throw or use testInfo.fail() - both will close the browser
            // The custom reporter will fix the status in the HTML report
          }
        } else {
          // Normal mode: let errors propagate to fail the test and stop suite
          await this.executeTest(testConfig, { page }, suiteOptions, testInfo);
        }
      });
    }

    // Note: Retries are configured at the test level via testOptions if needed
  }

  /**
   * Execute a single test with dependency checking
   */
  private async executeTest(
    testConfig: OrchestratedTestConfig,
    fixtures: any,
    options: Required<OrchestratorOptions>,
    testInfo?: any
  ): Promise<void> {
    const testName = testConfig.name;
    const startTime = Date.now();
    const startTimeIso = new Date().toISOString();
    let testResult: TestExecutionResult;

    try {
      // Check if test should run based on dependencies
      const shouldRun = this.shouldRunTest(testConfig);

      if (!shouldRun.run) {
        this.log(`⏭  Skipping test "${testName}": ${shouldRun.reason}`, 'minimal');

        testResult = {
          testName,
          fullTitle: testName,
          status: 'skipped',
          reason: shouldRun.reason,
          duration: 0,
          priority: testConfig.metadata?.priority,
          dependencies: this.extractDependencyNames(testConfig.dependencies),
          startTime: startTimeIso,
          endTime: new Date().toISOString()
        };

        this.suiteResults.set(testName, testResult);
        dependencyManager.recordTestResult(testResult);

        // Save results to file immediately for the reporter to use
        this.saveResultsToFile();

        test.skip(true, shouldRun.reason);
        return;
      }

      this.log(` Executing orchestrated test: "${testName}"`, 'detailed');
      this.logDependencies(testConfig, 'verbose');

      // Reset step tracker for this test
      const stepTracker = resetStepTracker();

      // Execute the actual test function with step tracking available
      await testConfig.testFunction({ ...fixtures, step: stepTracker });

      // Test passed - Use Playwright's testInfo directly
      const duration = Date.now() - startTime;
      const endTimeIso = new Date().toISOString();

      // ✨ Extract ALL data from Playwright's testInfo
      const testInfoData = this.extractTestInfoData(testInfo, startTime);

      testResult = {
        testName,
        fullTitle: testName,
        status: 'passed', // ← Playwright's status is correct for passed tests
        duration,
        priority: testConfig.metadata?.priority,
        dependencies: this.extractDependencyNames(testConfig.dependencies),
        startTime: startTimeIso,
        endTime: endTimeIso,

        // ✨ Use Playwright's data directly
        ...testInfoData
      };

      this.log(` Test "${testName}" passed (${duration}ms)`, 'minimal');

    } catch (error) {
      // Re-throw skip errors immediately - they're not failures
      const errorString = error instanceof Error ? error.message : String(error);
      if (errorString.includes('Test is skipped')) {
        throw error;
      }

      // Test failed - Use Playwright's testInfo BUT override status
      const duration = Date.now() - startTime;
      const endTimeIso = new Date().toISOString();
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      // Extract error location if available
      let errorLocation;
      if (errorStack) {
        const locationMatch = errorStack.match(/at\s+.*?\s+\((.+?):(\d+):(\d+)\)/);
        if (locationMatch) {
          errorLocation = {
            file: locationMatch[1],
            line: parseInt(locationMatch[2]),
            column: parseInt(locationMatch[3])
          };
        }
      }

      // ✨ Extract ALL data from Playwright's testInfo
      const testInfoData = this.extractTestInfoData(testInfo, startTime);

      testResult = {
        testName,
        fullTitle: testName,
        status: 'failed', // ← Override: Playwright would say "passed" but we know it failed!
        duration,
        error: errorMessage,
        priority: testConfig.metadata?.priority,
        dependencies: this.extractDependencyNames(testConfig.dependencies),
        startTime: startTimeIso,
        endTime: endTimeIso,

        // ✨ Use Playwright's data directly
        ...testInfoData,

        // Error details
        errorDetails: {
          message: errorMessage,
          stack: errorStack,
          location: errorLocation
        }
      };

      this.log(` Test "${testName}" failed (${duration}ms): ${errorMessage}`, 'minimal');

      // Store result before potentially re-throwing
      this.suiteResults.set(testName, testResult);
      dependencyManager.recordTestResult(testResult);

      // Save results to file immediately for the reporter to use
      this.saveResultsToFile();

      // Always throw error for proper Playwright failure reporting (screenshots, traces)
      // In continueOnFailure mode, the error will be caught at the test wrapper level
      this.log(` Test failed but suite will continue execution`, 'detailed');
      throw error;
    }

    // Store successful result (only reached if no exception was thrown)
    this.suiteResults.set(testName, testResult);
    dependencyManager.recordTestResult(testResult);

    // Save results to file immediately for the reporter to use
    this.saveResultsToFile();
  }

  /**
   * Save orchestrator results to file for the reporter to use
   */
  private saveResultsToFile(): void {
    try {
      const resultsDir = path.join(process.cwd(), 'reports');
      if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir, { recursive: true });
      }

      // Use module-specific file name to avoid conflicts in parallel execution
      const moduleName = process.env.MODULE_NAME || 'default';
      const resultsFile = path.join(resultsDir, `orchestrator-results-${moduleName}.json`);
      const resultsObj = Object.fromEntries(this.suiteResults.entries());
      fs.writeFileSync(resultsFile, JSON.stringify(resultsObj, null, 2));
    } catch (error) {
      // Silently fail - don't disrupt test execution
      console.error('Failed to save orchestrator results:', error);
    }
  }

  /**
   * Determine if a test should run based on its dependencies and conditions
   */
  private shouldRunTest(testConfig: OrchestratedTestConfig): { run: boolean; reason?: string } {
    // If runRegardless is true, always run the test
    if (testConfig.runRegardless) {
      this.log(` Test "${testConfig.name}" set to run regardless of dependencies`, 'verbose');
      return { run: true };
    }

    // Check custom condition first
    if (testConfig.customCondition) {
      const customResult = testConfig.customCondition(this.suiteResults);
      if (!customResult.shouldRun) {
        return {
          run: false,
          reason: customResult.reason || 'Custom condition not met'
        };
      }
    }

    // Check dependencies
    if (testConfig.dependencies && testConfig.dependencies.length > 0) {
      const dependencyCheck = this.checkDependencies(testConfig.dependencies);
      if (!dependencyCheck.allPassed) {
        return {
          run: false,
          reason: `Dependencies not met: ${dependencyCheck.failedDependencies.join(', ')}`
        };
      }
    }

    return { run: true };
  }

  /**
   * Check if all required dependencies have passed
   */
  private checkDependencies(dependencies: (string | TestDependency)[]): {
    allPassed: boolean;
    failedDependencies: string[];
    passedDependencies: string[];
  } {
    const failedDependencies: string[] = [];
    const passedDependencies: string[] = [];

    for (const dep of dependencies) {
      const depName = typeof dep === 'string' ? dep : dep.testName;
      const isRequired = typeof dep === 'string' ? true : (dep.required !== false);
      
      const depResult = dependencyManager.getExecutionResults().get(depName) || this.suiteResults.get(depName);


      if (!depResult || depResult.status !== 'passed') {
        if (isRequired) {
          failedDependencies.push(depName);
        }
      } else {
        passedDependencies.push(depName);
      }
    }

    return {
      allPassed: failedDependencies.length === 0,
      failedDependencies,
      passedDependencies
    };
  }

  /**
   * Extract dependency names from mixed dependency format
   */
  private extractDependencyNames(dependencies?: (string | TestDependency)[]): string[] | undefined {
    if (!dependencies) return undefined;
    return dependencies.map(dep => typeof dep === 'string' ? dep : dep.testName);
  }

  /**
   * Log dependencies for a test
   */
  private logDependencies(testConfig: OrchestratedTestConfig, level: 'minimal' | 'detailed' | 'verbose'): void {
    if (!testConfig.dependencies || testConfig.dependencies.length === 0) return;
    
    const depNames = this.extractDependencyNames(testConfig.dependencies);
    this.log(` Dependencies for "${testConfig.name}": [${depNames?.join(', ')}]`, level);
  }

  /**
   * Extract ALL data from Playwright's testInfo object
   * This includes steps, attachments, errors, annotations, stdout, stderr, etc.
   */
  private extractTestInfoData(testInfo: any, startTime: number): Partial<TestExecutionResult> {
    if (!testInfo) {
      return {};
    }

    return {
      steps: this.extractAllSteps(testInfo),
      attachments: testInfo.attachments || [],
      errors: testInfo.errors || [],
      annotations: testInfo.annotations || [],
      tags: testInfo.tags || [],
      retry: testInfo.retry || 0,
      parallelIndex: testInfo.parallelIndex,
      workerIndex: testInfo.workerIndex,
      stdout: testInfo.stdout || [],
      stderr: testInfo.stderr || [],
    };
  }

  /**
   * Extract ALL steps including nested substeps from testInfo (RECURSIVE)
   * This captures Playwright's complete step hierarchy with nested substeps
   */
  private extractAllSteps(testInfo: any): Array<any> | undefined {
    if (!testInfo || !testInfo.steps) return undefined;

    const extractStepsRecursive = (steps: any[]): any[] => {
      const result: any[] = [];

      for (const step of steps) {
        // Skip framework hooks
        if (step.title?.startsWith('Before Hooks') ||
            step.title?.startsWith('After Hooks') ||
            step.title?.startsWith('fixture:')) {
          continue;
        }

        // Extract step data
        const stepData: any = {
          title: step.title,
          duration: step.duration || 0,
          category: step.category || 'test.step',
          startTime: step.startTime ? new Date(step.startTime).toISOString() : undefined,
        };

        // Add error if step failed
        if (step.error) {
          stepData.error = step.error.message || String(step.error);
          stepData.errorStack = step.error.stack;

          // Extract location from error stack if not in step.location
          if (!step.location && step.error.stack) {
            const location = this.extractLocationFromStack(step.error.stack);
            if (location) {
              stepData.location = location;
            }
          }
        }

        // Add location if available (Playwright includes this for some step types)
        if (step.location) {
          const file = step.location.file || '';
          const fileName = file.split('/').pop() || file; // Get just the filename
          stepData.location = `${fileName}:${step.location.line}`;
        }

        // ✨ RECURSIVELY EXTRACT NESTED SUBSTEPS
        if (step.steps && step.steps.length > 0) {
          stepData.steps = extractStepsRecursive(step.steps);
        }

        result.push(stepData);
      }

      return result;
    };

    return extractStepsRecursive(testInfo.steps);
  }

  /**
   * Extract file location from error stack trace
   */
  private extractLocationFromStack(stack: string): string | undefined {
    // Match pattern like: at functionName (/path/to/file.ts:123:45)
    const locationMatch = stack.match(/at\s+.*?\s+\((.+?):(\d+):(\d+)\)/);
    if (locationMatch) {
      const filePath = locationMatch[1];
      const fileName = filePath.split('/').pop() || filePath;
      return `${fileName}:${locationMatch[2]}`;
    }

    // Alternative pattern: at /path/to/file.ts:123:45
    const altMatch = stack.match(/at\s+(.+?):(\d+):(\d+)/);
    if (altMatch) {
      const filePath = altMatch[1];
      const fileName = filePath.split('/').pop() || filePath;
      return `${fileName}:${altMatch[2]}`;
    }

    return undefined;
  }

  /**
   * Logging utility with level control
   */
  private log(message: string, level: 'minimal' | 'detailed' | 'verbose'): void {
    const levels = { minimal: 1, detailed: 2, verbose: 3 };
    const currentLevel = levels[this.options.logLevel];
    const messageLevel = levels[level];

    if (messageLevel <= currentLevel) {
      console.log(message);
    }
  }

  /**
   * Get results for the current suite
   */
  getSuiteResults(): Map<string, TestExecutionResult> {
    return new Map(this.suiteResults);
  }

  /**
   * Clear suite results
   */
  clearResults(): void {
    this.suiteResults.clear();
    this.log(' Test orchestrator results cleared', 'detailed');
  }

  /**
   * Get summary of test execution
   */
  getSummary(): {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    passRate: number;
  } {
    const results = Array.from(this.suiteResults.values());
    const total = results.length;
    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const passRate = total > 0 ? (passed / total) * 100 : 0;

    return { total, passed, failed, skipped, passRate };
  }
}

/**
 * Convenience function to create a simple orchestrated test
 */
export function createOrchestratedTest(
  testName: string,
  dependencies: string[],
  testFunction: (fixtures: any) => Promise<void> | void,
  options: {
    useSharedPage?: boolean;
    runRegardless?: boolean;
    metadata?: TestMetadata;
    timeout?: number;
  } = {}
): void {
  const orchestrator = new TestOrchestrator({
    useSharedPage: options.useSharedPage,
    suiteName: `Orchestrated: ${testName}`
  });

  orchestrator.createSuite(`Orchestrated: ${testName}`, [{
    name: testName,
    dependencies,
    testFunction,
    runRegardless: options.runRegardless,
    metadata: options.metadata,
    timeout: options.timeout
  }]);
}

/**
 * Convenience function for creating a test that runs only if ALL specified tests pass
 */
export function runIfAllPass(
  testName: string,
  requiredTests: string[],
  testFunction: (fixtures: any) => Promise<void> | void,
  options: {
    useSharedPage?: boolean;
    metadata?: TestMetadata;
    timeout?: number;
  } = {}
): void {
  createOrchestratedTest(testName, requiredTests, testFunction, options);
}

/**
 * Convenience function for creating a test that runs regardless of dependencies
 */
export function runRegardless(
  testName: string,
  testFunction: (fixtures: any) => Promise<void> | void,
  options: {
    useSharedPage?: boolean;
    metadata?: TestMetadata;
    timeout?: number;
  } = {}
): void {
  createOrchestratedTest(testName, [], testFunction, { ...options, runRegardless: true });
}

// Export singleton instance for global use
export const globalOrchestrator = new TestOrchestrator();
