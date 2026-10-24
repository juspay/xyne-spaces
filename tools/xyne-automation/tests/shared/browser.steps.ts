import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { Step } from 'gauge-ts';
import { config } from '@/config';
import { buildRandomSuffix, getStoredUser } from '@/fixtures/fixture-helpers';
import { type StoredConversation, testContext } from '@/tests/shared/runtime/test-context';
import {
  ensureBrowserSession,
  ensureNamedBrowserSession,
} from '@/tests/shared/support/browser-manager';
import {
  assertValidBrowserName,
  assertValidChannelAlias,
  assertValidDmAlias,
  assertValidMessageAlias,
  assertValidProjectAlias,
  assertValidTicketAlias,
  assertValidUrlPath,
  assertValidUserAlias,
} from '@/tests/shared/support/literal-validation';
import { clickHoverActionOnMessage as hoverAndClickActionOnMessage } from '@/tests/shared/support/message-hover';

function resolvePathValue(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((currentValue, segment) => {
    if (!currentValue || typeof currentValue !== 'object') {
      return undefined;
    }

    return (currentValue as Record<string, unknown>)[segment];
  }, source);
}

function resolveStoredText(text: unknown): string {
  return String(text).replace(/user:([^.,\s]+)(?:\.([^,\s]+(?:\.[^,\s]+)*))/g, (_, key, field) => {
    const user = testContext.storedUsers.get(key);
    if (!user) {
      throw new Error(`No stored user found for alias "${key}".`);
    }

    if (!field) {
      throw new Error(`Missing stored user field for alias "${key}".`);
    }

    const value = resolvePathValue(user, field);
    if (value === undefined) {
      throw new Error(`Invalid stored user field "${field}" for alias "${key}".`);
    }

    return String(value);
  });
}

function resolveStoredMessageText(
  userAlias: string,
  conversationKind: 'channels' | 'dms',
  conversationAlias: string,
  messageAlias: string
): string {
  return resolveStoredText(
    `user:${userAlias}.${conversationKind}.${conversationAlias}.messages.${messageAlias}.text`
  );
}

// Every chat message bubble inside the first <selector> match. Scope matters: a thread's
// root message renders both in the channel list and in the open thread panel.
function messageBubblesIn(selector: string): Locator {
  return testContext.activePage.locator(selector).first().locator('[data-testid^="chat-message-"]');
}

function messageBubbleIn(selector: string, messageText: string): Locator {
  return testContext.activePage
    .locator(selector)
    .first()
    .locator(`[data-testid^="chat-message-"]:has-text("${messageText}")`)
    .last();
}

// Parses step args written as `key=value, key=value` into a request body. Values resolve
// `user:<alias>.<path>` stored text; `$uuid` and `$now` generate an id and a timestamp;
// `true`/`false` become booleans; `[a|b]` becomes an array of resolved values.
function parseStepArgs(args: string): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (args.trim() === '') return body;
  for (const pair of args.split(/,\s+/)) {
    const separator = pair.indexOf('=');
    assert.ok(separator > 0, `Expected "key=value" in step args, got "${pair}".`);
    const key = pair.slice(0, separator).trim();
    const raw = pair.slice(separator + 1).trim();
    body[key] =
      raw.startsWith('[') && raw.endsWith(']')
        ? raw
            .slice(1, -1)
            .split('|')
            .filter((item) => item.length > 0)
            .map(parseStepArgValue)
        : parseStepArgValue(raw);
  }
  return body;
}

function parseStepArgValue(raw: string): unknown {
  if (raw === '$uuid') return randomUUID();
  if (raw === '$now') return Date.now();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return resolveStoredText(raw);
}

function getStoredConversation(
  userAlias: string,
  conversationKind: 'channels' | 'dms',
  conversationAlias: string
): StoredConversation {
  const conversation = getStoredUser(userAlias)[conversationKind][conversationAlias];
  assert.ok(
    conversation?.id,
    `Expected stored ${conversationKind} "${conversationAlias}" with an id for user "${userAlias}".`
  );
  return conversation;
}

// Uploads a fixture file to the draft-attachment endpoint as the active browser's user,
// with a caller-chosen attachment id (the endpoint keys the upload on it).
async function uploadDraftAttachment(
  channelId: string,
  fileName: string,
  attachmentId: string
): Promise<void> {
  const filePath = path.join(FIXTURE_FILES_DIR, fileName);
  assert.ok(
    fs.existsSync(filePath),
    `Fixture file "${fileName}" not found in ${FIXTURE_FILES_DIR}.`
  );
  testContext.lastResponse = await testContext.activePage.request.post(
    `${config.dashboard.baseUrl}/api/drafts/attachments/upload`,
    {
      multipart: {
        channelId,
        draftMessageId: randomUUID(),
        attachmentIds: JSON.stringify([attachmentId]),
        files: { name: fileName, mimeType: 'text/plain', buffer: fs.readFileSync(filePath) },
      },
      timeout: 60000,
    }
  );
}

// Sample uploads (image, video, PDF, ...) checked into the automation package.
const FIXTURE_FILES_DIR = path.resolve(__dirname, '../../fixtures/files');

const SIDEBAR_NAVIGATION_TIMEOUT_MS = 10000;

async function getSidebarDestinationPath(page: Page, item: Locator): Promise<string> {
  const href = await item.getAttribute('href');
  assert.ok(href, 'Expected sidebar navigation item to have an href.');

  return new URL(href, page.url()).pathname;
}

// Pins a "More" overflow item to the sidebar toolbar through
// More -> Customize toolbar -> Preferences > Toolbar -> "+ Add".
// Toolbar items are stored in localStorage, so this only affects the current
// browser context and is safe for parallel scenarios.
async function addSidebarItemToToolbar(
  page: Page,
  moreTrigger: Locator,
  itemId: string
): Promise<void> {
  await moreTrigger.click();
  const moreItem = page.locator(`[data-testid='more-${itemId}']`).first();
  try {
    await moreItem.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    throw new Error(
      `Sidebar item "${itemId}" is neither on the toolbar (nav-${itemId}) nor under ` +
        `"More" (more-${itemId}). It may have moved into another screen.`
    );
  }
  const togglePath = await getMoreItemPath(moreItem, itemId);

  await page.locator("[data-testid='more-customize-toolbar']").click();
  const preferences = page.getByRole('dialog', { name: 'Preferences' });
  await preferences.waitFor({ state: 'visible' });

  // "Available" rows tag their "+ Add" button with the item's toolbar path.
  const addButton = preferences.locator(
    `button[data-track-name='AddBarItem'][data-track-metadata*='"id":"${togglePath}"']`
  );
  await addButton.click();
  await expect(addButton).toBeHidden();

  await page.keyboard.press('Escape');
  await preferences.waitFor({ state: 'hidden' });
}

// "More" items carry their toolbar path in data-track-metadata ({"path": ...}).
async function getMoreItemPath(moreItem: Locator, itemId: string): Promise<string> {
  const metadata = await moreItem.getAttribute('data-track-metadata');
  assert.ok(metadata, `Expected "More" item "${itemId}" to have data-track-metadata.`);
  const parsed: unknown = JSON.parse(metadata);
  const togglePath =
    typeof parsed === 'object' && parsed !== null && 'path' in parsed ? parsed.path : undefined;
  assert.ok(
    typeof togglePath === 'string' && togglePath.length > 0,
    `Expected "More" item "${itemId}" metadata to contain a path, got ${metadata}.`
  );
  return togglePath;
}

// Some destinations redirect to a child route (e.g. /chat/dir -> /chat/dir/<id>).
async function waitForPath(page: Page, expectedPath: string): Promise<void> {
  await page.waitForURL(
    (url) => url.pathname === expectedPath || url.pathname.startsWith(`${expectedPath}/`),
    {
      timeout: SIDEBAR_NAVIGATION_TIMEOUT_MS,
    }
  );
}

// Navigates through a sidebar toolbar link, first pinning it to the toolbar
// when it currently lives in the "More" overflow.
async function navigateViaSidebar(page: Page, itemId: string): Promise<void> {
  // Wait for the sidebar to be mounted before deciding toolbar vs overflow.
  const moreTrigger = page.locator("[data-testid='nav-more']").first();
  await moreTrigger.waitFor({ state: 'visible' });

  // Scope to links: the bottom Support popover button also uses nav-support.
  const toolbarItem = page.locator(`a[data-testid='nav-${itemId}']`).first();
  if (!(await toolbarItem.isVisible())) {
    await addSidebarItemToToolbar(page, moreTrigger, itemId);
    await toolbarItem.waitFor({ state: 'visible' });
  }

  const expectedPath = await getSidebarDestinationPath(page, toolbarItem);
  await toolbarItem.click();
  await waitForPath(page, expectedPath);
}

export default class BrowserSteps {
  // ===========================================
  // BROWSER SESSION
  // ===========================================

  @Step('using browser')
  public async useBrowser(): Promise<void> {
    await ensureBrowserSession(1280, 720, config.browser);
  }

  @Step('using a browser with viewport <width>x<height> in <browserType>')
  public async createOrUseBrowser(
    width: string,
    height: string,
    browserType: 'chromium' | 'chrome' | 'firefox' | 'webkit'
  ): Promise<void> {
    await ensureBrowserSession(Number(width), Number(height), browserType);
  }

  @Step('switching to temp browser <browserName>')
  @Step('Switching to temp browser <browserName>')
  public async switchToBrowser(browserName: string): Promise<void> {
    assertValidBrowserName(browserName);
    await ensureNamedBrowserSession(browserName, 1280, 720, config.browser);
  }

  @Step('switching to main browser')
  @Step('Switching to main browser')
  public async switchToMainBrowser(): Promise<void> {
    await ensureBrowserSession(1280, 720, config.browser);
  }

  @Step('using a browser with viewport <width>x<height>')
  public async createOrUseBrowserWithConfig(width: string, height: string): Promise<void> {
    await ensureBrowserSession(Number(width), Number(height), config.browser);
  }

  // ===========================================
  // NAVIGATION
  // ===========================================

  @Step('opening <urlPath>')
  public async openPage(urlPath: string): Promise<void> {
    assertValidUrlPath(urlPath);
    const page = testContext.activePage;
    const targetUrl = `${config.dashboard.baseUrl}${urlPath}`;
    await page.goto(targetUrl);
    await page.waitForLoadState('domcontentloaded');
  }

  @Step('opening stored path <storedPath>')
  public async openStoredPath(storedPath: string): Promise<void> {
    const resolvedPath = resolveStoredText(`user:${storedPath}`);
    const page = testContext.activePage;
    const targetUrl = /^https?:\/\//.test(resolvedPath)
      ? resolvedPath
      : `${config.dashboard.baseUrl}${resolvedPath}`;
    await page.goto(targetUrl);
    await page.waitForLoadState('domcontentloaded');
  }

  @Step('opening Xyne-Space at <urlPath>')
  public async openXyneSpace(urlPath: string): Promise<void> {
    const page = testContext.activePage;
    assertValidUrlPath(urlPath);
    const targetUrl = `${config.dashboard.baseUrl}${urlPath}`;

    // 60s timeout: under heavy CI load the dashboard's `load` event can
    // take longer than the default 30s for protected routes that redirect.
    // Use domcontentloaded — heavy pages (e.g. SupportScreen with realtime
    // hooks) keep the network busy indefinitely, so networkidle never fires.
    // The test verifies the post-redirect URL afterwards, which is what matters.
    await page.goto(targetUrl, { timeout: 60000 });
    await page.waitForLoadState('domcontentloaded');
  }

  // ===========================================
  // WAITING
  // ===========================================

  @Step('waiting for <seconds> seconds')
  public async waitForSeconds(seconds: string): Promise<void> {
    const ms = Number(seconds) * 1000;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  @Step('waiting for <milliseconds> milliseconds')
  public async waitForMilliseconds(ms: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, Number(ms)));
  }

  @Step('waiting for <selector> to disappear')
  public async waitForSelectorToDisappear(selector: string): Promise<void> {
    await testContext.activePage.locator(selector).first().waitFor({
      state: 'hidden',
    });
  }

  @Step('waiting for <selector> to disappear fast')
  public async waitForSelectorToDisappearFast(selector: string): Promise<void> {
    await testContext.activePage.locator(selector).first().waitFor({
      state: 'hidden',
      timeout: 10000, // 10s instead of 30s default - loading indicators should disappear quickly
    });
  }

  @Step('clicking on text <text> in <selector>')
  public async clickOnTextInSelector(text: string, selector: string): Promise<void> {
    const resolvedText = resolveStoredText(text);
    const containers = testContext.activePage.locator(selector);

    await containers.first().waitFor({ state: 'visible' });
    // Search every matching container, not just the first: with prefix
    // selectors (e.g. [data-testid^='project-card-']) the target text may
    // live in any of the matched elements.
    await containers.getByText(resolvedText, { exact: false }).first().click();
  }

  @Step('clicking on text <text>')
  public async clickOnText(text: string): Promise<void> {
    const resolvedText = resolveStoredText(text);

    await testContext.activePage.getByText(resolvedText, { exact: false }).first().click();
  }

  @Step('clicking button with text <text>')
  public async clickButtonByText(text: string): Promise<void> {
    const resolvedText = resolveStoredText(text);

    await testContext.activePage.getByRole('button', { name: resolvedText }).first().click();
  }

  @Step('clicking on <selector>')
  public async clickOnSelector(selector: string): Promise<void> {
    const element = testContext.activePage.locator(selector).first();
    await element.waitFor({ state: 'visible' });
    try {
      await element.click({ timeout: 5000 });
    } catch (_error) {
      // Backdrop animations or intercepting overlays sometimes block the click;
      // wait for potential overlays to disappear, then retry with force once.
      const overlays = testContext.activePage.locator(
        '[role="dialog"], .backdrop, [data-radix-focus-guard]'
      );
      const overlayCount = await overlays.count();
      if (overlayCount > 0) {
        await overlays
          .first()
          .waitFor({ state: 'hidden', timeout: 2000 })
          .catch(() => {});
      }
      await element.click({ force: true });
    }
  }

  @Step('navigating via sidebar to <itemId>')
  public async navigateViaSidebar(itemId: string): Promise<void> {
    await navigateViaSidebar(testContext.activePage, itemId);
  }

  @Step('typing <text> in <selector>')
  public async typeOnElement(text: string, selector: string): Promise<void> {
    const resolvedText = resolveStoredText(text);
    const element = testContext.activePage.locator(selector).first();
    await element.waitFor({ state: 'visible' });
    await element.fill(resolvedText);
  }

  // Real keystrokes appended at the caret: unlike `fill`, they fire the editor's
  // input handlers, so typing "@name" opens the mention picker.
  @Step('typing <text> key by key in <selector>')
  public async typeKeyByKeyOnElement(text: string, selector: string): Promise<void> {
    const resolvedText = resolveStoredText(text);
    const element = testContext.activePage.locator(selector).first();
    await element.waitFor({ state: 'visible' });
    await element.pressSequentially(resolvedText);
  }

  @Step('typing stored user <userAlias> project <projectAlias> field <fieldName> in <selector>')
  public async typeStoredUserProjectField(
    userAlias: string,
    projectAlias: string,
    fieldName: string,
    selector: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidProjectAlias(projectAlias);
    const text = `user:${userAlias}.projects.${projectAlias}.${fieldName}`;
    const resolvedText = resolveStoredText(text);
    const element = testContext.activePage.locator(selector).first();
    await element.waitFor({ state: 'visible' });
    await element.fill(resolvedText);
  }

  @Step('typing stored user <userAlias> ticket <ticketAlias> field <fieldName> in <selector>')
  public async typeStoredUserTicketField(
    userAlias: string,
    ticketAlias: string,
    fieldName: string,
    selector: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidTicketAlias(ticketAlias);
    const text = `user:${userAlias}.tickets.${ticketAlias}.${fieldName}`;
    const resolvedText = resolveStoredText(text);
    const element = testContext.activePage.locator(selector).first();
    await element.waitFor({ state: 'visible' });
    await element.fill(resolvedText);
  }

  @Step('typing stored user <userAlias> field <fieldName> in <selector>')
  public async typeStoredUserField(
    userAlias: string,
    fieldName: string,
    selector: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    const text = `user:${userAlias}.${fieldName}`;
    const resolvedText = resolveStoredText(text);
    const element = testContext.activePage.locator(selector).first();
    await element.waitFor({ state: 'visible' });
    await element.fill(resolvedText);
  }

  @Step('clicking on stored user <userAlias> field <fieldName> in <selector>')
  public async clickOnStoredUserFieldInSelector(
    userAlias: string,
    fieldName: string,
    selector: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    const text = `user:${userAlias}.${fieldName}`;
    const resolvedText = resolveStoredText(text);
    const container = testContext.activePage.locator(selector).first();
    await container.waitFor({ state: 'visible' });
    await container.getByText(resolvedText, { exact: false }).first().click();
  }

  @Step('typing stored user <userAlias> channel <channelAlias> field <fieldName> in <selector>')
  public async typeStoredUserChannelField(
    userAlias: string,
    channelAlias: string,
    fieldName: string,
    selector: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidChannelAlias(channelAlias);
    const text = `user:${userAlias}.channels.${channelAlias}.${fieldName}`;
    const resolvedText = resolveStoredText(text);
    const element = testContext.activePage.locator(selector).first();
    await element.waitFor({ state: 'visible' });
    await element.fill(resolvedText);
  }

  @Step('typing stored user <userAlias> dm <dmAlias> message <messageAlias> in <selector>')
  public async typeStoredUserDmMessage(
    userAlias: string,
    dmAlias: string,
    messageAlias: string,
    selector: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidDmAlias(dmAlias);
    assertValidMessageAlias(messageAlias);
    const text = `user:${userAlias}.dms.${dmAlias}.messages.${messageAlias}.text`;
    const resolvedText = resolveStoredText(text);
    const element = testContext.activePage.locator(selector).first();
    await element.waitFor({ state: 'visible' });
    await element.fill(resolvedText);
  }

  @Step(
    'typing stored user <userAlias> channel <channelAlias> message <messageAlias> in <selector>'
  )
  public async typeStoredUserChannelMessage(
    userAlias: string,
    channelAlias: string,
    messageAlias: string,
    selector: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidChannelAlias(channelAlias);
    assertValidMessageAlias(messageAlias);
    const text = `user:${userAlias}.channels.${channelAlias}.messages.${messageAlias}.text`;
    const resolvedText = resolveStoredText(text);
    const element = testContext.activePage.locator(selector).first();
    await element.waitFor({ state: 'visible' });
    await element.fill(resolvedText);
  }

  @Step('clearing <selector>')
  public async clearElement(selector: string): Promise<void> {
    const element = testContext.activePage.locator(selector).first();
    await element.waitFor({ state: 'visible' });
    await element.fill('');
  }

  @Step('pressing <key>')
  public async pressKey(key: string): Promise<void> {
    await testContext.activePage.keyboard.press(key);
  }

  @Step('scrolling to bottom of <selector>')
  public async scrollToBottomOfSelector(selector: string): Promise<void> {
    const page = testContext.activePage;
    const element = page.locator(selector).first();
    await element.waitFor({ state: 'visible' });

    // Scroll to bottom using JavaScript and wait for scroll to complete
    await page.evaluate((sel: string) => {
      // @ts-expect-error - document exists in browser context
      const virtuoso = document.querySelector(sel);
      if (virtuoso) {
        virtuoso.scrollTop = virtuoso.scrollHeight;
        // Force a reflow to ensure scroll has happened
        void virtuoso.scrollTop;
      }
    }, selector);

    // Wait for scroll position to stabilize (virtuoso updates scrollTop asynchronously)
    await page.waitForFunction(
      (sel: string) => {
        // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where document exists
        // @ts-ignore - document exists in browser context
        const virtuoso = document.querySelector(sel);
        if (!virtuoso) return false;
        // Check if we're at the bottom (within 10px tolerance)
        return virtuoso.scrollHeight - virtuoso.scrollTop - virtuoso.clientHeight < 10;
      },
      selector,
      { timeout: 5000 }
    );
  }

  @Step('waiting for <selector> to be enabled')
  public async waitForSelectorToBeEnabled(selector: string): Promise<void> {
    await testContext.activePage.locator(selector).first().waitFor({ state: 'visible' });
    await expect(testContext.activePage.locator(selector).first()).toBeEnabled();
  }

  @Step('waiting for <selector> to appear')
  public async waitForSelectorToAppear(selector: string): Promise<void> {
    await testContext.activePage.locator(selector).first().waitFor({
      state: 'visible',
    });
  }

  @Step('waiting for <selector> to appear fast')
  public async waitForSelectorToAppearFast(selector: string): Promise<void> {
    await testContext.activePage.locator(selector).first().waitFor({
      state: 'visible',
      timeout: 10000, // 10s instead of 30s default - UI elements should appear quickly
    });
  }

  @Step('waiting up to <seconds> seconds for <selector> to appear')
  public async waitForSelectorToAppearWithin(seconds: string, selector: string): Promise<void> {
    await testContext.activePage
      .locator(selector)
      .first()
      .waitFor({
        state: 'visible',
        timeout: Number(seconds) * 1000,
      });
  }

  @Step('pressing <key> if <selector> is visible')
  public async pressKeyIfVisible(key: string, selector: string): Promise<void> {
    const page = testContext.activePage;
    const element = page.locator(selector).first();
    try {
      await element.waitFor({ state: 'visible', timeout: 5000 });
      await page.keyboard.press(key);
      await element.waitFor({ state: 'hidden', timeout: 5000 });
    } catch {
      // Element not visible — skip
    }
  }

  @Step('clicking on selector <selector> with text <text> if visible')
  public async clickSelectorWithTextIfVisible(selector: string, text: string): Promise<void> {
    const page = testContext.activePage;
    try {
      const element = page.locator(selector).filter({ hasText: text }).first();
      await element.waitFor({ state: 'visible', timeout: 5000 });
      await element.click();
    } catch {
      // Element not visible — skip
    }
  }

  @Step('clicking on <selector> if visible')
  public async clickOnSelectorIfVisible(selector: string): Promise<void> {
    const element = testContext.activePage.locator(selector).first();
    try {
      await element.waitFor({ state: 'visible', timeout: 5000 });
      await element.click();
    } catch {
      // Element not visible — skip
    }
  }

  @Step('waiting for network to be idle')
  public async waitForNetworkIdle(): Promise<void> {
    // 'load' not 'networkidle' — the real-time app never goes idle (would time out).
    await testContext.activePage.waitForLoadState('load', { timeout: 60000 });
  }

  @Step('waiting for network to be idle fast')
  public async waitForNetworkIdleFast(): Promise<void> {
    // 'load' not 'networkidle' — see waitForNetworkIdle.
    await testContext.activePage.waitForLoadState('load', { timeout: 30000 });
  }

  @Step('waiting for zero sync to settle')
  public async waitForZeroSyncToSettle(): Promise<void> {
    // The bridge is dormant by default - patches do effectively nothing while
    // inactive. Calling activate() flips the bookkeeping on, then we poll
    // isSettled until 400ms of WebSocket silence have passed.
    const page = testContext.activePage;
    await page.evaluate(() => {
      // biome-ignore lint/suspicious/noTsIgnore: __zeroSync injected via addInitScript
      // @ts-ignore - __zeroSync is injected before page load
      if (typeof window.__zeroSync !== 'undefined') window.__zeroSync.activate();
    });
    await page.waitForFunction(
      // biome-ignore lint/suspicious/noTsIgnore: __zeroSync injected via addInitScript
      // @ts-ignore - __zeroSync is injected before page load
      () => typeof window.__zeroSync !== 'undefined' && window.__zeroSync.isSettled(400),
      null,
      { timeout: 15000, polling: 100 }
    );
  }

  @Step('waiting for zero sync to settle fast')
  public async waitForZeroSyncToSettleFast(): Promise<void> {
    // Fast variant: only waits 150ms of WebSocket silence (62% faster than default).
    // Use for simple operations like message sends where full 400ms is overkill.
    const page = testContext.activePage;
    await page.evaluate(() => {
      // biome-ignore lint/suspicious/noTsIgnore: __zeroSync injected via addInitScript
      // @ts-ignore - __zeroSync is injected before page load
      if (typeof window.__zeroSync !== 'undefined') window.__zeroSync.activate();
    });
    await page.waitForFunction(
      // biome-ignore lint/suspicious/noTsIgnore: __zeroSync injected via addInitScript
      // @ts-ignore - __zeroSync is injected before page load
      () => typeof window.__zeroSync !== 'undefined' && window.__zeroSync.isSettled(150),
      null,
      { timeout: 10000, polling: 50 }
    );
  }

  @Step('waiting for <selector> to be empty')
  public async waitForInputToBeEmpty(selector: string): Promise<void> {
    const input = testContext.activePage.locator(selector).first();
    await input.waitFor({ state: 'visible' });
    // Wait for the input value to be empty (cleared after send)
    await expect(input).toHaveValue('', { timeout: 10000 });
  }

  @Step('waiting for text <text> to appear in <selector>')
  public async waitForTextInSelector(text: string, selector: string): Promise<void> {
    const resolvedText = text.startsWith('user:') ? resolveStoredText(text) : text;
    const container = testContext.activePage.locator(selector).first();
    await container.waitFor({ state: 'visible', timeout: 10000 });
    // Wait for text to appear (optimistic update after send)
    await expect(container).toContainText(resolvedText, { timeout: 15000 });
  }

  @Step(
    'waiting for stored user <userAlias> channel <channelAlias> message <messageAlias> to appear in <selector>'
  )
  public async waitForStoredUserChannelMessageToAppear(
    userAlias: string,
    channelAlias: string,
    messageAlias: string,
    selector: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidChannelAlias(channelAlias);
    assertValidMessageAlias(messageAlias);
    const text = `user:${userAlias}.channels.${channelAlias}.messages.${messageAlias}.text`;
    const resolvedText = resolveStoredText(text);
    const page = testContext.activePage;
    const container = page.locator(selector).first();
    await container.waitFor({ state: 'visible', timeout: 10000 });
    // Scroll to bottom while waiting - virtualized list may push new messages out of view
    // when shared channels receive concurrent system messages from parallel tests.
    await page.waitForFunction(
      ({ sel, text }) => {
        // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where document exists
        // @ts-ignore - document exists in browser context
        const virtuoso = document.querySelector(sel);
        if (virtuoso) {
          // The chat list scrolls on its [data-virtuoso-scroller] ancestor, not on the item list.
          // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where properties exist
          // @ts-ignore - scrollTop/scrollHeight exist on virtuoso element
          const scroller = virtuoso.closest('[data-virtuoso-scroller]') ?? virtuoso;
          scroller.scrollTop = scroller.scrollHeight;
        }
        // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where document exists
        // @ts-ignore - document exists in browser context
        const node = document.querySelector(sel);
        return node?.textContent?.includes(text) ?? false;
      },
      { sel: selector, text: resolvedText },
      { timeout: 60000 }
    );
  }

  @Step(
    'waiting for stored user <userAlias> dm <dmAlias> message <messageAlias> to appear in <selector>'
  )
  public async waitForStoredUserDmMessageToAppear(
    userAlias: string,
    dmAlias: string,
    messageAlias: string,
    selector: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidDmAlias(dmAlias);
    assertValidMessageAlias(messageAlias);
    const text = `user:${userAlias}.dms.${dmAlias}.messages.${messageAlias}.text`;
    const resolvedText = resolveStoredText(text);
    const page = testContext.activePage;
    const container = page.locator(selector).first();
    await container.waitFor({ state: 'visible', timeout: 10000 });
    // Scroll to bottom while waiting - virtualized list may push new messages out of view.
    await page.waitForFunction(
      ({ sel, text }) => {
        // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where document exists
        // @ts-ignore - document exists in browser context
        const virtuoso = document.querySelector(sel);
        if (virtuoso) {
          // The chat list scrolls on its [data-virtuoso-scroller] ancestor, not on the item list.
          // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where properties exist
          // @ts-ignore - scrollTop/scrollHeight exist on virtuoso element
          const scroller = virtuoso.closest('[data-virtuoso-scroller]') ?? virtuoso;
          scroller.scrollTop = scroller.scrollHeight;
        }
        // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where document exists
        // @ts-ignore - document exists in browser context
        const node = document.querySelector(sel);
        return node?.textContent?.includes(text) ?? false;
      },
      { sel: selector, text: resolvedText },
      { timeout: 60000 }
    );
  }

  // ===========================================
  // ASSERTION
  // ===========================================

  @Step('checking button with text <text> is visible')
  public async assertButtonText(text: string): Promise<void> {
    const button = testContext.activePage.getByRole('button', { name: text }).first();
    await button.waitFor({ state: 'visible' });
    assert.equal(await button.isVisible(), true);
  }

  @Step('verifying text <text> is visible in <selector>')
  public async verifyTextVisibleInSelector(text: string, selector: string): Promise<void> {
    const container = testContext.activePage.locator(selector).first();
    await container.waitFor({ state: 'visible' });
    await container.getByText(text, { exact: true }).first().waitFor({
      state: 'visible',
    });
  }

  @Step('verifying text containing <text> is not visible in <selector>')
  public async verifyTextNotVisibleInSelector(text: string, selector: string): Promise<void> {
    const container = testContext.activePage.locator(selector).first();
    await container.waitFor({ state: 'visible' });
    await expect(container.getByText(resolveStoredText(text), { exact: false })).toHaveCount(0);
  }

  @Step('verifying <text> is visible in <selector>')
  public async verifyVisibleTextInSelector(text: string, selector: string): Promise<void> {
    const resolvedText = resolveStoredText(text);
    const container = testContext.activePage.locator(selector).first();
    await container.waitFor({ state: 'visible' });
    await container.getByText(resolvedText, { exact: false }).first().waitFor({
      state: 'visible',
    });
  }

  @Step('verifying <selector> is visible')
  public async verifySelectorIsVisible(selector: string): Promise<void> {
    await testContext.activePage.locator(selector).first().waitFor({
      state: 'visible',
    });
  }

  @Step('verifying <selector> is not visible')
  public async verifySelectorIsNotVisible(selector: string): Promise<void> {
    const element = testContext.activePage.locator(selector).first();
    const count = await element.count();
    if (count > 0) {
      await element.waitFor({ state: 'hidden', timeout: 5000 });
    }
  }

  @Step('verifying <selector> contains text <expectedText>')
  public async verifySelectorContainsText(selector: string, expectedText: string): Promise<void> {
    const element = testContext.activePage.locator(selector).first();
    await element.waitFor({ state: 'visible' });
    const textContent = await element.textContent();
    assert.ok(
      textContent?.includes(expectedText),
      `Expected "${selector}" to contain "${expectedText}" but got "${textContent}"`
    );
  }

  @Step('verifying stored user <userAlias> field <fieldName> is visible in <selector>')
  public async verifyStoredUserFieldVisible(
    userAlias: string,
    fieldName: string,
    selector: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    const text = `user:${userAlias}.${fieldName}`;
    const resolvedText = resolveStoredText(text);
    const container = testContext.activePage.locator(selector).first();
    await container.waitFor({ state: 'visible' });
    await container.getByText(resolvedText, { exact: false }).first().waitFor({
      state: 'visible',
    });
  }

  @Step(
    'verifying stored user <userAlias> project <projectAlias> field <fieldName> is visible in <selector>'
  )
  public async verifyStoredUserProjectFieldVisible(
    userAlias: string,
    projectAlias: string,
    fieldName: string,
    selector: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidProjectAlias(projectAlias);
    const text = `user:${userAlias}.projects.${projectAlias}.${fieldName}`;
    const resolvedText = resolveStoredText(text);
    const container = testContext.activePage.locator(selector).first();
    await container.waitFor({ state: 'visible' });
    await container.getByText(resolvedText, { exact: true }).first().waitFor({
      state: 'visible',
    });
  }

  @Step(
    'verifying stored user <userAlias> channel <channelAlias> field <fieldName> is visible in <selector>'
  )
  public async verifyStoredUserChannelFieldVisible(
    userAlias: string,
    channelAlias: string,
    fieldName: string,
    selector: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidChannelAlias(channelAlias);
    const text = `user:${userAlias}.channels.${channelAlias}.${fieldName}`;
    const resolvedText = resolveStoredText(text);
    const container = testContext.activePage.locator(selector).first();
    await container.waitFor({ state: 'visible' });
    await container.getByText(resolvedText, { exact: true }).first().waitFor({
      state: 'visible',
    });
  }

  // Waits for the text to be gone, so it also covers a list that updates after an action (leave,
  // remove). Assert the positive state first where "never there" would make this pass vacuously.
  @Step(
    'verifying stored user <userAlias> channel <channelAlias> field <fieldName> is not visible in <selector>'
  )
  public async verifyStoredUserChannelFieldNotVisible(
    userAlias: string,
    channelAlias: string,
    fieldName: string,
    selector: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidChannelAlias(channelAlias);
    const text = `user:${userAlias}.channels.${channelAlias}.${fieldName}`;
    const resolvedText = resolveStoredText(text);
    const container = testContext.activePage.locator(selector).first();
    await container.waitFor({ state: 'visible' });
    await expect(container.getByText(resolvedText, { exact: true })).toHaveCount(0, {
      timeout: 15000,
    });
  }

  @Step(
    'verifying stored user <userAlias> dm <dmAlias> message <messageAlias> is visible in <selector>'
  )
  public async verifyStoredUserDmMessageVisible(
    userAlias: string,
    dmAlias: string,
    messageAlias: string,
    selector: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidDmAlias(dmAlias);
    assertValidMessageAlias(messageAlias);
    const text = `user:${userAlias}.dms.${dmAlias}.messages.${messageAlias}.text`;
    const resolvedText = resolveStoredText(text);
    const page = testContext.activePage;
    const container = page.locator(selector).first();
    await container.waitFor({ state: 'visible' });

    // Interval scrolling: continuously scroll to bottom while waiting for message
    await page.waitForFunction(
      ({ sel, text }) => {
        // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where document exists
        // @ts-ignore - document exists in browser context
        const virtuoso = document.querySelector(sel);
        if (virtuoso) {
          // The chat list scrolls on its [data-virtuoso-scroller] ancestor, not on the item list.
          // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where properties exist
          // @ts-ignore - scrollTop/scrollHeight exist on virtuoso element
          const scroller = virtuoso.closest('[data-virtuoso-scroller]') ?? virtuoso;
          scroller.scrollTop = scroller.scrollHeight;
        }
        // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where document exists
        // @ts-ignore - document exists in browser context
        const container = document.querySelector(sel);
        return container?.textContent?.includes(text) ?? false;
      },
      { sel: selector, text: resolvedText },
      { timeout: 60000 }
    );
  }

  @Step(
    'verifying stored user <userAlias> channel <channelAlias> message <messageAlias> is visible in <selector>'
  )
  public async verifyStoredUserChannelMessageVisible(
    userAlias: string,
    channelAlias: string,
    messageAlias: string,
    selector: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidChannelAlias(channelAlias);
    assertValidMessageAlias(messageAlias);
    const text = `user:${userAlias}.channels.${channelAlias}.messages.${messageAlias}.text`;
    const resolvedText = resolveStoredText(text);
    const page = testContext.activePage;
    const container = page.locator(selector).first();
    await container.waitFor({ state: 'visible' });

    // Interval scrolling: continuously scroll to bottom while waiting for message
    await page.waitForFunction(
      ({ sel, text }) => {
        // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where document exists
        // @ts-ignore - document exists in browser context
        const virtuoso = document.querySelector(sel);
        if (virtuoso) {
          // The chat list scrolls on its [data-virtuoso-scroller] ancestor, not on the item list.
          // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where properties exist
          // @ts-ignore - scrollTop/scrollHeight exist on virtuoso element
          const scroller = virtuoso.closest('[data-virtuoso-scroller]') ?? virtuoso;
          scroller.scrollTop = scroller.scrollHeight;
        }
        // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where document exists
        // @ts-ignore - document exists in browser context
        const container = document.querySelector(sel);
        return container?.textContent?.includes(text) ?? false;
      },
      { sel: selector, text: resolvedText },
      { timeout: 60000 }
    );
  }

  @Step(
    'verifying stored user <userAlias> channel <channelAlias> message <messageAlias> is not visible in <selector>'
  )
  public async verifyStoredUserChannelMessageNotVisible(
    userAlias: string,
    channelAlias: string,
    messageAlias: string,
    selector: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidChannelAlias(channelAlias);
    assertValidMessageAlias(messageAlias);
    const messageText = resolveStoredMessageText(userAlias, 'channels', channelAlias, messageAlias);
    await expect(messageBubblesIn(selector).filter({ hasText: messageText })).toHaveCount(0, {
      timeout: 15000,
    });
  }

  @Step(
    'verifying stored user <userAlias> dm <dmAlias> message <messageAlias> is not visible in <selector>'
  )
  public async verifyStoredUserDmMessageNotVisible(
    userAlias: string,
    dmAlias: string,
    messageAlias: string,
    selector: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidDmAlias(dmAlias);
    assertValidMessageAlias(messageAlias);
    const messageText = resolveStoredMessageText(userAlias, 'dms', dmAlias, messageAlias);
    await expect(messageBubblesIn(selector).filter({ hasText: messageText })).toHaveCount(0, {
      timeout: 15000,
    });
  }

  @Step(
    'verifying <elementSelector> is visible on stored user <userAlias> channel <channelAlias> message <messageAlias> in <selector>'
  )
  public async verifyElementVisibleOnStoredUserChannelMessage(
    elementSelector: string,
    userAlias: string,
    channelAlias: string,
    messageAlias: string,
    selector: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidChannelAlias(channelAlias);
    assertValidMessageAlias(messageAlias);
    const messageText = resolveStoredMessageText(userAlias, 'channels', channelAlias, messageAlias);
    await expect(
      messageBubbleIn(selector, messageText).locator(elementSelector).first()
    ).toBeVisible({ timeout: 60000 });
  }

  @Step(
    'verifying <elementSelector> is visible on stored user <userAlias> dm <dmAlias> message <messageAlias> in <selector>'
  )
  public async verifyElementVisibleOnStoredUserDmMessage(
    elementSelector: string,
    userAlias: string,
    dmAlias: string,
    messageAlias: string,
    selector: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidDmAlias(dmAlias);
    assertValidMessageAlias(messageAlias);
    const messageText = resolveStoredMessageText(userAlias, 'dms', dmAlias, messageAlias);
    await expect(
      messageBubbleIn(selector, messageText).locator(elementSelector).first()
    ).toBeVisible({ timeout: 60000 });
  }

  @Step(
    'verifying stored user <userAlias> channel <channelAlias> message <messageAlias> appears before stored user <laterUserAlias> channel <laterChannelAlias> message <laterMessageAlias> in <selector>'
  )
  public async verifyStoredUserChannelMessageOrder(
    userAlias: string,
    channelAlias: string,
    messageAlias: string,
    laterUserAlias: string,
    laterChannelAlias: string,
    laterMessageAlias: string,
    selector: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidChannelAlias(channelAlias);
    assertValidMessageAlias(messageAlias);
    assertValidUserAlias(laterUserAlias);
    assertValidChannelAlias(laterChannelAlias);
    assertValidMessageAlias(laterMessageAlias);
    const earlierText = resolveStoredMessageText(userAlias, 'channels', channelAlias, messageAlias);
    const laterText = resolveStoredMessageText(
      laterUserAlias,
      'channels',
      laterChannelAlias,
      laterMessageAlias
    );
    await messageBubbleIn(selector, earlierText).waitFor({ state: 'visible', timeout: 60000 });
    await messageBubbleIn(selector, laterText).waitFor({ state: 'visible', timeout: 60000 });

    const texts = await messageBubblesIn(selector).allTextContents();
    const earlierIndex = texts.findIndex((text) => text.includes(earlierText));
    const laterIndex = texts.findIndex((text) => text.includes(laterText));
    assert.ok(
      earlierIndex >= 0 && earlierIndex < laterIndex,
      `Expected "${earlierText}" (index ${earlierIndex}) before "${laterText}" (index ${laterIndex}) in "${selector}".`
    );
  }

  @Step('waiting for message with text <messageText> to appear in virtuoso list')
  public async waitForMessageInVirtuosoList(messageText: string): Promise<void> {
    const page = testContext.activePage;
    const virtuosoList = page.locator('[data-testid="virtuoso-item-list"]').first();
    await virtuosoList.waitFor({ state: 'visible', timeout: 30000 });

    // Interval scrolling: continuously scroll to bottom while waiting for message
    await page.waitForFunction(
      ({ text }) => {
        // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where document exists
        // @ts-ignore - document exists in browser context
        const virtuoso = document.querySelector('[data-testid="virtuoso-item-list"]');
        if (virtuoso) {
          // The chat list scrolls on its [data-virtuoso-scroller] ancestor, not on the item list.
          // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where properties exist
          // @ts-ignore - scrollTop/scrollHeight exist on virtuoso element
          const scroller = virtuoso.closest('[data-virtuoso-scroller]') ?? virtuoso;
          scroller.scrollTop = scroller.scrollHeight;
        }
        // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where document exists
        // @ts-ignore - document exists in browser context
        const container = document.querySelector('[data-testid="virtuoso-item-list"]');
        return container?.textContent?.includes(text) ?? false;
      },
      { text: messageText },
      { timeout: 60000 }
    );
  }

  @Step(
    'waiting for stored user <userAlias> channel <channelAlias> message <messageAlias> to appear in virtuoso list'
  )
  public async waitForStoredUserChannelMessageInVirtuosoList(
    userAlias: string,
    channelAlias: string,
    messageAlias: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidChannelAlias(channelAlias);
    assertValidMessageAlias(messageAlias);
    const text = `user:${userAlias}.channels.${channelAlias}.messages.${messageAlias}.text`;
    const resolvedText = resolveStoredText(text);

    const page = testContext.activePage;
    const virtuosoList = page.locator('[data-testid="virtuoso-item-list"]').first();
    await virtuosoList.waitFor({ state: 'visible', timeout: 30000 });

    // Interval scrolling: continuously scroll to bottom while waiting for message
    await page.waitForFunction(
      ({ text }) => {
        // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where document exists
        // @ts-ignore - document exists in browser context
        const virtuoso = document.querySelector('[data-testid="virtuoso-item-list"]');
        if (virtuoso) {
          // The chat list scrolls on its [data-virtuoso-scroller] ancestor, not on the item list.
          // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where properties exist
          // @ts-ignore - scrollTop/scrollHeight exist on virtuoso element
          const scroller = virtuoso.closest('[data-virtuoso-scroller]') ?? virtuoso;
          scroller.scrollTop = scroller.scrollHeight;
        }
        // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where document exists
        // @ts-ignore - document exists in browser context
        const container = document.querySelector('[data-testid="virtuoso-item-list"]');
        return container?.textContent?.includes(text) ?? false;
      },
      { text: resolvedText },
      { timeout: 60000 }
    );
  }

  @Step(
    'waiting for stored user <userAlias> dm <dmAlias> message <messageAlias> to appear in virtuoso list'
  )
  public async waitForStoredUserDmMessageInVirtuosoList(
    userAlias: string,
    dmAlias: string,
    messageAlias: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidDmAlias(dmAlias);
    assertValidMessageAlias(messageAlias);
    const text = `user:${userAlias}.dms.${dmAlias}.messages.${messageAlias}.text`;
    const resolvedText = resolveStoredText(text);

    const page = testContext.activePage;
    const virtuosoList = page.locator('[data-testid="virtuoso-item-list"]').first();
    await virtuosoList.waitFor({ state: 'visible', timeout: 30000 });

    // Interval scrolling: continuously scroll to bottom while waiting for message
    await page.waitForFunction(
      ({ text }) => {
        // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where document exists
        // @ts-ignore - document exists in browser context
        const virtuoso = document.querySelector('[data-testid="virtuoso-item-list"]');
        if (virtuoso) {
          // The chat list scrolls on its [data-virtuoso-scroller] ancestor, not on the item list.
          // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where properties exist
          // @ts-ignore - scrollTop/scrollHeight exist on virtuoso element
          const scroller = virtuoso.closest('[data-virtuoso-scroller]') ?? virtuoso;
          scroller.scrollTop = scroller.scrollHeight;
        }
        // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where document exists
        // @ts-ignore - document exists in browser context
        const container = document.querySelector('[data-testid="virtuoso-item-list"]');
        return container?.textContent?.includes(text) ?? false;
      },
      { text: resolvedText },
      { timeout: 60000 }
    );
  }

  // ===========================================
  // STORAGE
  // ===========================================

  @Step('storing current path as <userAlias> field <fieldName>')
  public async storeCurrentPath(userAlias: string, fieldName: string): Promise<void> {
    assertValidUserAlias(userAlias);
    const user = testContext.storedUsers.get(userAlias);
    assert.ok(user, `User ${userAlias} not found in stored users`);

    // Include the query string: e.g. a canvas's id lives in `?canvasId=...`, so
    // dropping it would break reload/persistence checks. `search` is '' for plain paths.
    const url = new URL(testContext.activePage.url());
    const currentPath = `${url.pathname}${url.search}`;
    // Store as a top-level field on the user object
    // biome-ignore lint/suspicious/noExplicitAny: dynamic field storage
    (user as any)[fieldName] = currentPath;
  }

  @Step('storing message <messageText> as <messageAlias>')
  public async storeMessage(_messageText: string, messageAlias: string): Promise<void> {
    assertValidMessageAlias(messageAlias);
  }

  // ===========================================
  // ADVANCED INTERACTIONS
  // ===========================================

  @Step('clearing text in <selector>')
  public async clearTextInSelector(selector: string): Promise<void> {
    const element = testContext.activePage.locator(selector).first();
    await element.waitFor({ state: 'visible' });
    await element.fill('');
  }

  @Step('hovering on message with text <text>')
  public async hoverOnMessageWithText(text: string): Promise<void> {
    const page = testContext.activePage;
    // Target the chat-message bubble (has the hover-actions toolbar attached)
    let message = page.locator(`[data-testid^="chat-message-"]:has-text("${text}")`).last();
    // Fallback to last message bubble if no text match
    if (!(await message.isVisible().catch(() => false))) {
      message = page.locator('[data-testid^="chat-message-"]').last();
    }
    await message.waitFor({ state: 'visible' });
    // Start off the list so the hover always fires a fresh pointerover.
    await page.mouse.move(0, 0);
    await message.scrollIntoViewIfNeeded();
    await message.hover();
    // Wait for hover actions toolbar to appear instead of hardcoded timeout
    await page
      .locator('[data-testid^="hover-action-"]')
      .first()
      .waitFor({
        state: 'visible',
        timeout: 2000,
      })
      .catch(() => {
        // Hover actions may not appear on all messages (e.g., system messages), continue anyway
      });
  }

  // Real pointer hover with retries (tests/shared/support/message-hover.ts): synthetic
  // mouseover events no longer reliably open the message hover toolbar.
  @Step('clicking hover action <hoverActionSelector> on message with text <messageText>')
  public async clickHoverActionOnMessage(
    hoverActionSelector: string,
    messageText: string
  ): Promise<void> {
    await hoverAndClickActionOnMessage(hoverActionSelector, messageText);
  }

  @Step(
    'clicking hover action <hoverActionSelector> on stored user <userAlias> channel <channelAlias> message <messageAlias> in <selector>'
  )
  public async clickHoverActionOnStoredUserChannelMessage(
    hoverActionSelector: string,
    userAlias: string,
    channelAlias: string,
    messageAlias: string,
    selector: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidChannelAlias(channelAlias);
    assertValidMessageAlias(messageAlias);
    await hoverAndClickActionOnMessage(
      hoverActionSelector,
      resolveStoredMessageText(userAlias, 'channels', channelAlias, messageAlias),
      selector
    );
  }

  @Step(
    'clicking hover action <hoverActionSelector> on stored user <userAlias> dm <dmAlias> message <messageAlias> in <selector>'
  )
  public async clickHoverActionOnStoredUserDmMessage(
    hoverActionSelector: string,
    userAlias: string,
    dmAlias: string,
    messageAlias: string,
    selector: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidDmAlias(dmAlias);
    assertValidMessageAlias(messageAlias);
    await hoverAndClickActionOnMessage(
      hoverActionSelector,
      resolveStoredMessageText(userAlias, 'dms', dmAlias, messageAlias),
      selector
    );
  }

  @Step(
    'clicking on <elementSelector> on stored user <userAlias> channel <channelAlias> message <messageAlias> in <selector>'
  )
  public async clickElementOnStoredUserChannelMessage(
    elementSelector: string,
    userAlias: string,
    channelAlias: string,
    messageAlias: string,
    selector: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidChannelAlias(channelAlias);
    assertValidMessageAlias(messageAlias);
    const message = messageBubbleIn(
      selector,
      resolveStoredMessageText(userAlias, 'channels', channelAlias, messageAlias)
    );
    await message.scrollIntoViewIfNeeded();
    await message.locator(elementSelector).first().click();
  }

  @Step('attaching fixture file <fileName> to <selector>')
  public async attachFixtureFile(fileName: string, selector: string): Promise<void> {
    const filePath = path.join(FIXTURE_FILES_DIR, fileName);
    assert.ok(
      fs.existsSync(filePath),
      `Fixture file "${fileName}" not found in ${FIXTURE_FILES_DIR}.`
    );
    const input = testContext.activePage.locator(selector).first();
    await input.waitFor({ state: 'attached' });
    await input.setInputFiles(filePath);
  }

  // The composer shows a "Remove attachment <name>" button only once that upload finishes.
  @Step('waiting for attachment <fileName> to finish uploading')
  public async waitForAttachmentUpload(fileName: string): Promise<void> {
    const removeButton = testContext.activePage
      .getByRole('button', { name: `Remove attachment ${fileName}`, exact: true })
      .first();
    await removeButton.waitFor({ state: 'visible', timeout: 60000 });
    // The tile (and its remove button) shows as soon as the file is picked; the
    // composer keeps its send button disabled until the bytes finish uploading.
    const sendButton = removeButton
      .locator('xpath=ancestor::*[.//*[@data-testid="send-message-button"]][1]')
      .locator('[data-testid="send-message-button"]')
      .first();
    await expect(sendButton).toBeEnabled({ timeout: 60000 });
  }

  @Step('attaching file to <selector>')
  public async attachFileToSelector(selector: string): Promise<void> {
    const element = testContext.activePage.locator(selector).first();
    await element.waitFor({ state: 'attached' });
    // Create a dummy file for attachment - keep it around so upload completes
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');
    const tmpFile = path.join(os.tmpdir(), `test-attachment-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, 'Test attachment content');
    await element.setInputFiles(tmpFile);
    // Wait for upload completion indicators instead of hardcoded timeout
    const page = testContext.activePage;
    // Look for common upload completion indicators: file name displayed, upload spinner gone, etc.
    await Promise.race([
      page.locator('[data-testid*="file-"], [data-testid*="attachment-"]').first().waitFor({
        state: 'visible',
        timeout: 3000,
      }),
      page.locator('[data-testid*="upload"], [data-testid*="spinner"]').first().waitFor({
        state: 'hidden',
        timeout: 3000,
      }),
      page.waitForTimeout(2000), // Fallback to original timeout if no indicators found
    ]).catch(() => {
      // If no upload indicators are present, the upload might be instant
    });
  }

  // ===========================================
  // TICKETS
  // ===========================================

  @Step('clicking on ticket card with title <title>')
  public async clickOnTicketCardWithTitle(title: string): Promise<void> {
    const page = testContext.activePage;
    const card = page.locator('[data-testid^="ticket-card-"]').filter({ hasText: title }).first();
    await card.waitFor({ state: 'visible' });
    await card.click();
  }

  @Step('clicking on stored user <userAlias> ticket <ticketAlias> card')
  public async clickOnStoredTicketCard(userAlias: string, ticketAlias: string): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidTicketAlias(ticketAlias);
    const text = `user:${userAlias}.tickets.${ticketAlias}.title`;
    const title = resolveStoredText(text);
    const page = testContext.activePage;
    const card = page.locator('[data-testid^="ticket-card-"]').filter({ hasText: title }).first();
    await card.waitFor({ state: 'visible' });
    await card.click();
  }

  @Step('verifying stored user <userAlias> ticket <ticketAlias> card is visible')
  public async verifyStoredTicketCardVisible(
    userAlias: string,
    ticketAlias: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidTicketAlias(ticketAlias);
    const text = `user:${userAlias}.tickets.${ticketAlias}.title`;
    const title = resolveStoredText(text);
    const page = testContext.activePage;
    const card = page.locator('[data-testid^="ticket-card-"]').filter({ hasText: title }).first();
    await card.waitFor({ state: 'visible', timeout: 5000 });
  }

  // ===========================================
  // NAVIGATION
  // ===========================================

  @Step('Navigating to chat')
  public async navigateToChat(): Promise<void> {
    await navigateViaSidebar(testContext.activePage, 'chat');
    await testContext.activePage
      .locator("[data-testid='chat-list-loading']")
      .first()
      .waitFor({ state: 'hidden' });
  }

  @Step('clicking on "[data-testid=\'create-new-dm\']"')
  public async clickCreateNewDm(): Promise<void> {
    await testContext.activePage.locator("[data-testid='create-new-dm']").first().click();
  }

  @Step('clicking on "[data-testid=\'send-message-button\']"')
  public async clickSendMessageButton(): Promise<void> {
    await testContext.activePage.locator("[data-testid='send-message-button']").first().click();
  }

  // ===========================================
  // CHANNEL OPERATIONS
  // ===========================================

  @Step('clicking on "[data-testid=\'add-people-button\']"')
  public async clickAddPeopleButton(): Promise<void> {
    await testContext.activePage.locator("[data-testid='add-people-button']").first().click();
  }

  @Step('clicking on "[data-testid=\'add-people-submit\']"')
  public async clickAddPeopleSubmit(): Promise<void> {
    await testContext.activePage.locator("[data-testid='add-people-submit']").first().click();
  }

  @Step('clicking on "[data-testid=\'channel-info-trigger\']"')
  public async clickChannelInfoTrigger(): Promise<void> {
    await testContext.activePage.locator("[data-testid='channel-info-trigger']").first().click();
  }

  // ===========================================
  // USER GROUPS
  // ===========================================

  @Step('clicking on "[data-testid=\'create-group-button\']"')
  public async clickCreateGroupButton(): Promise<void> {
    await testContext.activePage.locator("[data-testid='create-group-button']").first().click();
  }

  // ===========================================
  // ONBOARDING - TEMP: Will be removed once xyne-ai-onboarding overlay bug is fixed
  // ===========================================

  /**
   * TEMP: Skips the xyne-ai-onboarding overlay that gets stuck showing only the backdrop.
   * This is a workaround for a bug where the AI onboarding popup doesn't render properly
   * after the main onboarding flow completes.
   *
   * TODO: Remove this step once the xyne-ai-onboarding overlay bug is fixed.
   * Issue: After completing the 6-step onboarding, the AI onboarding shows only
   * a dark backdrop without the actual popup content.
   */
  @Step('skipping xyne-ai-onboarding overlay')
  public async skipXyneAIOnboarding(): Promise<void> {
    const page = testContext.activePage;

    const stateChanged = await page.evaluate(() => {
      const stateChanged =
        localStorage.getItem('xyne-ai-onboarding-completed') !== 'true' ||
        localStorage.getItem('xyne-ai-onboarding-active') !== null ||
        sessionStorage.getItem('xyne-ai-onboarding-pending') !== null;

      // Mark AI onboarding as completed
      localStorage.setItem('xyne-ai-onboarding-completed', 'true');
      // Clear active state
      localStorage.removeItem('xyne-ai-onboarding-active');
      // Clear pending flag
      sessionStorage.removeItem('xyne-ai-onboarding-pending');

      return stateChanged;
    });

    if (!stateChanged) return;

    // Refresh to apply changes - use domcontentloaded for faster reload
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  }

  // ===========================================
  // API AS THE ACTIVE BROWSER'S USER
  // Requests go through the active page's request context, so they carry that
  // browser's session cookies and act as whoever is logged in there.
  // ===========================================

  @Step(
    'storing id of stored user <userAlias> channel <channelAlias> message <messageAlias> in <selector>'
  )
  public async storeChannelMessageId(
    userAlias: string,
    channelAlias: string,
    messageAlias: string,
    selector: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidChannelAlias(channelAlias);
    assertValidMessageAlias(messageAlias);
    await this.storeMessageId(userAlias, 'channels', channelAlias, messageAlias, selector);
  }

  @Step('storing id of stored user <userAlias> dm <dmAlias> message <messageAlias> in <selector>')
  public async storeDmMessageId(
    userAlias: string,
    dmAlias: string,
    messageAlias: string,
    selector: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidDmAlias(dmAlias);
    assertValidMessageAlias(messageAlias);
    await this.storeMessageId(userAlias, 'dms', dmAlias, messageAlias, selector);
  }

  private async storeMessageId(
    userAlias: string,
    conversationKind: 'channels' | 'dms',
    conversationAlias: string,
    messageAlias: string,
    selector: string
  ): Promise<void> {
    const conversation = getStoredUser(userAlias)[conversationKind][conversationAlias];
    const message = conversation?.messages[messageAlias];
    assert.ok(message, `Expected stored message "${messageAlias}" in "${conversationAlias}".`);
    const bubble = messageBubbleIn(selector, message.text);
    await expect(bubble).toBeVisible({ timeout: config.timeout });
    const messageId = await bubble.getAttribute('data-message-id');
    assert.ok(messageId, `Expected message "${messageAlias}" to expose data-message-id.`);
    message.id = messageId;
  }

  @Step('sending zero mutation <mutationName> with args <mutationArgs>')
  public async sendZeroMutation(mutationName: string, mutationArgs: string): Promise<void> {
    testContext.lastResponse = await testContext.activePage.request.post(
      `${config.dashboard.baseUrl}/api/zero/push-fallback`,
      { data: { name: mutationName, args: parseStepArgs(mutationArgs) }, timeout: 60000 }
    );
  }

  @Step('verifying zero mutation succeeded')
  public async verifyZeroMutationSucceeded(): Promise<void> {
    const body = await this.readZeroMutationResult();
    assert.equal(body.success, true, `Expected mutation to succeed, got ${JSON.stringify(body)}.`);
  }

  // `expectedError` may list alternatives as `a|b` when more than one guard can refuse first.
  @Step('verifying zero mutation was rejected with <expectedError>')
  public async verifyZeroMutationRejected(expectedError: string): Promise<void> {
    const body = await this.readZeroMutationResult();
    assert.equal(
      body.success,
      false,
      `Expected mutation to be rejected, got ${JSON.stringify(body)}.`
    );
    const message = String(body.message ?? '');
    assert.ok(
      expectedError.split('|').some((expected) => message.includes(expected)),
      `Expected rejection containing "${expectedError}", got "${message}".`
    );
  }

  // push-fallback answers HTTP 200 and reports mutator/ACL rejections in the body.
  private async readZeroMutationResult(): Promise<{ success?: boolean; message?: string }> {
    const response = testContext.lastResponse;
    assert.ok(response, 'Expected a zero mutation response to be available.');
    assert.equal(
      response.status(),
      200,
      `Expected push-fallback HTTP 200, got ${response.status()}.`
    );
    return (await response.json()) as { success?: boolean; message?: string };
  }

  @Step('sending POST to <urlPath> with args <requestArgs>')
  public async sendPostAsActiveUser(urlPath: string, requestArgs: string): Promise<void> {
    assertValidUrlPath(urlPath);
    testContext.lastResponse = await testContext.activePage.request.post(
      `${config.dashboard.baseUrl}${urlPath}`,
      { data: parseStepArgs(requestArgs), timeout: 60000 }
    );
  }

  @Step('creating dm <dmAlias> via API for user <userAlias> with user <participantAlias>')
  public async createDmViaApi(
    dmAlias: string,
    userAlias: string,
    participantAlias: string
  ): Promise<void> {
    assertValidDmAlias(dmAlias);
    assertValidUserAlias(userAlias);
    assertValidUserAlias(participantAlias);
    const user = getStoredUser(userAlias);
    const participant = getStoredUser(participantAlias);
    const response = await testContext.activePage.request.post(
      `${config.dashboard.baseUrl}/api/users/me/dms`,
      {
        data: { participantIds: [participant.id], message: `dm-seed-${buildRandomSuffix()}` },
        timeout: 60000,
      }
    );
    assert.equal(response.ok(), true, `Expected DM creation to succeed, got ${response.status()}.`);
    const body = (await response.json()) as { id?: string };
    assert.ok(body.id, `Expected DM creation response to contain id, got ${JSON.stringify(body)}.`);
    user.dms[dmAlias] = {
      id: body.id,
      name: participant.name,
      url: `${config.dashboard.baseUrl}/${user.workspaceId}/chat/dir/${body.id}`,
      messages: {},
    };
  }

  @Step(
    'uploading fixture file <fileName> as attachment <attachmentAlias> for stored user <userAlias> channel <channelAlias>'
  )
  public async uploadChannelAttachment(
    fileName: string,
    attachmentAlias: string,
    userAlias: string,
    channelAlias: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidChannelAlias(channelAlias);
    await this.uploadAndStoreAttachment(
      fileName,
      attachmentAlias,
      userAlias,
      'channels',
      channelAlias
    );
  }

  @Step(
    'uploading fixture file <fileName> as attachment <attachmentAlias> for stored user <userAlias> dm <dmAlias>'
  )
  public async uploadDmAttachment(
    fileName: string,
    attachmentAlias: string,
    userAlias: string,
    dmAlias: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidDmAlias(dmAlias);
    await this.uploadAndStoreAttachment(fileName, attachmentAlias, userAlias, 'dms', dmAlias);
  }

  private async uploadAndStoreAttachment(
    fileName: string,
    attachmentAlias: string,
    userAlias: string,
    conversationKind: 'channels' | 'dms',
    conversationAlias: string
  ): Promise<void> {
    const conversation = getStoredConversation(userAlias, conversationKind, conversationAlias);
    const attachmentId = randomUUID();
    await uploadDraftAttachment(conversation.id as string, fileName, attachmentId);
    const response = testContext.lastResponse;
    assert.ok(response);
    assert.equal(
      response.ok(),
      true,
      `Expected attachment upload to succeed, got ${response.status()}.`
    );
    conversation.attachments = {
      ...conversation.attachments,
      [attachmentAlias]: { alias: attachmentAlias, id: attachmentId, fileName },
    };
  }

  @Step(
    'uploading fixture file <fileName> for stored user <userAlias> channel <channelAlias> with attachment id <attachmentId>'
  )
  public async uploadChannelAttachmentWithId(
    fileName: string,
    userAlias: string,
    channelAlias: string,
    attachmentId: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidChannelAlias(channelAlias);
    const conversation = getStoredConversation(userAlias, 'channels', channelAlias);
    await uploadDraftAttachment(
      conversation.id as string,
      fileName,
      resolveStoredText(attachmentId)
    );
  }

  @Step('verifying <elementSelector> is visible in <selector> for stored user <userAlias>')
  public async verifyVisibleInUserRow(
    elementSelector: string,
    selector: string,
    userAlias: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    const row = this.userRow(selector, userAlias);
    await expect(row).toBeVisible({ timeout: config.timeout });
    await row.hover();
    await expect(row.locator(elementSelector).first()).toBeVisible({ timeout: config.timeout });
  }

  @Step('verifying <elementSelector> is not visible in <selector> for stored user <userAlias>')
  public async verifyNotVisibleInUserRow(
    elementSelector: string,
    selector: string,
    userAlias: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    const row = this.userRow(selector, userAlias);
    await expect(row).toBeVisible({ timeout: config.timeout });
    await row.hover();
    await expect(row.locator(elementSelector)).toHaveCount(0);
  }

  // A row element carrying `data-user-id` for the stored user, e.g. a channel member row.
  private userRow(selector: string, userAlias: string): Locator {
    const userId = getStoredUser(userAlias).id;
    return testContext.activePage.locator(`${selector}[data-user-id="${userId}"]`).first();
  }
}
