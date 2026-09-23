import { testContext } from '@/tests/shared/runtime/test-context';

// How long to wait for the intended bubble, how long to keep re-arming the hover, how often.
const MESSAGE_TIMEOUT_MS = 30000;
const ACTION_TIMEOUT_MS = 15000;
const REARM_INTERVAL_MS = 250;

/**
 * Hover a message and click one of its hover actions.
 *
 * Why this is delicate:
 * The dashboard renders ONE shared HoverActionsToolbar, mounted only while a message has
 * hover state and positioned at `-top-7 right-4` — outside the message's own bounding box.
 * So a physical `locator.hover()` walks the mouse out of the message on its way to the
 * button, fires `onMouseLeave`, and unmounts the toolbar mid-click. Dispatching synthetic
 * `mouseover`/`mouseenter` on the message node instead sets React's hover state with no
 * mouse involved, so there is no mouseleave to race.
 *
 * Both events are dispatched: React's synthetic system listens to mouseover (delegated),
 * while some components listen to mouseenter. `bubbles: true` on mouseover lets it reach
 * the ChatBubble parent holding the handler.
 *
 * Two further races, both seen as flakes:
 * - Because the toolbar is shared and keyed to whatever was hovered last, hovering the
 *   wrong bubble silently reads a different message's menu — and a menu that legitimately
 *   lacks the action (a ticket card has no Edit) then burns the full timeout. So wait for
 *   the message we were asked for and never substitute another.
 * - Virtuoso remounts rows while it measures and as Zero syncs new messages, dropping the
 *   hover state a single dispatch had set. Re-arm until the action mounts.
 */
export async function clickHoverActionOnMessage(
  hoverActionSelector: string,
  messageText: string
): Promise<void> {
  const page = testContext.activePage;

  const message = page.locator(`[data-testid^="chat-message-"]:has-text("${messageText}")`).last();
  await message.waitFor({ state: 'visible', timeout: MESSAGE_TIMEOUT_MS });
  await message.scrollIntoViewIfNeeded();

  const actionButton = page.locator(hoverActionSelector).first();
  const deadline = Date.now() + ACTION_TIMEOUT_MS;
  for (;;) {
    await message
      .evaluate((el) => {
        // biome-ignore lint/suspicious/noTsIgnore: MouseEvent exists in browser context
        // @ts-ignore - MouseEvent exists in browser context
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
        // biome-ignore lint/suspicious/noTsIgnore: MouseEvent exists in browser context
        // @ts-ignore - MouseEvent exists in browser context
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: true }));
      })
      // The row can be mid-remount; the next poll re-resolves the locator.
      .catch(() => {});

    // The toolbar is shared and keyed to whatever is hovered, and `actionButton` is looked up
    // page-wide — so a toolbar still mounted for another message would answer here and the
    // step would act on the wrong menu. The app stamps `data-hovered` on the hovered row, so
    // require that the row we asked for owns it.
    const owned = (await message.getAttribute('data-hovered').catch(() => null)) !== null;
    if (owned && (await actionButton.isVisible().catch(() => false))) break;
    if (Date.now() >= deadline) {
      throw new Error(
        `Hover action "${hoverActionSelector}" never appeared for message "${messageText}". ` +
          'The toolbar is shared across messages, so it stayed closed — it did not open on another message.'
      );
    }
    await page.waitForTimeout(REARM_INTERVAL_MS);
  }

  // A real click: dispatching pointer/mouse events here did not reliably fire the React
  // handler (the create-ticket modal never opened). force:true skips the actionability
  // re-check, and the data-hovered guard above is what keeps the toolbar from belonging to
  // another message.
  await actionButton.click({ force: true });
}
