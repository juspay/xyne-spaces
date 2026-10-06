import assert from 'node:assert/strict';
import { expect, type Locator, type Page } from '@playwright/test';
import { Step } from 'gauge-ts';
import { config } from '@/config';
import { testContext } from '@/tests/shared/runtime/test-context';
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
import { dispatchHoverEvents } from '@/tests/shared/support/message-hover';

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

const SIDEBAR_NAVIGATION_TIMEOUT_MS = 10000;

async function getSidebarDestinationPath(page: Page, item: Locator): Promise<string> {
  const href = await item.getAttribute('href');
  assert.ok(href, 'Expected sidebar navigation item to have an href.');

  return new URL(href, page.url()).pathname;
}

function isAtPath(page: Page, expectedPath: string): boolean {
  return new URL(page.url()).pathname === expectedPath;
}

async function waitForPath(page: Page, expectedPath: string): Promise<void> {
  await page.waitForURL((url) => url.pathname === expectedPath, {
    timeout: SIDEBAR_NAVIGATION_TIMEOUT_MS,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Opens the "Customize toolbar" dialog from the More popover and returns once
// the dialog is on-screen. The two toolbar-mutation helpers below (add / remove)
// share this entry so changes to the entry sequence land in one place.
async function openCustomizeToolbarDialog(page: Page): Promise<Locator> {
  // The "Customize toolbar" button sits at the bottom of a max-h-[80vh] overflow-y-auto
  // popover in AppSidebar, so when the user has many More-overflow items it starts
  // below the fold. Attach + scroll before the visibility wait; otherwise the wait
  // times out even though the button is rendered. The More popover can also
  // auto-close on focus loss between the caller's open-click and our wait, so
  // re-open via nav-more if the Customize row is attached but not visible.
  const customizeTrigger = page.locator("[data-testid='more-customize-toolbar']").first();
  await customizeTrigger.waitFor({ state: 'attached', timeout: SIDEBAR_NAVIGATION_TIMEOUT_MS });
  await customizeTrigger.scrollIntoViewIfNeeded().catch(() => {});
  try {
    await customizeTrigger.waitFor({ state: 'visible', timeout: 2000 });
  } catch {
    await page.locator("[data-testid='nav-more']").first().click();
    await customizeTrigger.waitFor({ state: 'attached', timeout: SIDEBAR_NAVIGATION_TIMEOUT_MS });
    await customizeTrigger.scrollIntoViewIfNeeded().catch(() => {});
    await customizeTrigger.waitFor({ state: 'visible', timeout: SIDEBAR_NAVIGATION_TIMEOUT_MS });
  }
  await customizeTrigger.click();
  // Preferences opens via a custom event + lazy section mount; wait for the
  // dialog shell before poking at anything inside it.
  const closeButton = page.locator("button[aria-label='Close preferences']").first();
  await closeButton.waitFor({ state: 'visible', timeout: SIDEBAR_NAVIGATION_TIMEOUT_MS });
  return closeButton;
}

async function closeCustomizeToolbarDialog(page: Page, closeButton: Locator): Promise<void> {
  await closeButton.click({ timeout: 2000 }).catch(() => page.keyboard.press('Escape'));
  await closeButton.waitFor({ state: 'hidden', timeout: SIDEBAR_NAVIGATION_TIMEOUT_MS });
}

async function addItemViaCustomizeToolbar(page: Page, itemId: string): Promise<void> {
  // Caller has already opened the More menu to look for the item and failed to find it.
  const closeButton = await openCustomizeToolbarDialog(page);
  const addRow = page.locator(`[data-testid='customize-add-${itemId}']`).first();
  try {
    // The "Available" list in BarCustomizer is long (NAVIGATION_ITEMS has 30+
    // entries) and lives inside the dialog's own scroll container, so items
    // like Context / Scheduled Messages / User Groups sit below the fold.
    // waitFor({state:'attached'}) + scrollIntoViewIfNeeded brings it on screen
    // before the visibility check — otherwise visible-wait can race with the
    // dialog's internal layout and the click target is never reached.
    await addRow.waitFor({ state: 'attached', timeout: SIDEBAR_NAVIGATION_TIMEOUT_MS });
    await addRow.scrollIntoViewIfNeeded().catch(() => {});
    await addRow.waitFor({ state: 'visible', timeout: SIDEBAR_NAVIGATION_TIMEOUT_MS });
  } catch (err) {
    await closeCustomizeToolbarDialog(page, closeButton);
    throw new Error(
      `Sidebar item "${itemId}" is not available in the Customize Toolbar picker — ` +
        `either the test references a label that no longer exists in NAVIGATION_ITEMS, ` +
        `or permissions / toolbar overrides have hidden it for this user. ` +
        `Underlying wait: ${errorMessage(err)}`
    );
  }
  await addRow.click();
  await closeCustomizeToolbarDialog(page, closeButton);
}

async function removeItemViaCustomizeToolbar(page: Page, itemId: string): Promise<void> {
  // Caller is responsible for having opened the More menu first (same shape as
  // addItemViaCustomizeToolbar) so openCustomizeToolbarDialog can scroll the
  // "Customize toolbar" button into view inside the already-open popover.
  const closeButton = await openCustomizeToolbarDialog(page);
  const removeRow = page.locator(`[data-testid='customize-remove-${itemId}']`).first();
  try {
    // "Shown" rows live in the same scroll container as "Available", so the
    // attach + scroll + visible dance applies here too — a locked/always-shown
    // item has no remove button and this will throw cleanly below.
    await removeRow.waitFor({ state: 'attached', timeout: SIDEBAR_NAVIGATION_TIMEOUT_MS });
    await removeRow.scrollIntoViewIfNeeded().catch(() => {});
    await removeRow.waitFor({ state: 'visible', timeout: SIDEBAR_NAVIGATION_TIMEOUT_MS });
  } catch (err) {
    await closeCustomizeToolbarDialog(page, closeButton);
    throw new Error(
      `Sidebar item "${itemId}" is not currently shown in the Customize Toolbar list — ` +
        `either it was never in the toolbar, it is locked ("Always shown"), ` +
        `or the test references a label that no longer exists in NAVIGATION_ITEMS. ` +
        `Underlying wait: ${errorMessage(err)}`
    );
  }
  await removeRow.click();
  await closeCustomizeToolbarDialog(page, closeButton);
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
    // selectors (e.g. [data-testid^='project-item-']) the target text may
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
    // Wait for the element to exist in the DOM first; if it's attached but
    // scrolled past the fold (nested panel scrollers) `waitFor(visible)` can
    // time out even though a scroll would bring it into view.
    await element.waitFor({ state: 'attached' });
    await element.scrollIntoViewIfNeeded().catch(() => {});
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

  @Step('clicking on <selector> if visible')
  public async clickOnSelectorIfVisible(selector: string): Promise<void> {
    // No-wait sibling of `clicking on <selector>` for conditional UI
    // (collapsed sections, dismissible banners) that may or may not be present
    // for the current scenario. Fail-silent on absence. Scrolls below-the-fold
    // elements into view first so a match that exists in DOM but is scrolled
    // past still gets the click (Playwright's `isVisible` honours viewport).
    const element = testContext.activePage.locator(selector).first();
    // Short grace period so the DOM has a chance to mount the optional element
    // when it is about to appear (e.g. after a modal transition).
    try {
      await element.waitFor({ state: 'attached', timeout: 2000 });
    } catch {
      return;
    }
    await element.scrollIntoViewIfNeeded().catch(() => {});
    await element.click({ force: true }).catch(() => {});
  }

  @Step('showing all sidebar items in toolbar')
  public async showAllSidebarItemsInToolbar(): Promise<void> {
    // Setup helper: moves every item from the Customize Toolbar "Available"
    // list into "Shown" so the rail carries every nav item the current user
    // can see. After this runs, downstream `navigating via sidebar to <id>`
    // steps hit the rail-fast-path and never need to re-open Customize.
    // Idempotent — if nothing is in Available the loop exits on the first
    // count check.
    const page = testContext.activePage;
    const moreTrigger = page.locator("[data-testid='nav-more']").first();
    await moreTrigger.waitFor({ state: 'visible' });
    await moreTrigger.click();
    const customizeInMore = page.locator("[data-testid='more-customize-toolbar']").first();
    await customizeInMore.waitFor({
      state: 'attached',
      timeout: SIDEBAR_NAVIGATION_TIMEOUT_MS,
    });
    const closeButton = await openCustomizeToolbarDialog(page);
    // Each +Add click moves one item from Available to Shown, which removes
    // its customize-add-<slug> node, so re-querying every iteration lets the
    // DOM mutations drive the loop. Hard cap at the current NAVIGATION_ITEMS
    // size with headroom so a layout bug can't spin forever.
    const addButtons = page.locator("[data-testid^='customize-add-']");
    const MAX_ADDS = 60;
    for (let i = 0; i < MAX_ADDS; i += 1) {
      const remaining = await addButtons.count();
      if (remaining === 0) {
        break;
      }
      const next = addButtons.first();
      await next.scrollIntoViewIfNeeded().catch(() => {});
      await next.waitFor({ state: 'visible', timeout: SIDEBAR_NAVIGATION_TIMEOUT_MS });
      await next.click();
    }
    await closeCustomizeToolbarDialog(page, closeButton);
  }

  @Step('removing sidebar item <itemId>')
  public async removeSidebarItem(itemId: string): Promise<void> {
    const page = testContext.activePage;
    const moreTrigger = page.locator("[data-testid='nav-more']").first();
    await moreTrigger.waitFor({ state: 'visible' });
    await moreTrigger.click();
    // Wait for the More popover's content to mount — the Customize button is
    // the last node in the menu, so once it is attached everything above it is
    // too. See navigateViaSidebar for the overflow-container rationale.
    const customizeInMore = page.locator("[data-testid='more-customize-toolbar']").first();
    await customizeInMore.waitFor({ state: 'attached', timeout: SIDEBAR_NAVIGATION_TIMEOUT_MS });
    await removeItemViaCustomizeToolbar(page, itemId);
  }

  @Step('navigating via sidebar to <itemId>')
  public async navigateViaSidebar(itemId: string): Promise<void> {
    const page = testContext.activePage;
    // Wait for the sidebar to be mounted before deciding rail vs add-then-rail.
    const moreTrigger = page.locator("[data-testid='nav-more']").first();
    await moreTrigger.waitFor({ state: 'visible' });

    const toolbarItem = page.locator(`[data-testid='nav-${itemId}']`).first();

    // Ensure the item lives on the rail before clicking. If it is not already
    // there, add it through Customize Toolbar — then click it from the rail.
    // We deliberately avoid clicking the item from the More overflow popover:
    // Radix auto-closes the popover on outside pointer events, items below the
    // scroll fold are reported as not-visible intermittently, and the click
    // sequence has to race the popover's own close animation. Routing through
    // the Customize dialog instead is slower by one dialog round-trip but is
    // deterministic — once added, nav-<itemId> is a plain button on the rail.
    if (!(await toolbarItem.isVisible().catch(() => false))) {
      await moreTrigger.click();
      // The Customize button is the last node in the More popover, so once it
      // is attached the popover's content has finished mounting.
      const customizeInMore = page.locator("[data-testid='more-customize-toolbar']").first();
      await customizeInMore.waitFor({
        state: 'attached',
        timeout: SIDEBAR_NAVIGATION_TIMEOUT_MS,
      });
      await addItemViaCustomizeToolbar(page, itemId);
      // After the dialog closes the item moves into the user's toolbarIds and
      // renders on the rail — wait for that render before resolving its href.
      await toolbarItem.waitFor({ state: 'visible', timeout: SIDEBAR_NAVIGATION_TIMEOUT_MS });
    }

    const expectedPath = await getSidebarDestinationPath(page, toolbarItem);
    await toolbarItem.click();
    await waitForPath(page, expectedPath);
  }

  @Step('typing <text> in <selector>')
  public async typeOnElement(text: string, selector: string): Promise<void> {
    const resolvedText = resolveStoredText(text);
    const element = testContext.activePage.locator(selector).first();
    await element.waitFor({ state: 'visible' });
    await element.fill(resolvedText);
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
          // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where properties exist
          // @ts-ignore - scrollTop/scrollHeight exist on virtuoso element
          virtuoso.scrollTop = virtuoso.scrollHeight;
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
          // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where properties exist
          // @ts-ignore - scrollTop/scrollHeight exist on virtuoso element
          virtuoso.scrollTop = virtuoso.scrollHeight;
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
    const element = testContext.activePage.locator(selector).first();
    await element.waitFor({ state: 'attached' });
    await element.scrollIntoViewIfNeeded().catch(() => {});
    await element.waitFor({ state: 'visible' });
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
          // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where properties exist
          // @ts-ignore - scrollTop/scrollHeight exist on virtuoso element
          virtuoso.scrollTop = virtuoso.scrollHeight;
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
          // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where properties exist
          // @ts-ignore - scrollTop/scrollHeight exist on virtuoso element
          virtuoso.scrollTop = virtuoso.scrollHeight;
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
          // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where properties exist
          // @ts-ignore - scrollTop/scrollHeight exist on virtuoso element
          virtuoso.scrollTop = virtuoso.scrollHeight;
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
          // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where properties exist
          // @ts-ignore - scrollTop/scrollHeight exist on virtuoso element
          virtuoso.scrollTop = virtuoso.scrollHeight;
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
          // biome-ignore lint/suspicious/noTsIgnore: Code runs in browser context where properties exist
          // @ts-ignore - scrollTop/scrollHeight exist on virtuoso element
          virtuoso.scrollTop = virtuoso.scrollHeight;
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

  /**
   * Atomic hover-and-click for hover action toolbars.
   *
   * The dashboard uses a single shared `MessageHoverToolbar` per message list
   * (not one per bubble): a delegated `pointerover`/`pointermove` listener on
   * the list container finds the hovered row via `closest('[data-message-id]')`
   * and positions the overlay via `translateY`. The overlay is `pointer-events`
   * active and renders `HoverActionsToolbar`'s buttons (hover-action-*).
   *
   * Real pointer events are required — the handler's modality guard
   * (`messageInteractionModality.current !== 'pointer'`) is only flipped by a
   * genuine `pointermove`, which `page.mouse.move` fires. Synthetic
   * `dispatchEvent('mouseover')` on the row does not flip modality and the
   * overlay never mounts.
   */
  @Step('clicking hover action <hoverActionSelector> on message with text <messageText>')
  public async clickHoverActionOnMessage(
    hoverActionSelector: string,
    messageText: string
  ): Promise<void> {
    const page = testContext.activePage;

    let message = page.locator(`[data-testid^="chat-message-"]:has-text("${messageText}")`).last();
    if (!(await message.isVisible().catch(() => false))) {
      message = page.locator('[data-testid^="chat-message-"]').last();
    }
    await message.waitFor({ state: 'visible' });

    const actionButton = page.locator(hoverActionSelector).first();
    for (let attempt = 1; attempt <= 3; attempt++) {
      await message.scrollIntoViewIfNeeded();
      await message.evaluate(dispatchHoverEvents);
      try {
        await actionButton.waitFor({ state: 'visible', timeout: 5000 });
        await actionButton.click({ force: true, timeout: 5000 });
        return;
      } catch (error) {
        if (attempt === 3) throw error;
      }
    }
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

  @Step('clicking on "[data-testid=\'nav-chat\']"')
  public async clickNavChat(): Promise<void> {
    await testContext.activePage.locator("[data-testid='nav-chat']").first().click();
  }

  @Step('Navigating to chat')
  public async navigateToChat(): Promise<void> {
    await testContext.activePage.locator("[data-testid='nav-chat']").first().click();
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
}
