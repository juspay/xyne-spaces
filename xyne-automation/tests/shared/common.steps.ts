/**
 * Common step definitions for browser/UI tests that can be reused across all test types.
 */
import { Then, When } from '@cucumber/cucumber';
import { expect } from 'chai';

import { uiLogger } from '@/lib/logger';

import '@/fixtures/cucumber.parameters';
import { CustomWorld, scope } from '@/fixtures/cucumber.world';

// ============================================
// Generic Steps
// ============================================

When('I wait for {int} seconds', async function (this: CustomWorld, seconds: number) {
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
});

// ============================================
// Path Navigation Steps
// ============================================

When('I open the Xyne-Space at {string}', async function (this: CustomWorld, endpoint: string) {
  if (!this.page) throw new Error('Browser not initialized');

  let url: string;

  if (endpoint.startsWith('/')) {
    url = `${this.config.dashboard.baseUrl}${endpoint}`;
  } else {
    const channelId = scope.pathData.get(endpoint);
    if (!channelId) {
      throw new Error(`Path "${endpoint}" not found in storage. Make sure it was created first.`);
    }
    url = `${this.config.dashboard.baseUrl}/chat/dir/${channelId}`;
  }

  await this.page.goto(url);
  await this.page.waitForLoadState('networkidle');

  uiLogger.info(`[Navigation] Opened xyne space at: ${url}`);
});

Then('I store the current path as {string}', async function (this: CustomWorld, pathName: string) {
  if (!this.page) throw new Error('Browser not initialized');

  const currentUrl = this.page.url();
  const urlPath = new URL(currentUrl).pathname;
  const segments = urlPath.split('/').filter(Boolean);
  const lastSegment = segments[segments.length - 1];

  if (!lastSegment) {
    throw new Error(`Could not extract path segment from URL: ${currentUrl}`);
  }

  const { scope } = await import('@/fixtures/cucumber.world');
  scope.pathData.set(pathName, lastSegment);

  uiLogger.info(`[Navigation] Stored path "${pathName}" with value: ${lastSegment}`);
});

// ============================================
// UI Interaction Steps
// ============================================

// Click Actions
When('I click on {string}', async function (this: CustomWorld, selector: string) {
  if (!this.page) throw new Error('Browser not initialized');
  await this.page.click(selector);
});

When('I click on text {string}', async function (this: CustomWorld, text: string) {
  if (!this.page) throw new Error('Browser not initialized');

  let resolvedText = text;

  const userMatch = text.match(/^user:([^.]+)\.(.+)$/);
  if (userMatch) {
    const [, browserSession, field] = userMatch;
    for (const [, userData] of this.userData) {
      if (userData.browserSession === browserSession) {
        resolvedText = userData[field as keyof typeof userData] as string;
        break;
      }
    }
    if (resolvedText === text) {
      throw new Error(`No user found logged in browser session "${browserSession}"`);
    }
  }

  await this.page.click(`text="${resolvedText}"`);
  uiLogger.info(`[UI] Clicked on text: "${resolvedText}"`);
});

When(
  'I click on text {string} in the element {string}',
  async function (this: CustomWorld, text: string, selector: string) {
    if (!this.page) throw new Error('Browser not initialized');

    const resolvedText = text.replace(
      /user:([^.,\s]+)\.([^,\s]+)/g,
      (match, browserSession, field) => {
        for (const [, userData] of this.userData) {
          if (userData.browserSession === browserSession) {
            return userData[field as keyof typeof userData] as string;
          }
        }
        throw new Error(`No user found logged in browser session "${browserSession}"`);
      }
    );

    const container = this.page.locator(selector).first();
    await container.waitFor({ state: 'visible' });
    await container.locator(`text="${resolvedText}"`).click();

    uiLogger.info(`[UI] Clicked on text: "${resolvedText}" in element "${selector}"`);
  }
);

When('I click the button with text {string}', async function (this: CustomWorld, text: string) {
  if (!this.page) throw new Error('Browser not initialized');
  await this.page.click(`button:has-text("${text}")`);
});

// Type Actions
When(
  'I type {string} on the element {string}',
  async function (this: CustomWorld, text: string, selector: string) {
    if (!this.page) throw new Error('Browser not initialized');

    const resolvedText = text.replace(
      /user:([^.,\s]+)\.([^,\s]+)/g,
      (match, browserSession, field) => {
        for (const [, userData] of this.userData) {
          if (userData.browserSession === browserSession) {
            return userData[field as keyof typeof userData] as string;
          }
        }
        throw new Error(`No user found logged in browser session "${browserSession}"`);
      }
    );

    const element = this.page.locator(selector).first();
    await element.waitFor({ state: 'visible' });
    await element.fill(resolvedText);
    uiLogger.info(`[UI] Typed "${resolvedText}" on element "${selector}"`);
  }
);

// ============================================
// UI Assertion Steps
// ============================================

// Whole page
Then('I should see the element {string}', async function (this: CustomWorld, selector: string) {
  if (!this.page) throw new Error('Browser not initialized');
  const element = await this.page.$(selector);
  expect(element).to.not.be.null;
});

Then('I should not see {string}', async function (this: CustomWorld, text: string) {
  if (!this.page) throw new Error('Browser not initialized');
  const content = await this.page.textContent('body');
  expect(content).to.not.include(text);
});

// Specific element
Then(
  'I should see a button with text {string}',
  async function (this: CustomWorld, buttonText: string) {
    if (!this.page) throw new Error('Browser not initialized');

    const button = this.page.locator(`button:has-text("${buttonText}")`);
    await button.first().waitFor({ state: 'visible' });

    const isVisible = await button.first().isVisible();
    expect(isVisible).to.be.true;

    uiLogger.info(`[UI] Button with text "${buttonText}" is visible`);
  }
);

Then(
  'I should see {string} in the element {string}',
  async function (this: CustomWorld, text: string, selector: string) {
    if (!this.page) throw new Error('Browser not initialized');

    const resolvedText = text.replace(
      /user:([^.,\s]+)\.([^,\s]+)/g,
      (match, browserSession, field) => {
        for (const [, userData] of this.userData) {
          if (userData.browserSession === browserSession) {
            return userData[field as keyof typeof userData] as string;
          }
        }
        throw new Error(`No user found logged in browser session "${browserSession}"`);
      }
    );

    const container = this.page.locator(selector).first();
    await container.waitFor({ state: 'visible' });

    const messageElement = container.locator(`text="${resolvedText}"`).first();

    await messageElement.waitFor({ state: 'visible' });

    expect(await messageElement.isVisible()).to.be.true;

    uiLogger.info(`[UI] Verified text "${resolvedText}" is visible in element "${selector}"`);
  }
);
