import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Playwright configuration for Xyne automation framework
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['./src/framework/core/orchestrator-reporter.ts'], // MUST be first to fix test statuses before other reporters
    ['blob', { outputDir: 'reports/blob-report' }], // Capture ALL step details including clicks, fills, expects
    ['json', { outputFile: 'reports/test-results.json' }],
    ['junit', { outputFile: 'reports/junit-results.xml' }],
    ['list'],
    ['./src/framework/core/enhanced-reporter.ts']
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.XYNE_BASE_URL || 'https://xyne.juspay.net',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    
    /* Take screenshot on failure */
    screenshot: 'only-on-failure',
    
    /* Record video on failure */
    video: 'retain-on-failure',
    
    /* Global timeout for each action */
    actionTimeout: 30000,

    /* Global timeout for navigation */
    navigationTimeout: 60000, // Increased from 30000 to 60000 to allow more time for login
    
    /* Ignore HTTPS errors */
    ignoreHTTPSErrors: true,
    
    /* Viewport size */
   // viewport: { width: 1280, height: 720 },
    
    /* User agent */
    userAgent: 'Xyne-Automation-Framework/1.0.0 (Playwright)',
    
    /* Extra HTTP headers */
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
    },
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        // Enable network monitoring
        launchOptions: {
          args: [
            '--disable-web-security', 
            '--disable-features=VizDisplayCompositor',
            // Additional args to avoid Google device protection challenges in headless mode
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--lang=en-US,en',
            '--window-size=1280,720'
          ]
        }
      },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    /* Test against mobile viewports. */
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },

    /* Test against branded browsers. */
    {
      name: 'Microsoft Edge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
    {
      name: 'Google Chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],

  /* Global setup and teardown */
  globalSetup: require.resolve('./src/framework/core/global-setup.ts'),
  globalTeardown: require.resolve('./src/framework/core/global-teardown.ts'),

  /* Output directories */
  outputDir: 'reports/test-artifacts',

  /* Test timeout */
  timeout: 120000, // Increased from 60000 to 120000 to allow time for login retries
  
  /* Expect timeout */
  expect: {
    timeout: 10000,
  },

  /* Web server configuration for local development */
  webServer: process.env.START_LOCAL_SERVER ? {
    command: 'npm run start:test-server',
    port: 3000,
    reuseExistingServer: !process.env.CI,
  } : undefined,
});
