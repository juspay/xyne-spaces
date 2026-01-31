import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config.ts';

export default defineConfig({
  ...baseConfig,
  // Force sequential execution (crucial for orchestrator)
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'reports/html-report-all-modules-2025-10-24T15-20-56-3NZ', open: 'never' }],
    ['json', { outputFile: 'reports/test-results-all-modules-2025-10-24T15-20-56-3NZ.json' }],
    ['junit', { outputFile: 'reports/junit-results-all-modules-2025-10-24T15-20-56-3NZ.xml' }],
    ['list'],
    ['./src/framework/core/enhanced-reporter.ts']
  ],
  outputDir: 'reports/test-artifacts-all-modules-2025-10-24T15-20-56-3NZ',
  // Increase timeouts for long-running orchestrated tests
  timeout: 180000, // 3 minutes per test
  expect: {
    timeout: 30000 // 30 seconds for assertions
  }
});
