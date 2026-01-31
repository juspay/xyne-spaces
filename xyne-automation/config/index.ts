import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config({ quiet: true });

export type Environment = 'local' | 'test' | 'sbx' | 'prod';
export type BrowserType = 'chromium' | 'firefox' | 'webkit';

export interface ServiceConfig {
  baseUrl: string;
}

export interface Config {
  backend: ServiceConfig;
  dashboard: ServiceConfig;
  timeout: number;
  headless: boolean;
  browser: BrowserType;
  enableBrowserConsoleLogs: boolean;
}

// Get current environment from TEST_ENV env variable, default to 'local'
export function getEnvironment(): Environment {
  const env = process.env.TEST_ENV as Environment;
  const validEnvs: Environment[] = ['local', 'test', 'sbx', 'prod'];
  return validEnvs.includes(env) ? env : 'local';
}

// Get backend base URL based on environment
function getBackendUrl(env: Environment): string {
  // Use env var if provided, otherwise use defaults per environment
  if (process.env.BACKEND_URL) {
    return process.env.BACKEND_URL;
  }

  switch (env) {
    case 'local':
    case 'test':
      return 'http://localhost:3001';
    case 'sbx':
      return 'https://sbx-api.xyne.com';
    case 'prod':
      return 'https://api.xyne.com';
  }
}

// Get dashboard base URL based on environment
function getDashboardUrl(env: Environment): string {
  // Use env var if provided, otherwise use defaults per environment
  if (process.env.DASHBOARD_URL) {
    return process.env.DASHBOARD_URL;
  }

  switch (env) {
    case 'local':
    case 'test':
      return 'http://localhost:5173';
    case 'sbx':
      return 'https://sbx-dashboard.xyne.com';
    case 'prod':
      return 'https://dashboard.xyne.com';
  }
}

// Get headless mode based on environment
function getHeadless(env: Environment): boolean {
  // Use env var if provided
  if (process.env.HEADLESS !== undefined) {
    return process.env.HEADLESS === 'true';
  }

  switch (env) {
    case 'local':
      return false; // local runs with browser visible
    case 'test':
    case 'sbx':
    case 'prod':
      return true; // CI/remote environments run headless
  }
}

// Get timeout from env or default
function getTimeout(): number {
  const DEFAULT_TIMEOUT = 60000;
  if (!process.env.TIMEOUT) return DEFAULT_TIMEOUT;

  const parsed = parseInt(process.env.TIMEOUT, 10);
  return isNaN(parsed) || parsed <= 0 ? DEFAULT_TIMEOUT : parsed;
}

// Get browser type from env or default to chromium
function getBrowser(): BrowserType {
  const browser = process.env.BROWSER as BrowserType;
  const validBrowsers: BrowserType[] = ['chromium', 'firefox', 'webkit'];
  return validBrowsers.includes(browser) ? browser : 'chromium';
}

// Get browser console logs setting from env or default based on environment
function getEnableBrowserConsoleLogs(env: Environment): boolean {
  if (process.env.ENABLE_BROWSER_CONSOLE_LOGS !== undefined) {
    return process.env.ENABLE_BROWSER_CONSOLE_LOGS === 'true';
  }

  return env === 'test';
}

// Build config for environment
function getConfigForEnv(env: Environment): Config {
  return {
    backend: {
      baseUrl: getBackendUrl(env),
    },
    dashboard: {
      baseUrl: getDashboardUrl(env),
    },
    timeout: getTimeout(),
    headless: getHeadless(env),
    browser: getBrowser(),
    enableBrowserConsoleLogs: getEnableBrowserConsoleLogs(env),
  };
}

// Export environment and config
export const environment = getEnvironment();
export const config = getConfigForEnv(environment);
