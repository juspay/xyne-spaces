import assert from 'node:assert/strict';
import { Step } from 'gauge-ts';
import { config } from '@/config';
import { testContext } from '@/tests/shared/runtime/test-context';
import { assertValidUrlPath } from '@/tests/shared/support/literal-validation';

export default class E2eCommonSteps {
  @Step('ensuring user is not logged in')
  public async ensureNotLoggedIn(): Promise<void> {
    const page = testContext.activePage;
    const context = testContext.currentSession.context;
    const authUrl = `${config.dashboard.baseUrl}/auth`;

    testContext.lastResponse = null;

    await context.clearCookies();
    try {
      await page.goto(authUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60000, // Increased timeout to 60s
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('ERR_ABORTED')) {
        throw error;
      }

      await page.waitForURL(`**/auth**`);
    }

    await page.waitForLoadState('domcontentloaded');

    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  }

  @Step('verifying user is redirected to <urlPath>')
  public async assertRedirectToPath(urlPath: string): Promise<void> {
    assertValidUrlPath(urlPath);
    const page = testContext.activePage;

    if (urlPath.endsWith('/*')) {
      const prefix = urlPath.slice(0, -2);
      // Longer timeout for parallel test execution under resource contention
      await page.waitForURL(`**${prefix}**`, { timeout: 60000 });
      const actualPath = new URL(page.url()).pathname;
      assert.ok(
        actualPath === prefix ||
          actualPath.startsWith(`${prefix}/`) ||
          actualPath.endsWith(prefix) ||
          actualPath.includes(`${prefix}/`),
        `Expected path to be "${prefix}" or start with "${prefix}/", got "${actualPath}"`
      );
      return;
    }

    // Longer timeout for parallel test execution under resource contention
    await page.waitForURL(`**${urlPath}**`, { timeout: 60000 });
    const currentUrl = new URL(page.url());
    const actualPath = currentUrl.pathname;
    assert.ok(
      actualPath === urlPath || actualPath.endsWith(urlPath),
      `Expected to be redirected to ${urlPath}, got ${actualPath}`
    );
  }
}
