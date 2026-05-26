import * as dotenv from 'dotenv';

dotenv.config({ quiet: true });

export type Environment = 'local' | 'local-test' | 'test' | 'sbx' | 'prod';
export type BrowserType = 'chromium' | 'chrome' | 'firefox' | 'webkit';

export interface ServiceConfig {
  baseUrl: string;
}

export interface Config {
  backend: ServiceConfig;
  dashboard: ServiceConfig;
  timeout: number;
  retries: number;
  headless: boolean;
  browser: BrowserType;
  enableBrowserConsoleLogs: boolean;
  parallel: number;
}

export function getEnvironment(): Environment {
  const env = process.env.TEST_ENV;
  const validEnvs: Environment[] = ['local', 'local-test', 'test', 'sbx', 'prod'];

  if (!env) {
    throw new Error(
      'TEST_ENV environment variable is required. Valid values: local, local-test, test, sbx, prod'
    );
  }

  if (!validEnvs.includes(env as Environment)) {
    throw new Error(`Invalid TEST_ENV "${env}". Valid values: ${validEnvs.join(', ')}`);
  }

  return env as Environment;
}

function getBackendUrl(env: Environment): string {
  if (process.env.BACKEND_URL) {
    return process.env.BACKEND_URL;
  }

  switch (env) {
    case 'local':
    case 'local-test':
    case 'test':
      return 'http://localhost:3001';
    case 'sbx':
      return 'https://sbx-api.xyne.com';
    case 'prod':
      return 'https://api.xyne.com';
  }
}

function getDashboardUrl(env: Environment): string {
  if (process.env.DASHBOARD_URL) {
    return process.env.DASHBOARD_URL;
  }

  switch (env) {
    case 'local':
    case 'local-test':
    case 'test':
      return 'http://localhost:5173';
    case 'sbx':
      return 'https://sbx-dashboard.xyne.com';
    case 'prod':
      return 'https://dashboard.xyne.com';
  }
}

function getHeadless(env: Environment): boolean {
  if (process.env.HEADLESS !== undefined) {
    return process.env.HEADLESS === 'true';
  }

  switch (env) {
    case 'local':
      return false;
    case 'local-test':
    case 'test':
    case 'sbx':
    case 'prod':
      return true;
  }
}

function getTimeout(): number {
  const defaultTimeout = 30000;

  if (!process.env.TIMEOUT) {
    return defaultTimeout;
  }

  const parsed = parseInt(process.env.TIMEOUT, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? defaultTimeout : parsed;
}

function getRetries(): number {
  const defaultRetries = 3;

  if (!process.env.RETRIES) {
    return defaultRetries;
  }

  const parsed = parseInt(process.env.RETRIES, 10);
  return Number.isNaN(parsed) || parsed < 0 ? defaultRetries : parsed;
}

function getBrowser(): BrowserType {
  const browser = process.env.BROWSER as BrowserType;
  const validBrowsers: BrowserType[] = ['chromium', 'chrome', 'firefox', 'webkit'];

  return validBrowsers.includes(browser) ? browser : 'chrome';
}

function getEnableBrowserConsoleLogs(env: Environment): boolean {
  if (process.env.ENABLE_BROWSER_CONSOLE_LOGS !== undefined) {
    return process.env.ENABLE_BROWSER_CONSOLE_LOGS === 'true';
  }

  return env === 'test' || env === 'local-test';
}

function getParallel(env: Environment): number {
  if (process.env.PARALLEL !== undefined) {
    const parsed = parseInt(process.env.PARALLEL, 10);
    return Number.isNaN(parsed) || parsed < 1 ? 1 : parsed;
  }

  switch (env) {
    case 'local':
    case 'local-test':
      return 3;
    case 'test':
      return 1; // Jenkins runs serially — single Gauge worker
    default:
      return 1;
  }
}

function getConfigForEnv(env: Environment): Config {
  return {
    backend: {
      baseUrl: getBackendUrl(env),
    },
    dashboard: {
      baseUrl: getDashboardUrl(env),
    },
    timeout: getTimeout(),
    retries: getRetries(),
    headless: getHeadless(env),
    browser: getBrowser(),
    enableBrowserConsoleLogs: getEnableBrowserConsoleLogs(env),
    parallel: getParallel(env),
  };
}

export const environment = getEnvironment();
export const config = getConfigForEnv(environment);
