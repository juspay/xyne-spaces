/**
 * Instrumented Page - Automatically logs all Playwright actions
 *
 * SIMPLIFIED VERSION - Only wraps locator actions to avoid duplicates
 * This wrapper only instruments locator methods (click, fill, etc.) NOT page.locator() itself
 * This prevents duplicate steps while still capturing all user actions
 *
 * AUTOMATICALLY CAPTURED (appear in reports):
 *
 * Locator Actions:
 * - page.locator(...).click(), dblclick()
 * - page.locator(...).fill(), type(), press(), pressSequentially()
 * - page.locator(...).check(), uncheck()
 * - page.locator(...).selectOption(), setInputFiles()
 * - page.locator(...).focus(), blur()
 * - page.locator(...).hover(), dragTo(), tap()
 *
 * Page Actions:
 * - page.goto(url)
 * - page.goBack(), goForward(), reload()
 * - page.waitForTimeout(ms)
 * - page.waitForURL(url)
 * - page.waitForLoadState(state)
 * - page.waitForSelector(selector)
 *
 * Assertions (via instrumented expect):
 * - expect(locator).toBeVisible(), toHaveText(), etc. (ALL assertions!)
 *
 * MANUAL CAPTURE REQUIRED (use helper functions):
 * - page.url() → Use getUrlStep(page) or await logStep(`URL: ${page.url()}`)
 * - console.log() → Use await logStep(message) instead
 * - page.evaluate() → Wrap in test.step()
 *
 * EXAMPLE USAGE:
 * ```typescript
 * import { logStep, getUrlStep, expect } from '@/framework/utils';
 *
 * // Automatically captured (no changes needed):
 * await page.goto('https://example.com');
 * await page.waitForTimeout(2000);
 * await page.locator('button').click();
 * await expect(page.locator('h1')).toBeVisible(); // NEW: Auto-captured!
 *
 * // Manual capture for logging:
 * await logStep('Starting user registration flow');
 * const currentUrl = await getUrlStep(page, 'Verify we are on login page');
 * await logStep('User navigated to:', currentUrl);
 * ```
 */

import { Page, Locator, expect as playwrightExpect } from '@playwright/test';
import { step } from './step-tracker';

/**
 * Capture caller location from stack trace
 */
function getCallerLocation(): string | undefined {
  const stack = new Error().stack;
  if (!stack) return undefined;

  // Split stack into lines and find the first line outside this file
  const lines = stack.split('\n');
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    // Skip lines from instrumented-page.ts and node_modules
    if (line.includes('instrumented-page') || line.includes('node_modules')) {
      continue;
    }

    // Extract file and line number - patterns like:
    // at functionName (/path/to/file.ts:123:45)
    // at /path/to/file.ts:123:45
    const match = line.match(/\((.+):(\d+):(\d+)\)|at\s+(.+):(\d+):(\d+)/);
    if (match) {
      const filePath = match[1] || match[4];
      const lineNum = match[2] || match[5];
      const fileName = filePath.split('/').pop();
      return `— ${fileName}:${lineNum}`;
    }
  }
  return undefined;
}

/**
 * Instrumented expect() that captures assertions as test steps
 * This wraps Playwright's expect() to automatically log all assertions in reports
 */
export function expect(actual: any) {
  const expectResult = playwrightExpect(actual);

  // Get a description of what we're expecting on
  let targetDescription = 'unknown';
  if (actual && typeof actual === 'object') {
    if (actual.constructor.name === 'Locator') {
      // It's a locator - try to get the selector
      targetDescription = 'locator';
    } else if (actual.constructor.name === 'Page') {
      targetDescription = 'page';
    } else if (actual.url) {
      targetDescription = 'page';
    }
  } else {
    targetDescription = String(actual).substring(0, 50);
  }

  // Wrap each assertion method
  const assertionMethods = [
    'toBeVisible', 'toBeHidden', 'toBeEnabled', 'toBeDisabled', 'toBeChecked',
    'toBeEditable', 'toBeEmpty', 'toBeFocused', 'toContainText', 'toHaveText',
    'toHaveValue', 'toHaveAttribute', 'toHaveClass', 'toHaveCount', 'toHaveCSS',
    'toHaveId', 'toHaveURL', 'toHaveTitle', 'toBeAttached', 'toBeInViewport',
    'toHaveScreenshot', 'toHaveAccessibleName', 'toHaveAccessibleDescription',
    'toHaveRole', 'toBeTruthy', 'toBeFalsy', 'toBeDefined', 'toBeUndefined',
    'toBeNull', 'toBeNaN', 'toBeGreaterThan', 'toBeGreaterThanOrEqual',
    'toBeLessThan', 'toBeLessThanOrEqual', 'toBeCloseTo', 'toContain',
    'toEqual', 'toStrictEqual', 'toMatch', 'toMatchObject', 'toThrow'
  ];

  const wrappedExpect: any = {};

  // Add 'not' support
  Object.defineProperty(wrappedExpect, 'not', {
    get() {
      const notExpect: any = {};
      assertionMethods.forEach(method => {
        notExpect[method] = async function(...args: any[]) {
          const argStr = args.length > 0 ? `(${JSON.stringify(args[0])})` : '()';
          const location = getCallerLocation();
          const stepTitle = `expect(${targetDescription}).not.${method}${argStr}${location || ''}`;

          return await step(stepTitle, async () => {
            return await (expectResult.not as any)[method](...args);
          });
        };
      });
      return notExpect;
    }
  });

  // Wrap each assertion method
  assertionMethods.forEach(method => {
    if (typeof (expectResult as any)[method] === 'function') {
      wrappedExpect[method] = async function(...args: any[]) {
        // Format the step title with method name and arguments
        const argStr = args.length > 0 ? `(${JSON.stringify(args[0]).substring(0, 30)})` : '()';
        const location = getCallerLocation();
        const stepTitle = `expect(${targetDescription}).${method}${argStr}${location || ''}`;

        return await step(stepTitle, async () => {
          return await (expectResult as any)[method](...args);
        });
      };
    }
  });

  // Copy any other properties
  Object.keys(expectResult).forEach(key => {
    if (!wrappedExpect[key] && !assertionMethods.includes(key)) {
      wrappedExpect[key] = (expectResult as any)[key];
    }
  });

  return wrappedExpect;
}

/**
 * Instrumented console.log that captures logs as test steps
 * Use this instead of console.log() in your test code to have logs appear in the report
 */
export async function logStep(message: string, ...args: any[]): Promise<void> {
  const fullMessage = args.length > 0
    ? `${message} ${args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ')}`
    : message;

  return await step(` ${fullMessage}`, async () => {
    console.log(message, ...args);
  });
}

/**
 * Synchronous version of logStep for cases where you can't use async
 * Note: This won't create a test step, but will still log to console
 */
export function logStepSync(message: string, ...args: any[]): void {
  console.log(` ${message}`, ...args);
}

/**
 * NOT USED - Page-level instrumentation disabled to prevent duplicates
 * Only locator-level actions are instrumented
 */
export function instrumentPage(page: Page): Page {
  return page; // Pass through - no instrumentation at page level
}

/**
 * Create an instrumented locator that logs all actions
 * ONLY wraps locator actions - does NOT wrap page.locator() to prevent duplicates
 */
export function instrumentLocator(locator: Locator, selector: string): Locator {
  return new Proxy(locator, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);

      if (typeof original === 'function') {
        const actionName = String(prop);

        // Only instrument actual user actions, not chaining methods
        // This prevents duplicates while capturing all meaningful steps
        const instrumentedActions = [
          'click', 'dblclick', 'fill', 'type', 'press', 'pressSequentially',
          'check', 'uncheck', 'selectOption', 'setInputFiles',
          'focus', 'blur', 'hover', 'dragTo', 'tap'
        ];

        if (instrumentedActions.includes(actionName)) {
          return async function (...args: any[]) {
            // Format arguments
            const argStr = args.map(arg => {
              if (typeof arg === 'string') return `"${arg}"`;
              if (typeof arg === 'object' && arg !== null) {
                return JSON.stringify(arg).substring(0, 50);
              }
              return String(arg);
            }).join(', ');

            // Shorten selector for display
            const shortSelector = selector.length > 60
              ? selector.substring(0, 60) + '...'
              : selector;

            const stepTitle = argStr
              ? `${actionName}(${argStr}) on "${shortSelector}"`
              : `${actionName}() on "${shortSelector}"`;

            return await step(stepTitle, async () => {
              return await original.apply(target, args);
            });
          };
        }

        // For chaining methods like first(), last(), nth() - return instrumented locator
        if (['first', 'last', 'nth', 'filter', 'locator'].includes(actionName)) {
          return function (...args: any[]) {
            const result = original.apply(target, args);
            // If result is a locator, instrument it too
            if (result && typeof result === 'object' && 'click' in result) {
              return instrumentLocator(result, selector);
            }
            return result;
          };
        }
      }

      return original;
    }
  }) as Locator;
}

/**
 * Wrap page.locator() to return instrumented locators
 * SIMPLIFIED - Only wraps locator() method, not page methods
 * This prevents duplicates while still capturing all user actions
 */
export function wrapPageWithInstrumentation(page: Page): Page {
  const originalLocator = page.locator.bind(page);
  const originalGoto = page.goto.bind(page);
  const originalGoBack = page.goBack.bind(page);
  const originalGoForward = page.goForward.bind(page);
  const originalReload = page.reload.bind(page);
  const originalWaitForTimeout = page.waitForTimeout.bind(page);
  const originalWaitForURL = page.waitForURL.bind(page);
  const originalWaitForLoadState = page.waitForLoadState.bind(page);
  const originalWaitForSelector = page.waitForSelector.bind(page);

  // Override the locator method to return instrumented locators
  (page as any).locator = function(selector: string, options?: any) {
    const locator = originalLocator(selector, options);
    return instrumentLocator(locator, selector);
  };

  // Wrap goto separately (it's a common page-level action)
  (page as any).goto = async function(url: string, options?: any) {
    return await step(`goto("${url}")`, async () => {
      return await originalGoto(url, options);
    });
  };

  // Wrap navigation methods
  (page as any).goBack = async function(options?: any) {
    return await step('goBack()', async () => {
      return await originalGoBack(options);
    });
  };

  (page as any).goForward = async function(options?: any) {
    return await step('goForward()', async () => {
      return await originalGoForward(options);
    });
  };

  (page as any).reload = async function(options?: any) {
    return await step('reload()', async () => {
      return await originalReload(options);
    });
  };

  // Wrap waitForTimeout to show in steps
  (page as any).waitForTimeout = async function(timeout: number) {
    return await step(`waitForTimeout(${timeout}ms)`, async () => {
      return await originalWaitForTimeout(timeout);
    });
  };

  // Wrap waitForURL
  (page as any).waitForURL = async function(url: string | RegExp | ((url: URL) => boolean), options?: any) {
    const urlStr = typeof url === 'string' ? url : url instanceof RegExp ? url.toString() : 'function';
    return await step(`waitForURL(${urlStr})`, async () => {
      return await originalWaitForURL(url as any, options);
    });
  };

  // Wrap waitForLoadState
  (page as any).waitForLoadState = async function(state?: 'load' | 'domcontentloaded' | 'networkidle', options?: any) {
    const stateStr = state || 'load';
    return await step(`waitForLoadState("${stateStr}")`, async () => {
      return await originalWaitForLoadState(state, options);
    });
  };

  // Wrap waitForSelector
  (page as any).waitForSelector = async function(selector: string, options?: any) {
    return await step(`waitForSelector("${selector}")`, async () => {
      return await originalWaitForSelector(selector, options);
    });
  };

  return page; // Return page as-is, just with methods overridden
}

/**
 * Helper function to get and log the current URL as a step
 * Use this instead of page.url() when you want it to appear in the report
 */
export async function getUrlStep(page: Page, label: string = 'Get current URL'): Promise<string> {
  return await step(label, async () => {
    const url = page.url();
    console.log(`Current URL: ${url}`);
    return url;
  });
}
