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

    testContext.lastResponse = null;

    await context.clearCookies();

    // Every scenario starts with a fresh BrowserContext, so about:blank cannot
    // contain auth state. Avoid loading the full auth page here; the following
    // login or protected-route step performs the only navigation the scenario
    // needs. Relogin flows can already access the dashboard origin and must also
    // clear its client-side state.
    if (page.url().startsWith(config.dashboard.baseUrl)) {
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
    }
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
