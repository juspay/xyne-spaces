import * as fs from 'fs';
import * as path from 'path';

import { After, AfterAll, Before, BeforeAll, setDefaultTimeout, Status } from '@cucumber/cucumber';
import { expect } from 'chai';
import * as dotenv from 'dotenv';

import { config } from '@/config';

import { apiLogger, cucumberLogger } from '@/lib/logger';

import { CustomWorld, getBrowserLauncher, scope } from '@/fixtures/cucumber.world';

// Ensure screenshot directory exists
const timestamp = process.env.REPORT_TIMESTAMP || 'latest';
const screenshotDir = path.resolve(__dirname, '..', 'report', timestamp, 'screenshots');

setDefaultTimeout(config.timeout);

// Load environment variables before all tests
BeforeAll(async function () {
  dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
  cucumberLogger.info(`Running in '${process.env.TEST_ENV || 'local'}' environment`);

  // Initialize Global Browser
  const browserType = config.browser;
  cucumberLogger.info(`Launching Global Browser: ${browserType}\n`);
  const launcher = getBrowserLauncher(browserType);
  scope.browser = await launcher.launch({
    headless: config.headless,
  });

  // Create screenshot directory if it doesn't exist
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }
});

// Before hook for scenarios that need browser
Before({ tags: '@e2e or @ui' }, async function (this: CustomWorld) {
  const sessionInfo = this.activeContextName
    ? `using session: ${this.activeContextName}`
    : 'no active session';
  cucumberLogger.info(`Browser before hook (${sessionInfo})`);
});

// After hook to capture screenshot on failure (browser cleanup moved to AfterAll)
After({ tags: '@e2e or @ui' }, async function (this: CustomWorld, scenario) {
  // Capture screenshot on failure
  if (scenario.result?.status === Status.FAILED && this.page) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const scenarioName = scenario.pickle.name.replace(/[^a-zA-Z0-9]/g, '_');
    const screenshotName = `${scenarioName}_${timestamp}`;

    try {
      const screenshot = await this.takeScreenshot(screenshotName);
      if (screenshot) {
        // Attach screenshot to Cucumber report - must await to prevent hook from completing early
        await this.attach(screenshot.toString('base64'), 'base64:image/png');
        cucumberLogger.info(`Screenshot saved: ${screenshotName}.png`);
      }
    } catch (error) {
      cucumberLogger.error('Failed to capture screenshot:', error);
    }
  }

  // NOTE: Browser sessions are NOT closed here to allow reuse across scenarios
  // Sessions will be cleaned up by the AfterAll hook when the entire test run completes
});

// General before hook for all scenarios
Before(async function (this: CustomWorld, scenario) {
  cucumberLogger.info(`🚀 Starting scenario: ${scenario.pickle.name}`);
});

// General after hook for all scenarios - runs LAST (defined first)
After(async function (this: CustomWorld, scenario) {
  const status = scenario.result?.status;
  if (status === Status.FAILED) {
    cucumberLogger.info(`❌ Scenario failed: ${scenario.pickle.name}\n`);
  } else if (status === Status.PASSED) {
    cucumberLogger.info(`✅ Scenario passed: ${scenario.pickle.name}\n`);
  }
});

// Cucumber After hooks run in reverse order of definition
After({ tags: '@api' }, function (this: CustomWorld) {
  if (this.startTime) {
    const duration = Date.now() - this.startTime;
    apiLogger.info(`Response time: ${duration}ms`);
    expect(duration).to.be.lessThan(10000);
  }
});

// Cleanup after all tests
AfterAll(async function () {
  // Close all browser contexts first
  for (const context of scope.contexts.values()) {
    await context.close();
  }
  scope.contexts.clear();
  scope.pages.clear();

  // Close session-specific browser instances (different browser types)
  for (const [browserType, browser] of scope.sessionBrowsers.entries()) {
    await browser.close();
    cucumberLogger.info(`Session browser closed: ${browserType}`);
  }
  scope.sessionBrowsers.clear();

  // Close the global browser instance
  if (scope.browser) {
    await scope.browser.close();
    cucumberLogger.info('Global Browser closed');
  }

  cucumberLogger.info('Test run completed\n');
});
