/**
 * Common step definitions for e2e tests that can be reused across all test types.
 */

import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from 'chai';

import { e2eLogger } from '@/lib/logger';

import '@/fixtures/cucumber.parameters';
import { CapturedApiResponse, ResponseFormat } from '@/fixtures/cucumber.types';
import { CustomWorld } from '@/fixtures/cucumber.world';

// ============================================
// Authentication Steps
// ============================================

Given('I am not logged in', async function (this: CustomWorld) {
  if (!this.page) throw new Error('Browser not initialized');

  await this.page.goto(this.config.dashboard.baseUrl);

  await this.page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  await this.context?.clearCookies();

  e2eLogger.info('[Auth] Cleared all authentication state (localStorage, sessionStorage, cookies)');
});

// ============================================
// Navigation Assertions
// ============================================

Then(
  'the user should be redirected to {string}',
  async function (this: CustomWorld, urlPart: string) {
    if (!this.page) throw new Error('Browser not initialized');

    e2eLogger.info(`[Nav] Waiting for URL to contain "${urlPart}"`);

    try {
      await this.page.waitForURL((url) => url.toString().includes(urlPart));
      e2eLogger.info(`[Nav] Successfully redirected to "${urlPart}"`);
    } catch (error) {
      const currentUrl = this.page.url();
      throw new Error(
        `Expected to be redirected to "${urlPart}", but current URL is "${currentUrl}". Error: ${(error as Error).message}`
      );
    }
  }
);

Then('I wait for {string} to appear', async function (this: CustomWorld, selector: string) {
  if (!this.page) throw new Error('Browser not initialized');

  e2eLogger.info(`[UI] Waiting for element "${selector}" to appear`);

  await this.page.waitForSelector(selector, {
    state: 'visible',
  });

  e2eLogger.info(`[UI] Element "${selector}" appeared`);
});

Then('I wait for {string} to disappear', async function (this: CustomWorld, selector: string) {
  if (!this.page) throw new Error('Browser not initialized');

  e2eLogger.info(`[UI] Waiting for element "${selector}" to disappear`);

  await this.page.waitForSelector(selector, {
    state: 'hidden',
  });

  e2eLogger.info(`[UI] Element "${selector}" disappeared`);
});

When(
  'I click on the project with name {string}',
  async function (this: CustomWorld, projectName: string) {
    if (!this.page) throw new Error('Browser not initialized');

    let resolvedName = projectName;
    const userMatch = projectName.match(/user:([^.]+)\.([^,\s-]+)/);
    if (userMatch) {
      const [fullMatch, browserSession, field] = userMatch;
      for (const [, userData] of this.userData) {
        if (userData.browserSession === browserSession) {
          resolvedName = projectName.replace(
            fullMatch,
            userData[field as keyof typeof userData] as string
          );
          break;
        }
      }
      if (resolvedName === projectName) {
        throw new Error(`No user found logged in browser session "${browserSession}"`);
      }
    }

    e2eLogger.info(`[Project] Looking for project with name: "${resolvedName}"`);

    const projectItem = this.page.locator(`[data-project-name="${resolvedName}"]`);

    await projectItem.waitFor({ state: 'visible', timeout: 10000 });
    await projectItem.click();

    e2eLogger.info(`[Project] Clicked on project "${resolvedName}"`);
  }
);

When('I click on the first board in the expanded project', async function (this: CustomWorld) {
  if (!this.page) throw new Error('Browser not initialized');

  // Wait for board items to be visible (they appear after project is expanded)
  const boardItem = this.page.locator('[data-testid^="board-item-"]').first();
  await boardItem.waitFor({ state: 'visible', timeout: 10000 });

  await boardItem.click();

  e2eLogger.info('[Project] Clicked on the first board in the expanded project');
});

// ============================================
// API Response Steps
// ============================================

// Api Response Management
When(
  'I click the button with text {string} then wait for {string} request to be triggered and capture the response',
  async function (this: CustomWorld, buttonText: string, endpoint: string) {
    if (!this.page) throw new Error('Browser not initialized');

    e2eLogger.info(`[API] Waiting for request to: ${endpoint}`);

    const responsePromise = this.page.waitForResponse(
      (response) => response.url().includes(endpoint) && response.request().method() === 'POST'
    );

    await this.page.click(`button:has-text("${buttonText}")`);

    const response = await responsePromise;
    const responseBody = await response.json().catch(() => null);

    this.capturedResponse = {
      status: response.status(),
      statusText: response.statusText(),
      headers: response.headers(),
      body: responseBody,
      url: response.url(),
    } as CapturedApiResponse;

    e2eLogger.info(
      `[API] Captured response from ${endpoint}: ${this.capturedResponse.status} ${this.capturedResponse.statusText}`
    );
  }
);

// Api Assertions
Then(
  'the captured response status should be {int}',
  async function (this: CustomWorld, statusCode: number) {
    expect(this.capturedResponse).to.not.be.undefined;
    expect(this.capturedResponse!.status).to.equal(statusCode);
    e2eLogger.info(`[API] Verified response status: ${statusCode}`);
  }
);

Then(
  'the captured response should be {responseFormat}',
  async function (this: CustomWorld, format: ResponseFormat) {
    expect(this.capturedResponse).to.not.be.undefined;
    expect(this.capturedResponse!.body).to.not.be.null;

    switch (format) {
      case 'json':
        expect(this.capturedResponse!.body).to.be.an('object');
        expect(this.capturedResponse!.body).to.not.be.an('array');
        e2eLogger.info('[API] Verified response is JSON object');
        break;
      case 'array':
        expect(this.capturedResponse!.body).to.be.an('array');
        e2eLogger.info('[API] Verified response is array');
        break;
      case 'string':
        expect(this.capturedResponse!.body).to.be.a('string');
        e2eLogger.info('[API] Verified response is string');
        break;
      default:
        throw new Error(`Unsupported response format: ${format}`);
    }
  }
);

Then(
  'the captured response should contain property {string}',
  async function (this: CustomWorld, property: string) {
    expect(this.capturedResponse).to.not.be.undefined;
    expect(this.capturedResponse!.body).to.not.be.null;
    expect(this.capturedResponse!.body).to.have.property(property);
    e2eLogger.info(`[API] Verified response has property: ${property}`);
  }
);

// ============================================
// User Data Storage Steps
// ============================================

Then(
  'the user data should be stored in global context as {string}',
  async function (this: CustomWorld, userName: string) {
    expect(this.capturedResponse).to.not.be.undefined;
    expect(this.capturedResponse!.body).to.not.be.null;
    expect(this.capturedResponse!.body).to.have.property('user');

    const responseBody = this.capturedResponse!.body!;
    const user = responseBody.user!;
    const sessionId = responseBody.sessionId!;

    if (!this.activeContextName || !this.context || !this.page) {
      throw new Error('Browser session not initialized');
    }

    this.userData.set(userName, {
      id: user.id,
      email: user.email,
      name: user.name,
      isNewUser: user.isNewUser,
      sessionId: sessionId,
      browserSession: this.activeContextName,
      context: this.context,
      page: this.page,
    });

    e2eLogger.info(
      `[User Data] Stored user data for "${userName}": ${user.email} (Browser: ${this.activeContextName})`
    );
  }
);
