import * as dotenv from 'dotenv';

dotenv.config({ quiet: true });

const date = new Date();
const timestamp = date.toISOString().replace(/[:.]/g, '-');
process.env.REPORT_TIMESTAMP = timestamp;

const common = {
  requireModule: ['ts-node/register', 'tsconfig-paths/register'],
  require: ['tests/**/*.steps.ts', 'fixtures/cucumber.*.ts'],
  format: [
    process.env.TEST_ENV != 'local' ? 'progress' : 'summary',
    `summary:report/${timestamp}/cucumber-summary.log`,
    `json:report/${timestamp}/cucumber-report.json`,
    `html:report/${timestamp}/cucumber-report.html`,
  ],
  formatOptions: { snippetInterface: 'async-await' },
  publishQuiet: true,
  // Retry failed scenarios (override with RETRIES env var)
  retry: (() => {
    const defaultRetries = process.env.TEST_ENV === 'test' ? 1 : 0;
    if (!process.env.RETRIES) return defaultRetries;

    const parsed = parseInt(process.env.RETRIES, 10);
    return isNaN(parsed) || parsed <= 0 ? defaultRetries : parsed;
  })(),
};

export default {
  ...common,
  paths: ['tests/**/*.feature'],
};

export const api = {
  ...common,
  paths: ['tests/01_api/**/*.feature'],
  tags: '@api',
};

export const ui = {
  ...common,
  paths: ['tests/02_ui/**/*.feature'],
  tags: '@ui',
};

export const e2e = {
  ...common,
  paths: ['tests/03_e2e/**/*.feature'],
  tags: '@e2e',
};
