/**
 * Custom Playwright Test Fixtures
 * Provides enhanced test fixtures including shared page functionality,
 * priority-based execution, and dependency management
 */

import { test as base, expect, Page, Browser } from '@playwright/test';
import { sharedBrowserManager, SharedScope } from './shared-browser-manager';
import { dependencyManager } from './dependency-manager';
import { TestMetadata, TestExecutionResult } from '@/types';
import { APIMonitor } from '../utils/api-monitor';
import { wrapPageWithInstrumentation } from '../utils/instrumented-page';
import path from 'path';

// Define custom fixture types
type CustomFixtures = {
  sharedPage: { page: Page; apiMonitor?: APIMonitor };
  newSharedPage: Page;
  sharedPageWithScope: (scope: SharedScope) => Promise<Page>;
  pageWithAPIMonitor: { page: Page; apiMonitor: APIMonitor };
};

// Extract file and suite information from test info
function getTestContext(testInfo: any) {
  const filePath = testInfo.file;
  const fileName = path.basename(filePath, path.extname(filePath));
  const suiteName = testInfo.titlePath[0] || 'default-suite';
  
  return {
    fileId: fileName,
    suiteId: suiteName,
  };
}

// Create enhanced test with custom fixtures
export const test = base.extend<CustomFixtures>({
  /**
   * Override the default page fixture to automatically include API monitoring
   * This ensures all tests get API monitoring without requiring code changes
   */
  page: async ({ browser }, use, testInfo) => {
    const testName = testInfo.title;
    const { fileId } = getTestContext(testInfo);
    
    // Create a new context and page
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Initialize API monitor automatically (TEMPORARILY DISABLED)
    const apiMonitor = new APIMonitor(page, `${fileId}-${testName}`);
    await apiMonitor.startMonitoring(`${fileId}-${testName}`);
    
    console.log(` Using regular page for test: ${testName}`);
    
    try {
      await use(page);
    } finally {
      // Save API monitoring results
      try {
        // const filePath = await apiMonitor.stopMonitoring();
        // console.log(` API calls auto-saved to: ${filePath}`);
      } catch (error) {
        console.error(` Failed to save API calls: ${error}`);
      }
      
      // Cleanup
      await page.close();
      await context.close();
    }
  },

  /**
   * Shared page fixture - provides a shared page instance with optional API monitoring
   * Automatically enables sequential execution for tests using this fixture
   * Enhanced with dependency checking, priority support, and automatic API monitoring
   */
  sharedPage: async ({ browser }, use, testInfo) => {
    const testName = testInfo.title;
    const startTime = Date.now();

    // Build dependency graph if not already built
    try {
      if (!dependencyManager.getDependencyGraph()) {
        dependencyManager.buildDependencyGraph();
      }
    } catch (error) {
      console.error(' Dependency graph error:', error);
    }

    // Check if test should be skipped due to failed dependencies
    const skipInfo = dependencyManager.shouldSkipTest(testName);
    if (skipInfo.skip) {
      console.log(`⏭  Skipping test "${testName}": ${skipInfo.reason}`);
      
      // Record the skip in dependency manager
      const skipResult: TestExecutionResult = {
        testName,
        fullTitle: testInfo.titlePath.join(' > '),
        status: 'skipped',
        reason: skipInfo.reason,
        duration: 0,
        priority: dependencyManager.getTestMetadata(testName)?.priority,
        dependencies: dependencyManager.getTestMetadata(testName)?.dependsOn
      };
      dependencyManager.recordTestResult(skipResult);
      
      test.skip(true, skipInfo.reason);
      return;
    }

    // Set up test context
    const { fileId, suiteId } = getTestContext(testInfo);
    sharedBrowserManager.setCurrentFile(fileId);
    sharedBrowserManager.setCurrentSuite(suiteId);

    let testResult: TestExecutionResult | undefined;
    let page: Page | undefined;
    let apiMonitor: APIMonitor | undefined;
    let shouldCleanupPage = false;
    
    // Check if this is an orchestrated test (declare outside try-catch for scope)
    const isOrchestrated = (globalThis as any).__ORCHESTRATOR_CONTINUE_ON_FAILURE__;

    try {
      // Check if shared mode is enabled
      if (!sharedBrowserManager.isSharedModeEnabled()) {
        // Fall back to regular page if shared mode is disabled
        const context = await browser.newContext();
        page = await context.newPage();
        // NOTE: Instrumentation disabled (see comment below)
        shouldCleanupPage = true;
      } else {
        // Get default scope from configuration
        const defaultScope = sharedBrowserManager.getDefaultScope();
        
        // Get or create shared page
        page = await sharedBrowserManager.getSharedPage(
          browser,
          defaultScope,
          { fileId, suiteId }
        );
        shouldCleanupPage = false;
      }

      console.log(` Using shared page for test: ${testName}`);

      // Wrap page with instrumentation for detailed step tracking FIRST
      const instrumentedPage = wrapPageWithInstrumentation(page);
      
      // Skip API monitoring for orchestrated tests (e.g., multi-user tests)
      if (!isOrchestrated) {
        // Initialize API monitor AFTER instrumentation so it captures all calls
        apiMonitor = new APIMonitor(instrumentedPage, `${fileId}-${testName}`);
        await apiMonitor.startMonitoring(`${fileId}-${testName}`);
        console.log(` API monitoring enabled for test: ${testName}`);
      } else {
        console.log(` API monitoring disabled for orchestrated test: ${testName}`);
      }

      await use({ page: instrumentedPage, apiMonitor });

      // Test passed
      // NOTE: For orchestrated tests, result recording is handled by the orchestrator
      // Only record here for non-orchestrated tests
      if (!isOrchestrated) {
        const duration = Date.now() - startTime;
        testResult = {
          testName,
          fullTitle: testInfo.titlePath.join(' > '),
          status: 'passed',
          duration,
          priority: dependencyManager.getTestMetadata(testName)?.priority,
          dependencies: dependencyManager.getTestMetadata(testName)?.dependsOn
        };

        console.log(` Test passed: ${testName} (${duration}ms)`);
      }

    } catch (error) {
      // Test failed
      // Take screenshot on failure (use original page, not instrumented)
      if (page) {
        try {
          console.log(` Attempting to capture screenshot for failed test: ${testName}`);
          const screenshotPath = testInfo.outputPath(`failure-${Date.now()}.png`);
          console.log(` Screenshot path: ${screenshotPath}`);
          await page.screenshot({ path: screenshotPath, fullPage: true });
          await testInfo.attach('screenshot', { path: screenshotPath, contentType: 'image/png' });
          console.log(` Screenshot captured and attached successfully: ${screenshotPath}`);
        } catch (screenshotError) {
          console.error(` Failed to capture screenshot:`, screenshotError);
        }
      } else {
        console.log(`️  No page object available for screenshot`);
      }

      // NOTE: For orchestrated tests, error handling is done by the orchestrator
      // Only handle errors here for non-orchestrated tests
      if (!isOrchestrated) {
        const duration = Date.now() - startTime;
        testResult = {
          testName,
          fullTitle: testInfo.titlePath.join(' > '),
          status: 'failed',
          duration,
          error: error instanceof Error ? error.message : String(error),
          priority: dependencyManager.getTestMetadata(testName)?.priority,
          dependencies: dependencyManager.getTestMetadata(testName)?.dependsOn
        };

        console.log(` Test failed: ${testName} (${duration}ms) - ${testResult.error}`);

        // Record the failure immediately
        dependencyManager.recordTestResult(testResult);
      }

      // Always re-throw errors - orchestrator will handle them appropriately
      throw error;

    } finally {
      // Stop API monitoring and save results
      if (apiMonitor) {
        try {
          const filePath = await apiMonitor.stopMonitoring();
          console.log(` API calls saved to: ${filePath}`);
        } catch (error) {
          console.error(` Failed to save API calls: ${error}`);
        }
      }

      // Record test result for dependency tracking (if not already recorded in catch block)
      // NOTE: For orchestrated tests, the orchestrator handles all result recording
      const isOrchestrated = (globalThis as any).__ORCHESTRATOR_CONTINUE_ON_FAILURE__;
      if (!isOrchestrated && testResult && testResult.status !== 'failed') {
        dependencyManager.recordTestResult(testResult);
      }

      // Clean up non-shared pages (only if not in orchestrated mode)
      const continueOnFailure = (globalThis as any).__ORCHESTRATOR_CONTINUE_ON_FAILURE__;
      if (shouldCleanupPage && page && !continueOnFailure) {
        await page.context().close();
      } else if (shouldCleanupPage && page && continueOnFailure) {
        console.log(`🛡 Skipped page cleanup due to orchestrated mode`);
      }
    }
  },

  /**
   * New shared page fixture - forces creation of a fresh shared page
   */
  newSharedPage: async ({ browser }, use, testInfo) => {
    const { fileId, suiteId } = getTestContext(testInfo);
    sharedBrowserManager.setCurrentFile(fileId);
    sharedBrowserManager.setCurrentSuite(suiteId);

    if (!sharedBrowserManager.isSharedModeEnabled()) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await use(page);
      await page.close();
      await context.close();
      return;
    }

    const defaultScope = sharedBrowserManager.getDefaultScope();
    const newSharedPage = await sharedBrowserManager.createNewSharedPage(
      browser,
      defaultScope,
      { fileId, suiteId }
    );

    console.log(`🆕 Using new shared ${defaultScope} page for test: ${testInfo.title}`);

    await use(newSharedPage);
    console.log(` New shared page test completed: ${testInfo.title}`);
  },

  /**
   * Shared page with scope fixture - provides a function to get shared pages with specific scopes
   */
  sharedPageWithScope: async ({ browser }, use, testInfo) => {
    const { fileId, suiteId } = getTestContext(testInfo);
    sharedBrowserManager.setCurrentFile(fileId);
    sharedBrowserManager.setCurrentSuite(suiteId);

    const getSharedPageWithScope = async (scope: SharedScope): Promise<Page> => {
      if (!sharedBrowserManager.isSharedModeEnabled()) {
        const context = await browser.newContext();
        return await context.newPage();
      }

      return await sharedBrowserManager.getSharedPage(
        browser,
        scope,
        { fileId, suiteId }
      );
    };

    await use(getSharedPageWithScope);
  },

  /**
   * Page with API Monitor fixture - provides a regular page with API monitoring enabled
   * Automatically captures all API calls and saves them to JSON file after test completion
   */
  pageWithAPIMonitor: async ({ browser }, use, testInfo) => {
    const testName = testInfo.title;
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Initialize API monitor
    const apiMonitor = new APIMonitor(page, testName);
    await apiMonitor.startMonitoring(testName);

    console.log(` API monitoring enabled for test: ${testName}`);

    try {
      await use({ page, apiMonitor });
    } finally {
      // Stop monitoring and save results
      try {
        const filePath = await apiMonitor.stopMonitoring();
        console.log(` API calls saved to: ${filePath}`);
      } catch (error) {
        console.error(` Failed to save API calls: ${error}`);
      }

      // Cleanup
      await page.close();
      await context.close();
    }
  },

});

// Enhanced test function with metadata support
interface TestWithMetadata {
  (name: string, metadata: TestMetadata, fn: (fixtures: any) => Promise<void> | void): void;
  (name: string, fn: (fixtures: any) => Promise<void> | void): void;
}

/**
 * Enhanced test function that supports priority and dependency metadata
 */
export const testWithMetadata: TestWithMetadata = (
  name: string, 
  metadataOrFn: TestMetadata | ((fixtures: any) => Promise<void> | void),
  fn?: (fixtures: any) => Promise<void> | void
) => {
  let metadata: TestMetadata = {};
  let testFn: (fixtures: any) => Promise<void> | void;

  if (typeof metadataOrFn === 'function') {
    // Called as testWithMetadata(name, fn)
    testFn = metadataOrFn;
  } else {
    // Called as testWithMetadata(name, metadata, fn)
    metadata = metadataOrFn;
    testFn = fn!;
  }

  // Register test with dependency manager
  dependencyManager.registerTest(name, metadata);

  // Create the actual test
  return test(name, testFn);
};

// Convenience functions for different priority levels
export const testHighest = (name: string, metadata: Omit<TestMetadata, 'priority'> = {}, fn?: (fixtures: any) => Promise<void> | void) => {
  if (typeof metadata === 'function') {
    return testWithMetadata(name, { priority: 'highest' }, metadata);
  }
  return testWithMetadata(name, { ...metadata, priority: 'highest' }, fn!);
};

export const testHigh = (name: string, metadata: Omit<TestMetadata, 'priority'> = {}, fn?: (fixtures: any) => Promise<void> | void) => {
  if (typeof metadata === 'function') {
    return testWithMetadata(name, { priority: 'high' }, metadata);
  }
  return testWithMetadata(name, { ...metadata, priority: 'high' }, fn!);
};

export const testMedium = (name: string, metadata: Omit<TestMetadata, 'priority'> = {}, fn?: (fixtures: any) => Promise<void> | void) => {
  if (typeof metadata === 'function') {
    return testWithMetadata(name, { priority: 'medium' }, metadata);
  }
  return testWithMetadata(name, { ...metadata, priority: 'medium' }, fn!);
};

export const testLow = (name: string, metadata: Omit<TestMetadata, 'priority'> = {}, fn?: (fixtures: any) => Promise<void> | void) => {
  if (typeof metadata === 'function') {
    return testWithMetadata(name, { priority: 'low' }, metadata);
  }
  return testWithMetadata(name, { ...metadata, priority: 'low' }, fn!);
};

// Re-export expect for convenience
export { expect };

// Define public interface for SharedBrowserManager to avoid exposing private properties
interface PublicSharedBrowserManager {
  setCurrentFile(fileId: string): void;
  setCurrentSuite(suiteId: string): void;
  getSharedPage(
    browser: Browser,
    scope?: SharedScope,
    options?: {
      fileId?: string;
      suiteId?: string;
      forceNew?: boolean;
    }
  ): Promise<Page>;
  createNewSharedPage(
    browser: Browser,
    scope?: SharedScope,
    options?: {
      fileId?: string;
      suiteId?: string;
    }
  ): Promise<Page>;
  cleanupInstance(instanceKey: string): Promise<void>;
  cleanupByScope(scope: SharedScope, fileId?: string, suiteId?: string): Promise<void>;
  cleanupAll(): Promise<void>;
  restorePageCloseFunctionality(instanceKey?: string): void;
  getStats(): {
    totalInstances: number;
    byScope: Record<SharedScope, number>;
    oldestInstance?: Date;
    newestInstance?: Date;
  };
  isSharedModeEnabled(): boolean;
  getDefaultScope(): SharedScope;
}

// Export test utilities
export const testUtils = {
  /**
   * Configure a test describe block to use shared pages with sequential execution
   */
  configureSharedTests: (options?: {
    scope?: SharedScope;
    sequential?: boolean;
  }) => {
    const { scope = 'file', sequential = true } = options || {};
    
    if (sequential) {
      test.describe.configure({ mode: 'serial' });
    }
    
    return {
      scope,
      sequential,
    };
  },

  /**
   * Get shared browser manager instance for advanced usage
   */
  getSharedBrowserManager: (): PublicSharedBrowserManager => sharedBrowserManager as PublicSharedBrowserManager,

  /**
   * Cleanup shared instances (useful for test teardown)
   */
  cleanupSharedInstances: async (scope?: SharedScope, fileId?: string, suiteId?: string) => {
    if (scope) {
      await sharedBrowserManager.cleanupByScope(scope, fileId, suiteId);
    } else {
      await sharedBrowserManager.cleanupAll();
    }
  },

  /**
   * Get statistics about current shared instances
   */
  getSharedInstanceStats: () => sharedBrowserManager.getStats(),
};

// Export types for external use
export type { SharedScope };
