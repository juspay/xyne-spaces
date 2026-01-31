import * as fs from 'fs';
import * as path from 'path';

import { IWorldOptions, setWorldConstructor, World } from '@cucumber/cucumber';
import { Browser, BrowserContext, chromium, firefox, Page, webkit } from '@playwright/test';
import { AxiosInstance, AxiosResponse } from 'axios';

import { BrowserType, config } from '@/config';

import { createApiClient } from '@/lib/api-client';
import { browserLogger, cucumberLogger } from '@/lib/logger';

import { CapturedApiResponse, StoredUserContext } from '@/fixtures/cucumber.types';

export interface CustomWorld extends World {
  browser?: Browser;
  // Map of context names to their valid context objects
  contexts: Map<string, BrowserContext>;
  // Map of context names to their current active page
  pages: Map<string, Page>;
  activeContextName?: string;

  // Backwards compatibility getter for the "active" page
  readonly page: Page | undefined;
  // Backwards compatibility getter for the "active" context
  readonly context: BrowserContext | undefined;

  apiClient: AxiosInstance;
  response?: AxiosResponse;
  startTime?: number;
  config: typeof config;

  // Browser API response capture
  capturedResponse?: CapturedApiResponse;

  // User data storage (for multi-user scenarios)
  userData: Map<string, StoredUserContext>;

  initBrowser(): Promise<void>;
  closeBrowser(): Promise<void>;

  // New methods for session management
  createBrowserSession(name: string, viewport?: string, browserType?: BrowserType): Promise<void>;
  switchBrowserSession(name: string): Promise<void>;
  closeBrowserSession(name: string): Promise<void>;

  takeScreenshot(name: string): Promise<Buffer | null>;
}

// Map browser type string to launcher
export function getBrowserLauncher(browserType: BrowserType) {
  switch (browserType) {
    case 'firefox':
      return firefox;
    case 'webkit':
      return webkit;
    case 'chromium':
    default:
      return chromium;
  }
}

// Singleton browser instance and session state (global scope)
// NOTE: We store sessions globally because Cucumber creates a new World instance for each scenario
export const scope = {
  browser: undefined as Browser | undefined,
  sessionBrowsers: new Map<string, Browser>(),
  contexts: new Map<string, BrowserContext>(),
  pages: new Map<string, Page>(),
  activeContextName: undefined as string | undefined,
  userData: new Map<string, StoredUserContext>(),
  pathData: new Map<string, string>(),
};

class TestWorld extends World implements CustomWorld {
  get browser() {
    return scope.browser;
  }

  // Use global scope for contexts/pages to persist across scenarios
  get contexts() {
    return scope.contexts;
  }

  get pages() {
    return scope.pages;
  }

  get activeContextName(): string | undefined {
    return scope.activeContextName;
  }

  set activeContextName(value: string | undefined) {
    scope.activeContextName = value;
  }

  apiClient: AxiosInstance;
  response?: AxiosResponse;
  startTime?: number;

  config: typeof config;

  capturedResponse?: CapturedApiResponse;

  // Use global scope for userData to persist across scenarios
  get userData() {
    return scope.userData;
  }

  constructor(options: IWorldOptions) {
    super(options);
    this.apiClient = createApiClient();
    this.config = config;
  }

  get page(): Page | undefined {
    if (!this.activeContextName) return undefined;
    return this.pages.get(this.activeContextName);
  }

  get context(): BrowserContext | undefined {
    if (!this.activeContextName) return undefined;
    return this.contexts.get(this.activeContextName);
  }

  async initBrowser(): Promise<void> {
    // For backwards compatibility with existing hooks:
    // If no session exists, create a default one
    if (this.contexts.size === 0) {
      await this.createBrowserSession('default');
    }
  }

  async createBrowserSession(
    name: string,
    viewport?: string,
    browserType?: BrowserType
  ): Promise<void> {
    // If session already exists, just switch to it (idempotent for Background steps)
    if (this.contexts.has(name)) {
      this.activeContextName = name;
      return;
    }

    let contextOptions = {};
    if (viewport) {
      const [width, height] = viewport.split('x').map(Number);
      if (width && height) {
        contextOptions = { viewport: { width, height } };
      }
    }

    // Determine which browser instance to use
    let browserInstance: Browser;
    if (browserType && browserType !== config.browser) {
      if (!scope.sessionBrowsers.has(browserType)) {
        const launcher = getBrowserLauncher(browserType);
        const newBrowser = await launcher.launch({ headless: config.headless });
        scope.sessionBrowsers.set(browserType, newBrowser);
      }
      browserInstance = scope.sessionBrowsers.get(browserType)!;
    } else {
      if (!scope.browser) {
        throw new Error('Global browser instance not initialized. Check BeforeAll hook.');
      }
      browserInstance = scope.browser;
    }

    // Create new context (incognito session) with optional viewport
    const context = await browserInstance.newContext(contextOptions);
    const page = await context.newPage();

    // Set default timeout to match Cucumber/Project config
    context.setDefaultTimeout(config.timeout);
    context.setDefaultNavigationTimeout(config.timeout);

    // Attach listeners for browser logs (only when enabled in config)
    if (config.enableBrowserConsoleLogs) {
      page.on('console', (msg) => {
        const type = msg.type();
        const text = msg.text();
        if (type === 'error') {
          browserLogger.error(text);
        } else if (type === 'warning') {
          browserLogger.warn(text);
        } else {
          browserLogger.info(`[${type}] ${text}`);
        }
      });

      page.on('pageerror', (err) => {
        browserLogger.error(`Uncaught Exception: ${err.message}`);
      });
    }

    this.contexts.set(name, context);
    this.pages.set(name, page);
    this.activeContextName = name;
  }

  async switchBrowserSession(name: string): Promise<void> {
    if (!this.contexts.has(name)) {
      throw new Error(`Browser session '${name}' does not exist.`);
    }
    this.activeContextName = name;
    await this.pages.get(name)?.bringToFront();
  }

  async closeBrowserSession(name: string): Promise<void> {
    const context = this.contexts.get(name);
    if (context) {
      await context.close(); // Closes all pages in context
      this.contexts.delete(name);
      this.pages.delete(name);
    }

    if (this.activeContextName === name) {
      this.activeContextName = undefined;
      if (this.contexts.size > 0) {
        this.activeContextName = this.contexts.keys().next().value;
      }
    }
  }

  async closeBrowser(): Promise<void> {
    // Close all contexts
    for (const name of this.contexts.keys()) {
      await this.closeBrowserSession(name);
    }

    // Close session-specific browser instances
    for (const browser of scope.sessionBrowsers.values()) {
      await browser.close();
    }
    scope.sessionBrowsers.clear();
  }

  async takeScreenshot(name: string): Promise<Buffer | null> {
    if (!this.page) return null;

    try {
      const timestamp = process.env.REPORT_TIMESTAMP || 'latest';
      const screenshotDir = path.resolve(__dirname, '..', 'report', timestamp, 'screenshots');
      await fs.promises.mkdir(screenshotDir, { recursive: true });

      const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const screenshotPath = path.join(screenshotDir, `${sanitizedName}.png`);

      return await this.page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
    } catch (error) {
      cucumberLogger.error('Failed to take screenshot:', error);
      return null;
    }
  }
}

setWorldConstructor(TestWorld);

export { TestWorld };
