/**
 * Browser steps for creating, switching, and closing browser instances
 */

import { Given } from '@cucumber/cucumber';

import { BrowserType } from '@/config';

import '@/fixtures/cucumber.parameters';
import { CustomWorld } from '@/fixtures/cucumber.world';

// ============================================
// Browser Steps
// ============================================

Given(
  'a browser {string} with viewport {viewport}',
  async function (this: CustomWorld, name: string, viewport: string) {
    await this.createBrowserSession(name, viewport);
  }
);

Given(
  'a browser {string} with viewport {viewport} using {browserType}',
  async function (this: CustomWorld, name: string, viewport: string, browserType: BrowserType) {
    await this.createBrowserSession(name, viewport, browserType);
  }
);

Given('using browser {string}', async function (this: CustomWorld, name: string) {
  if (!this.contexts.has(name)) {
    throw new Error(`Browser '${name}' does not exist. Create it first with "a browser" step.`);
  }
  await this.switchBrowserSession(name);
});

Given('close the browser {string}', async function (this: CustomWorld, name: string) {
  await this.closeBrowserSession(name);
});
