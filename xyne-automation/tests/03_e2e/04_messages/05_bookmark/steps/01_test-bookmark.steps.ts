import { When } from '@cucumber/cucumber';

import { uiLogger } from '@/lib/logger';

import '@/fixtures/cucumber.parameters';
import { CustomWorld } from '@/fixtures/cucumber.world';

When('I hover on the element {string}', async function (this: CustomWorld, selector: string) {
  if (!this.page) throw new Error('Browser not initialized');

  const element = this.page.locator(selector).first();
  await element.waitFor({ state: 'visible' });
  await element.hover();

  uiLogger.info(`[UI] Hovered on element: ${selector}`);
});

When(
  'I hover on the text {string} at index {int}',
  async function (this: CustomWorld, text: string, index: number) {
    if (!this.page) throw new Error('Browser not initialized');

    const locator = this.page.locator('div').filter({ hasText: new RegExp(`^${text}$`) });

    const element = locator.nth(index);
    await element.waitFor({ state: 'visible' });
    await element.hover();

    uiLogger.info(`[UI] Hovered on text: "${text}" at index ${index}`);
  }
);
