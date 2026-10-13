import assert from 'node:assert/strict';
import type { Locator } from '@playwright/test';
import { config } from '@/config';
import { getStoredUser } from '@/fixtures/fixture-helpers';
import { getUserCatalogEntry } from '@/fixtures/user-catalog';
import { getStoredChannelId } from '@/tests/03_e2e/11_xyne-desk/xyne-desk-api';
import { DESK_UI_TIMEOUT_MS } from '@/tests/03_e2e/11_xyne-desk/xyne-desk-state';
import { testContext } from '@/tests/shared/runtime/test-context';
import { mirrorBackendAuthCookiesToDashboard } from '@/tests/shared/support/auth-cookies';
import { assertValidUserAlias } from '@/tests/shared/support/literal-validation';

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Page + locator helpers
// ---------------------------------------------------------------------------

async function waitForDeskPageToSettle(): Promise<void> {
  const page = testContext.activePage;
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}

/** Navigates the active page to `url` and waits for the Desk page to settle. */
export async function gotoDeskUrl(url: string): Promise<void> {
  await testContext.activePage.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: DESK_UI_TIMEOUT_MS,
  });
  await waitForDeskPageToSettle();
}

export async function waitForVisible(locator: Locator): Promise<void> {
  await locator.waitFor({ state: 'visible', timeout: DESK_UI_TIMEOUT_MS });
}

export async function clickWhenVisible(locator: Locator): Promise<void> {
  await waitForVisible(locator);
  await locator.click();
}

async function isVisible(locator: Locator, timeout: number): Promise<boolean> {
  try {
    await locator.waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Browser auth
// ---------------------------------------------------------------------------

async function hasDashboardAuthCookieForWorkspace(workspaceId: string): Promise<boolean> {
  const cookies = await testContext.currentSession.context.cookies(config.dashboard.baseUrl);
  return cookies.some((cookie) => cookie.name === `xyne_ws_${workspaceId}_token` && cookie.value);
}

async function clearDeskBrowserAuthState(): Promise<void> {
  const page = testContext.activePage;
  const context = testContext.currentSession.context;

  await page
    .goto(`${config.dashboard.baseUrl}/auth`, {
      waitUntil: 'domcontentloaded',
      timeout: DESK_UI_TIMEOUT_MS,
    })
    .catch(() => undefined);
  await context.clearCookies();
  try {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  } catch {
    // The next test-auth call writes fresh auth cookies; storage cleanup is best-effort.
  }
}

async function assertDashboardAuthCookieForWorkspace(
  workspaceId: string,
  userAlias: string
): Promise<void> {
  if (await hasDashboardAuthCookieForWorkspace(workspaceId)) return;

  const cookieNames = (
    await testContext.currentSession.context.cookies(config.dashboard.baseUrl)
  ).map((cookie) => cookie.name);
  throw new Error(
    `Desk browser auth for "${userAlias}" did not create xyne_ws_${workspaceId}_token on dashboard origin. Cookies: ${cookieNames.join(', ')}`
  );
}

async function ensureBrowserAuthenticatedForDesk(
  userAlias: string,
  options: { force?: boolean } = {}
): Promise<void> {
  assertValidUserAlias(userAlias);
  const storedUser = getStoredUser(userAlias);
  assert.ok(storedUser.workspaceId, `Expected user "${userAlias}" to have a workspaceId.`);

  if (!options.force && (await hasDashboardAuthCookieForWorkspace(storedUser.workspaceId))) {
    return;
  }

  if (options.force) {
    await clearDeskBrowserAuthState();
  }

  const catalogUser = getUserCatalogEntry(userAlias);
  const params = new URLSearchParams({
    email: catalogUser.email,
    setAsNewUser: 'false',
  });

  const response = await testContext.currentSession.context.request.post(
    `${config.backend.baseUrl}/api/test/auth/login?${params.toString()}`,
    {
      data: {},
      timeout: DESK_UI_TIMEOUT_MS,
    }
  );

  if (!response.ok()) {
    const responseBody = await response.text().catch(() => '');
    throw new Error(
      `Desk browser auth for "${userAlias}" failed with status ${response.status()}. Body: ${responseBody}`
    );
  }

  await mirrorBackendAuthCookiesToDashboard(testContext.currentSession.context, response);
  await assertDashboardAuthCookieForWorkspace(storedUser.workspaceId, userAlias);
}

// ---------------------------------------------------------------------------
// Desk navigation
// ---------------------------------------------------------------------------

function getSupportPage(): Locator {
  return testContext.activePage.locator("[data-testid='support-page']");
}

/** Opens a stored Desk channel, falling back to fresh auth and the channel list. */
export async function openStoredDeskChannelUrl(
  channelAlias: string,
  userAlias: string
): Promise<void> {
  const channelId = getStoredChannelId(channelAlias, userAlias);
  const user = getStoredUser(userAlias);
  const channelName = user.channels[channelAlias]?.name ?? channelAlias;

  await ensureBrowserAuthenticatedForDesk(userAlias);

  const workspacePrefix = user.workspaceId ? `/${user.workspaceId}` : '';
  const url = `${config.dashboard.baseUrl}${workspacePrefix}/support/${channelId}`;
  const supportInboxUrl = `${config.dashboard.baseUrl}${workspacePrefix}/support/all`;
  const page = testContext.activePage;
  const supportPage = getSupportPage();

  const openSupportPage = async (): Promise<void> => {
    await gotoDeskUrl(url);
    if (page.url().includes('/auth')) {
      throw new Error(`Direct Desk channel open redirected to auth. Current URL: ${page.url()}`);
    }
    await waitForVisible(supportPage);
  };

  const openSupportViaChannelList = async (): Promise<void> => {
    await gotoDeskUrl(supportInboxUrl);
    if (page.url().includes('/auth')) {
      await ensureBrowserAuthenticatedForDesk(userAlias, { force: true });
      await gotoDeskUrl(supportInboxUrl);
    }
    await waitForVisible(supportPage);

    const channelRow = page
      .locator('[data-testid="desk-channel-row"]')
      .filter({ hasText: channelName })
      .first();

    if (!(await isVisible(channelRow, DESK_UI_TIMEOUT_MS))) {
      throw new Error(
        `Desk channel row "${channelName}" was not visible on Support page. Current URL: ${page.url()}`
      );
    }

    await channelRow.click();
    await page
      .waitForURL(new RegExp(`/support/${escapeRegExp(channelId)}(?:[/?#]|$)`), {
        timeout: DESK_UI_TIMEOUT_MS,
      })
      .catch(() => undefined);
    await waitForDeskPageToSettle();
    await waitForVisible(supportPage);
  };

  const openSupportWithNavigationFallback = async (directError: unknown): Promise<void> => {
    const firstErrorMessage =
      directError instanceof Error ? directError.message : String(directError);
    try {
      await openSupportViaChannelList();
    } catch (fallbackError) {
      const fallbackMessage =
        fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(
        `Support page did not render for channel "${channelAlias}" user "${userAlias}". Current URL: ${page.url()}. Direct open failed: ${firstErrorMessage}. Navigation fallback failed: ${fallbackMessage}`
      );
    }
  };

  const openSupportWithFreshAuth = async (): Promise<void> => {
    await ensureBrowserAuthenticatedForDesk(userAlias, { force: true });
    try {
      await openSupportPage();
    } catch (error) {
      await openSupportWithNavigationFallback(error);
    }
  };

  try {
    await openSupportPage();
  } catch (error) {
    if (page.url().includes('/auth')) {
      await openSupportWithFreshAuth();
      return;
    }

    await openSupportWithNavigationFallback(error);
  }
}

/** Opens the stored channel and the ticket whose subject is visible in its list. */
export async function openDeskTicketBySubject(
  channelAlias: string,
  userAlias: string,
  subject: string
): Promise<void> {
  await openStoredDeskChannelUrl(channelAlias, userAlias);
  await testContext.activePage.getByText(subject, { exact: false }).first().click();
}

// ---------------------------------------------------------------------------
// Email composer
// ---------------------------------------------------------------------------

// The ticket page also hosts the internal-thread chat editor, so a bare
// [contenteditable] can resolve to it. Scope to the innermost container that
// holds both an editor and the "Send email" button: the email composer.
export function getDeskEmailComposer(): Locator {
  const page = testContext.activePage;
  return page
    .locator('div')
    .filter({ has: page.getByRole('button', { name: 'Send email' }) })
    .filter({ has: page.locator('[contenteditable="true"]') })
    .last();
}

/** Waits for the composer and focuses its editor. */
export async function focusDeskEmailComposerEditor(): Promise<Locator> {
  const composer = getDeskEmailComposer();
  await waitForVisible(composer);
  const editor = composer.locator('[contenteditable="true"]').last();
  await editor.click();
  return editor;
}

export async function sendDeskEmailFromComposer(body: string): Promise<void> {
  const editor = await focusDeskEmailComposerEditor();
  await editor.fill(body);
  await getDeskEmailComposer().getByRole('button', { name: 'Send email' }).last().click();
}

// Reply / Reply all anchor recipients on the email they are opened from. Older
// emails carry their own per-email actions (behind a collapsed header); the
// latest email only has the footer reply pill, which anchors on it (Gmail
// semantics). Choosing a mode from the pill's menu sets the mode and opens the
// composer (ReplyPill.selectMode).
export async function openDeskReplyComposer(
  mode: 'Reply' | 'Reply all',
  externalMessageId?: string
): Promise<void> {
  const page = testContext.activePage;
  if (externalMessageId) {
    const card = page.locator(`[data-external-message-id="${externalMessageId}"]`).first();
    await waitForVisible(card);
    const expand = card.locator('[data-track-name="ExpandEmail"]').first();
    if ((await expand.count()) > 0) await expand.click();
    const trackName = mode === 'Reply' ? 'ReplyToSpecificEmail' : 'ReplyAllToSpecificEmail';
    const emailAction = card.locator(`[data-track-name="${trackName}"]`).first();
    if ((await emailAction.count()) > 0) {
      await emailAction.click();
      return;
    }
  }
  await clickWhenVisible(page.locator('[data-track-name="ReplyPillModeDropdown"]').first());
  await page.getByRole('menuitem', { name: mode, exact: true }).click();
}
