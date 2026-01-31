/**
 * Base page class for all page objects
 * TypeScript equivalent of Python's BasePage
 */

import { Page, Locator, expect } from '@playwright/test';
import { configManager } from './config-manager';

export abstract class BasePage {
  protected page: Page;
  protected config = configManager.getConfig();

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Navigate to a specific URL
   */
  async navigate(url: string): Promise<void> {
    await this.page.goto(url, { 
      waitUntil: 'networkidle',
      timeout: this.config.timeout.navigation 
    });
  }

  /**
   * Wait for an element to be visible
   */
  async waitForElement(selector: string, timeout?: number): Promise<Locator> {
    const element = this.page.locator(selector);
    await element.waitFor({ 
      state: 'visible', 
      timeout: timeout || this.config.timeout.action 
    });
    return element;
  }

  /**
   * Wait for an element to be hidden
   */
  async waitForElementHidden(selector: string, timeout?: number): Promise<void> {
    const element = this.page.locator(selector);
    await element.waitFor({ 
      state: 'hidden', 
      timeout: timeout || this.config.timeout.action 
    });
  }

  /**
   * Check if element is visible
   */
  async isElementVisible(selector: string): Promise<boolean> {
    try {
      const element = this.page.locator(selector);
      return await element.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Check if element is enabled
   */
  async isElementEnabled(selector: string): Promise<boolean> {
    try {
      const element = this.page.locator(selector);
      return await element.isEnabled();
    } catch {
      return false;
    }
  }

  /**
   * Click an element
   */
  async clickElement(selector: string, options?: { timeout?: number; force?: boolean }): Promise<void> {
    const element = this.page.locator(selector);
    await element.click({
      timeout: options?.timeout || this.config.timeout.action,
      force: options?.force
    });
  }

  /**
   * Fill an input element. If the selector suggests it's a password field,
   * it uses direct DOM manipulation to set the value, preventing it from being logged.
   */
  async fill(selector: string, text: string, options?: { timeout?: number }): Promise<void> {
    const element = this.page.locator(selector);
    const isPassword = selector.toLowerCase().includes('password');

    if (isPassword) {
      console.log(`Securely setting value for sensitive field: ${selector}`);
      // Use evaluate to set the value directly on the DOM element.
      // This is the most secure method as it bypasses Playwright's action logging entirely.
      await element.evaluate((el, value) => (el as HTMLInputElement).value = value, text);
    } else {
      await element.fill(text, {
        timeout: options?.timeout || this.config.timeout.action
      });
    }
  }

  /**
   * Get text content of an element
   */
  async getElementText(selector: string): Promise<string | null> {
    try {
      const element = this.page.locator(selector);
      return await element.textContent();
    } catch {
      return null;
    }
  }

  /**
   * Get attribute value of an element
   */
  async getElementAttribute(selector: string, attribute: string): Promise<string | null> {
    try {
      const element = this.page.locator(selector);
      return await element.getAttribute(attribute);
    } catch {
      return null;
    }
  }

  /**
   * Get all elements matching selector
   */
  async getElements(selector: string): Promise<Locator[]> {
    return await this.page.locator(selector).all();
  }

  /**
   * Wait for page to load completely
   */
  async waitForPageLoad(timeout?: number): Promise<void> {
    await this.page.waitForLoadState('networkidle', {
      timeout: timeout || this.config.timeout.navigation
    });
  }

  /**
   * Take a screenshot
   */
  async takeScreenshot(filename?: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotName = filename || `screenshot-${timestamp}.png`;
    const screenshotPath = `reports/screenshots/${screenshotName}`;
    
    await this.page.screenshot({ 
      path: screenshotPath, 
      fullPage: true 
    });
    
    return screenshotPath;
  }

  /**
   * Scroll to element
   */
  async scrollToElement(selector: string): Promise<void> {
    const element = this.page.locator(selector);
    await element.scrollIntoViewIfNeeded();
  }

  /**
   * Hover over element
   */
  async hoverElement(selector: string): Promise<void> {
    const element = this.page.locator(selector);
    await element.hover();
  }

  /**
   * Select option from dropdown
   */
  async selectOption(selector: string, value: string): Promise<void> {
    const element = this.page.locator(selector);
    await element.selectOption(value);
  }

  /**
   * Upload file
   */
  async uploadFile(selector: string, filePath: string): Promise<void> {
    const element = this.page.locator(selector);
    await element.setInputFiles(filePath);
  }

  /**
   * Wait for URL to contain specific text
   */
  async waitForUrlContains(text: string, timeout?: number): Promise<void> {
    await this.page.waitForURL(
      url => url.toString().includes(text),
      { timeout: timeout || this.config.timeout.navigation }
    );
  }

  /**
   * Get current URL
   */
  getCurrentUrl(): string {
    return this.page.url();
  }

  /**
   * Get page title
   */
  async getPageTitle(): Promise<string> {
    return await this.page.title();
  }

  /**
   * Execute JavaScript in browser
   */
  async executeScript<T>(script: string, ...args: any[]): Promise<T> {
    return await this.page.evaluate(script, ...args);
  }

  /**
   * Wait for specific condition
   */
  async waitForCondition(
    condition: () => Promise<boolean>, 
    timeout: number = this.config.timeout.action,
    interval: number = 1000
  ): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      if (await condition()) {
        return;
      }
      await this.page.waitForTimeout(interval);
    }
    
    throw new Error(`Condition not met within ${timeout}ms`);
  }

  /**
   * Assert element is visible
   */
  async assertElementVisible(selector: string, message?: string): Promise<void> {
    const element = this.page.locator(selector);
    await expect(element, message).toBeVisible();
  }

  /**
   * Assert element contains text
   */
  async assertElementContainsText(selector: string, text: string, message?: string): Promise<void> {
    const element = this.page.locator(selector);
    await expect(element, message).toContainText(text);
  }

  /**
   * Assert element has exact text
   */
  async assertElementHasText(selector: string, text: string | string[], message?: string): Promise<void> {
    const element = this.page.locator(selector);
    await expect(element, message).toHaveText(text as any);
  }

  /**
   * Assert element has exact HTML
   */
  async assertElementHasHTML(selector: string, html: string, message?: string): Promise<void> {
    const element = this.page.locator(selector);
    const actualHTML = await element.innerHTML();
    
    // Decode HTML entities for comparison
    const decodeHtmlEntities = (str: string): string => {
      return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');
    };
    
    const decodedActual = decodeHtmlEntities(actualHTML);
    const decodedExpected = decodeHtmlEntities(html);
    
    expect(decodedActual, message).toBe(decodedExpected);
  }

  /**
   * Assert element has attribute
   */
  async assertElementHasAttribute(selector: string, attribute: string, value: string, message?: string): Promise<void> {
    const element = this.page.locator(selector);
    await expect(element, message).toHaveAttribute(attribute, value);
  }

  /**
   * Assert page title
   */
  async assertPageTitle(expectedTitle: string, message?: string): Promise<void> {
    await expect(this.page, message).toHaveTitle(expectedTitle);
  }

  /**
   * Assert URL contains text
   */
  async assertUrlContains(text: string, message?: string): Promise<void> {
    await expect(this.page, message).toHaveURL(new RegExp(text));
  }

  /**
   * Get network requests during page interaction
   */
  async captureNetworkRequests<T>(action: () => Promise<T>): Promise<{ result: T; requests: any[] }> {
    const requests: any[] = [];
    
    // Listen for requests
    this.page.on('request', request => {
      requests.push({
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        postData: request.postData(),
        timestamp: new Date().toISOString()
      });
    });
    
    const result = await action();
    
    return { result, requests };
  }

  /**
   * Wait for network to be idle
   */
  async waitForNetworkIdle(timeout?: number): Promise<void> {
    await this.page.waitForLoadState('networkidle', {
      timeout: timeout || this.config.timeout.navigation
    });
  }

  /**
   * Reload page
   */
  async reloadPage(): Promise<void> {
    await this.page.reload({ waitUntil: 'networkidle' });
  }

  /**
   * Go back in browser history
   */
  async goBack(): Promise<void> {
    await this.page.goBack({ waitUntil: 'networkidle' });
  }

  /**
   * Go forward in browser history
   */
  async goForward(): Promise<void> {
    await this.page.goForward({ waitUntil: 'networkidle' });
  }

  /**
   * Close page
   */
  async closePage(): Promise<void> {
    await this.page.close();
  }
}
