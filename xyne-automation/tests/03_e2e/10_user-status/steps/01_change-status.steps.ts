/**
 * Step definitions for user status and theme settings tests
 */

import { When } from '@cucumber/cucumber';

import { uiLogger } from '@/lib/logger';

import '@/fixtures/cucumber.parameters';
import { CustomWorld } from '@/fixtures/cucumber.world';

// ============================================
// User Status & Theme Steps
// ============================================

When(
  'I click on the {int}th occurrence of text {string}',
  async function (this: CustomWorld, index: number, text: string) {
    if (!this.page) throw new Error('Browser not initialized');

    const zeroBasedIndex = index - 1;
    const elements = this.page.locator(`text="${text}"`);
    const count = await elements.count();

    if (count === 0) {
      throw new Error(`No elements found with text "${text}"`);
    }

    if (zeroBasedIndex >= count) {
      throw new Error(
        `Index ${index} out of bounds. Only ${count} elements found with text "${text}"`
      );
    }

    await elements.nth(zeroBasedIndex).click();
    uiLogger.info(`[UI] Clicked on ${index}th occurrence of text: "${text}"`);
  }
);

When(
  'I click on element with id {string} containing text {string}',
  async function (this: CustomWorld, id: string, text: string) {
    if (!this.page) throw new Error('Browser not initialized');

    const selector = `[id="${id}"] div:has-text("${text}")`;
    const element = this.page.locator(selector).first();
    await element.waitFor({ state: 'visible' });
    await element.click();

    uiLogger.info(`[UI] Clicked on element with id "${id}" containing text: "${text}"`);
  }
);
