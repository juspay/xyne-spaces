/**
 * Shared Browser Manager
 * Manages shared browser instances across test files for session persistence
 */

import { Browser, BrowserContext, Page } from '@playwright/test';
import { configManager } from './config-manager';

export type SharedScope = 'file' | 'suite' | 'global';

export interface SharedBrowserInstance {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  scope: SharedScope;
  fileId?: string;
  suiteId?: string;
  createdAt: Date;
  lastUsed: Date;
}

class SharedBrowserManager {
  private static instance: SharedBrowserManager;
  private sharedInstances: Map<string, SharedBrowserInstance> = new Map();
  private currentFileId: string | null = null;
  private currentSuiteId: string | null = null;

  private constructor() {}

  static getInstance(): SharedBrowserManager {
    if (!SharedBrowserManager.instance) {
      SharedBrowserManager.instance = new SharedBrowserManager();
    }
    return SharedBrowserManager.instance;
  }

  /**
   * Set the current test file context
   */
  setCurrentFile(fileId: string): void {
    this.currentFileId = fileId;
  }

  /**
   * Set the current test suite context
   */
  setCurrentSuite(suiteId: string): void {
    this.currentSuiteId = suiteId;
  }

  /**
   * Get or create a shared page based on the specified scope
   */
  async getSharedPage(
    browser: Browser,
    scope: SharedScope = 'file',
    options?: {
      fileId?: string;
      suiteId?: string;
      forceNew?: boolean;
    }
  ): Promise<Page> {
    const config = configManager.getConfig();
    const fileId = options?.fileId || this.currentFileId || 'default';
    const suiteId = options?.suiteId || this.currentSuiteId || 'default';

    // Generate instance key based on scope
    let instanceKey: string;
    switch (scope) {
      case 'global':
        instanceKey = 'global';
        break;
      case 'suite':
        instanceKey = `suite-${fileId}-${suiteId}`;
        break;
      case 'file':
      default:
        instanceKey = `file-${fileId}`;
        break;
    }

    // Check if we should force create a new instance
    if (options?.forceNew) {
      await this.cleanupInstance(instanceKey);
    }

    // Return existing instance if available
    const existingInstance = this.sharedInstances.get(instanceKey);
    if (existingInstance) {
      // In orchestrated mode, always try to reuse even if page appears closed
      const isOrchestratedMode = (globalThis as any).__ORCHESTRATOR_CONTINUE_ON_FAILURE__;

      if (!existingInstance.page.isClosed()) {
        existingInstance.lastUsed = new Date();
        console.log(` Reusing shared ${scope} page: ${instanceKey}`);
        return existingInstance.page;
      } else if (isOrchestratedMode) {
        console.log(`️ Page was closed but attempting to preserve session in orchestrated mode`);
        // Don't create a new instance, try to recover
      }
    }

    // Create new shared instance
    console.log(`🆕 Creating new shared ${scope} page: ${instanceKey}`);
    const context = await browser.newContext({
      viewport: config.viewport,
      ignoreHTTPSErrors: true,
      // Preserve session storage and cookies for shared instances
      storageState: existingInstance ? undefined : undefined,
    });

    const page = await context.newPage();

    // Store the new instance
    const newInstance: SharedBrowserInstance = {
      browser,
      context,
      page,
      scope,
      fileId: scope !== 'global' ? fileId : undefined,
      suiteId: scope === 'suite' ? suiteId : undefined,
      createdAt: new Date(),
      lastUsed: new Date(),
    };

    this.sharedInstances.set(instanceKey, newInstance);

    // Set up cleanup handlers only for non-orchestrated tests
    const isOrchestratedMode = (globalThis as any).__ORCHESTRATOR_CONTINUE_ON_FAILURE__;

    if (!isOrchestratedMode) {
      page.on('close', () => {
        console.log(`🗑 Shared page closed: ${instanceKey}`);
        this.sharedInstances.delete(instanceKey);
      });
    } else {
      console.log(`🔒 Page close protection enabled for orchestrated mode: ${instanceKey}`);

      // Override page.close() to prevent closure during orchestrated tests
      const originalPageClose = page.close.bind(page);
      const originalContextClose = context.close.bind(context);

      page.close = async () => {
        console.log(`🛡 Prevented page close in orchestrated mode: ${instanceKey}`);
        return Promise.resolve();
      };

      context.close = async () => {
        console.log(`🛡 Prevented context close in orchestrated mode: ${instanceKey}`);
        return Promise.resolve();
      };

      // Store original close methods for cleanup later
      (page as any).__originalClose = originalPageClose;
      (context as any).__originalClose = originalContextClose;
    }

    return page;
  }

  /**
   * Create a new shared page (forces creation of fresh instance)
   */
  async createNewSharedPage(
    browser: Browser,
    scope: SharedScope = 'file',
    options?: {
      fileId?: string;
      suiteId?: string;
    }
  ): Promise<Page> {
    return this.getSharedPage(browser, scope, { ...options, forceNew: true });
  }

  /**
   * Restore original page close functionality
   */
  restorePageCloseFunctionality(instanceKey?: string): void {
    if (instanceKey) {
      const instance = this.sharedInstances.get(instanceKey);
      if (instance) {
        if ((instance.page as any).__originalClose) {
          instance.page.close = (instance.page as any).__originalClose;
          delete (instance.page as any).__originalClose;
        }
        if ((instance.context as any).__originalClose) {
          instance.context.close = (instance.context as any).__originalClose;
          delete (instance.context as any).__originalClose;
        }
        console.log(`🔓 Restored close functionality: ${instanceKey}`);
      }
    } else {
      // Restore for all instances
      this.sharedInstances.forEach((instance, key) => {
        if ((instance.page as any).__originalClose) {
          instance.page.close = (instance.page as any).__originalClose;
          delete (instance.page as any).__originalClose;
        }
        if ((instance.context as any).__originalClose) {
          instance.context.close = (instance.context as any).__originalClose;
          delete (instance.context as any).__originalClose;
        }
        console.log(`🔓 Restored close functionality: ${key}`);
      });
    }
  }

  /**
   * Cleanup a specific shared instance
   */
  async cleanupInstance(instanceKey: string): Promise<void> {
    const instance = this.sharedInstances.get(instanceKey);
    if (instance) {
      try {
        if (!instance.page.isClosed()) {
          await instance.page.close();
        }
        await instance.context.close();
      } catch (error) {
        console.warn(`️ Error cleaning up shared instance ${instanceKey}:`, error);
      }
      this.sharedInstances.delete(instanceKey);
      console.log(` Cleaned up shared instance: ${instanceKey}`);
    }
  }

  /**
   * Cleanup instances by scope
   */
  async cleanupByScope(scope: SharedScope, fileId?: string, suiteId?: string): Promise<void> {
    const instancesToCleanup: string[] = [];

    for (const [key, instance] of this.sharedInstances.entries()) {
      if (instance.scope === scope) {
        if (scope === 'global') {
          instancesToCleanup.push(key);
        } else if (scope === 'file' && instance.fileId === fileId) {
          instancesToCleanup.push(key);
        } else if (scope === 'suite' && instance.fileId === fileId && instance.suiteId === suiteId) {
          instancesToCleanup.push(key);
        }
      }
    }

    for (const key of instancesToCleanup) {
      await this.cleanupInstance(key);
    }
  }

  /**
   * Cleanup all shared instances
   */
  async cleanupAll(): Promise<void> {
    console.log(' Cleaning up all shared browser instances...');
    const cleanupPromises = Array.from(this.sharedInstances.keys()).map(key =>
      this.cleanupInstance(key)
    );
    await Promise.all(cleanupPromises);
    console.log(' All shared instances cleaned up');
  }

  /**
   * Get statistics about current shared instances
   */
  getStats(): {
    totalInstances: number;
    byScope: Record<SharedScope, number>;
    oldestInstance?: Date;
    newestInstance?: Date;
  } {
    const instances = Array.from(this.sharedInstances.values());
    const byScope: Record<SharedScope, number> = { global: 0, file: 0, suite: 0 };

    instances.forEach(instance => {
      byScope[instance.scope]++;
    });

    const dates = instances.map(i => i.createdAt);
    const oldestInstance = dates.length > 0 ? new Date(Math.min(...dates.map(d => d.getTime()))) : undefined;
    const newestInstance = dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))) : undefined;

    return {
      totalInstances: instances.length,
      byScope,
      oldestInstance,
      newestInstance,
    };
  }

  /**
   * Check if shared mode is enabled in configuration
   */
  isSharedModeEnabled(): boolean {
    const config = configManager.getConfig();
    if (typeof config.browser === 'object' && config.browser.sharedMode !== undefined) {
      return config.browser.sharedMode;
    }
    return true; // Default to true if not specified
  }

  /**
   * Get default shared scope from configuration
   */
  getDefaultScope(): SharedScope {
    const config = configManager.getConfig();
    if (typeof config.browser === 'object' && config.browser.sharedScope) {
      return config.browser.sharedScope;
    }
    return 'file'; // Default scope
  }
}

// Export singleton instance
export const sharedBrowserManager = SharedBrowserManager.getInstance();
