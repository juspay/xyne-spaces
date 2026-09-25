import { testContext } from '@/tests/shared/runtime/test-context';

const MESSAGE_TIMEOUT_MS = 30000;
const ACTION_TIMEOUT_MS = 15000;
const CLICK_ATTEMPT_MS = 3000;
const REARM_INTERVAL_MS = 250;

/**
 * Each message list mounts ONE shared HoverActionsToolbar, keyed to the last row a delegated
 * pointerover resolved and positioned outside that row's own box. Three consequences:
 *
 * - A physical `hover()` walks the mouse out of the row on its way to the button and unmounts the
 *   toolbar mid-click, so hover synthetically instead.
 * - Playwright leaves the cursor wherever it last clicked. Parked inside the list, it re-claims the
 *   toolbar for whatever row slides under it when the layout shifts (pinning inserts a divider),
 *   which fights the synthetic hover. Park it outside the list first.
 * - Virtuoso remounts rows while measuring, dropping the hover state and issuing a fresh useId, so
 *   re-arm and re-read `data-hover-key` every attempt. Matching the toolbar on that key is what
 *   keeps this on the intended message.
 */
export async function clickHoverActionOnMessage(
  hoverActionSelector: string,
  messageText: string
): Promise<void> {
  const page = testContext.activePage;

  // ponytail: `.last()` takes the newest of several substring matches — fine while specs use
  // distinct message text. Scope to the list container if one ever needs two of the same.
  const message = page.locator(`[data-testid^="chat-message-"]:has-text("${messageText}")`).last();
  await message.waitFor({ state: 'visible', timeout: MESSAGE_TIMEOUT_MS });
  await message.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);

  const deadline = Date.now() + ACTION_TIMEOUT_MS;
  let lastError = 'the toolbar never mounted for this message';
  for (;;) {
    await message
      .evaluate((el) => {
        // biome-ignore lint/suspicious/noTsIgnore: MouseEvent exists in browser context
        // @ts-ignore - browser context
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
        // biome-ignore lint/suspicious/noTsIgnore: MouseEvent exists in browser context
        // @ts-ignore - browser context
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: true }));
      })
      .catch(() => {});

    const hoverKey = await message.getAttribute('data-hover-key').catch(() => null);
    if (hoverKey === null) {
      lastError = 'the row carries no data-hover-key';
    } else {
      // force skips the actionability re-check; the key scope keeps this on the right message.
      // Synthetic clicks did not fire React's handler.
      const clicked = await page
        .locator(`[data-hover-key="${hoverKey}"]`)
        .locator(hoverActionSelector)
        .first()
        .click({ force: true, timeout: CLICK_ATTEMPT_MS })
        .then(() => true)
        .catch((error: Error) => {
          lastError = error.message.split('\n')[0];
          return false;
        });
      if (clicked) return;
      await page.mouse.move(0, 0);
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `Hover action "${hoverActionSelector}" never became clickable on message "${messageText}": ${lastError}`
      );
    }
    await page.waitForTimeout(REARM_INTERVAL_MS);
  }
}
