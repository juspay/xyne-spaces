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
    const storedPath = scope.pathData.get(endpoint);
    if (!storedPath) {
      throw new Error(`Path "${endpoint}" not found in storage. Make sure it was created first.`);
    }
    // If stored path starts with /, use it as-is; otherwise treat as channel ID for backward compatibility
    if (storedPath.startsWith('/')) {
      url = `${this.config.dashboard.baseUrl}${storedPath}`;
    } else {
      url = `${this.config.dashboard.baseUrl}/chat/${storedPath}`;
    }
  }

  await this.page.goto(url);
  await this.page.waitForLoadState('networkidle');

  uiLogger.info(`[Navigation] Opened xyne space at: ${url}`);
});

Then('I store the current path as {string}', async function (this: CustomWorld, pathName: string) {
  if (!this.page) throw new Error('Browser not initialized');

  const currentUrl = this.page.url();
  const urlPath = new URL(currentUrl).pathname;

  scope.pathData.set(pathName, urlPath);

  uiLogger.info(`[Navigation] Stored path "${pathName}" with value: ${urlPath}`);
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

When(
  'I click on the first button in the element {string}',
  async function (this: CustomWorld, selector: string) {
    if (!this.page) throw new Error('Browser not initialized');

    uiLogger.info(`[UI] Clicking on first button in: ${selector}`);

    const container = this.page.locator(selector).first();
    await container.waitFor({ state: 'visible' });

    let firstButton = container.locator('button').first();

    const buttonCount = await container.locator('button').count();
    if (buttonCount === 0) {
      uiLogger.info('[UI] No button elements found, trying role="button"');
      firstButton = container.locator('[role="button"]').first();
      const roleButtonCount = await container.locator('[role="button"]').count();
      if (roleButtonCount === 0) {
        throw new Error(
          `No buttons found in element ${selector}. Expected either <button> elements or elements with role="button"`
        );
      }
    }
    await firstButton.click();

    uiLogger.info('[UI] Clicked on first button');
  }
);

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

When('I clear the text in {string}', async function (this: CustomWorld, selector: string) {
  if (!this.page) throw new Error('Browser not initialized');
  const element = this.page.locator(selector).first();
  await element.waitFor({ state: 'visible' });
  await element.clear();
  uiLogger.info(`[UI] Cleared text in element "${selector}"`);
});

When('I press {string}', async function (this: CustomWorld, key: string) {
  if (!this.page) throw new Error('Browser not initialized');
  await this.page.keyboard.press(key);
  uiLogger.info(`[UI] Pressed key "${key}"`);
});

When(
  'I set datetime input {string} to {int} days from now',
  async function (this: CustomWorld, selector: string, days: number) {
    if (!this.page) throw new Error('Browser not initialized');
    const element = this.page.locator(selector).first();
    await element.waitFor({ state: 'visible' });

    // Calculate future date
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);

    // Format for datetime-local input: YYYY-MM-DDTHH:mm
    const year = futureDate.getFullYear();
    const month = String(futureDate.getMonth() + 1).padStart(2, '0');
    const day = String(futureDate.getDate()).padStart(2, '0');
    const dateValue = `${year}-${month}-${day}T12:00`;

    await element.fill(dateValue);
    // Blur to trigger save
    await element.blur();
    uiLogger.info(`[UI] Set datetime input "${selector}" to ${dateValue} (${days} days from now)`);
  }
);

When(
  'I select a date {int} days from now in the element {string}',
  async function (this: CustomWorld, days: number, calendarSelector: string) {
    if (!this.page) throw new Error('Browser not initialized');
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);
    const year = futureDate.getFullYear();
    const month = futureDate.getMonth();
    const day = futureDate.getDate();
    const calendar = this.page.locator(calendarSelector);
    await calendar.waitFor({ state: 'visible' });
    const dateButton = calendar.locator(`button[data-date="${year}-${month}-${day}"]`);
    await dateButton.waitFor({ state: 'visible' });
    await dateButton.click();
    uiLogger.info(
      `[UI] Selected date ${year}-${month + 1}-${day} (${days} days from now) in calendar "${calendarSelector}"`
    );
  }
);

// ============================================
// UI Assertion Steps
// ============================================

// Whole page
Then('I should see the element {string}', async function (this: CustomWorld, selector: string) {
  if (!this.page) throw new Error('Browser not initialized');

  uiLogger.info(`[UI] Verifying element is visible: ${selector}`);

  const element = this.page.locator(selector).first();
  await element.waitFor({ state: 'visible' });

  const isVisible = await element.isVisible();
  expect(isVisible).to.be.true;

  uiLogger.info(`[UI] Element ${selector} is visible`);
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

Then(
  'I should not see {string} in the element {string}',
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

    // Wait a short time and check it's not visible
    const isVisible = await messageElement.isVisible().catch(() => false);

    expect(isVisible).to.be.false;

    uiLogger.info(`[UI] Verified text "${resolvedText}" is NOT visible in element "${selector}"`);
  }
);

// Selector-based negation
Then('I do not see {string}', async function (this: CustomWorld, selector: string) {
  if (!this.page) throw new Error('Browser not initialized');

  const element = this.page.locator(selector).first();
  const isVisible = await element.isVisible().catch(() => false);

  expect(isVisible).to.be.false;
  uiLogger.info(`[UI] Verified element "${selector}" is NOT visible`);
});
