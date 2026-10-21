import { testContext } from '@/tests/shared/runtime/test-context';

const MORE_ACTIONS_SELECTOR = "[data-testid='hover-action-more']";

/**
 * Hovers the last chat message containing `messageText` and clicks the hover
 * action matching `hoverActionSelector`. Pass `scopeSelector` to look only
 * inside one container (e.g. the thread panel), since a thread's root message
 * renders both in the channel list and in the thread panel.
 */
export async function clickHoverActionOnMessage(
  hoverActionSelector: string,
  messageText: string,
  scopeSelector = 'body'
): Promise<void> {
  const page = testContext.activePage;
  const scope = page.locator(scopeSelector).first();
  const message = scope.locator(`[data-testid^="chat-message-"]:has-text("${messageText}")`).last();
  // Each list (channel, thread panel) renders its own shared toolbar inside it.
  const actionButton = scope.locator(hoverActionSelector).first();

  // Each attempt starts over: the row can re-render under us (a just-sent message
  // is swapped for the saved one, new messages arrive), the toolbar hides whenever
  // the list scrolls, and re-hovering the same point fires no new pointerover, so
  // the pointer moves off the list before every hover.
  const attempts = 5;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await message.waitFor({ state: 'visible', timeout: 15000 });
      await page.mouse.move(0, 0);
      await message.scrollIntoViewIfNeeded({ timeout: 5000 });
      await message.hover({ force: true, timeout: 5000 });
      await actionButton.waitFor({ state: 'visible', timeout: 5000 });
      // The shared toolbar acts on whichever row is under the pointer. When another
      // session posts to the same conversation the rows shift under a still pointer,
      // so make sure the toolbar is still on our row right before clicking.
      if ((await message.getAttribute('data-hovered')) === null) {
        throw new Error(`Hover moved off the message "${messageText}" before clicking`);
      }
      await actionButton.click({ force: true, timeout: 5000 });
      if (hoverActionSelector === MORE_ACTIONS_SELECTOR) {
        await page.locator('[role="menu"]').first().waitFor({ state: 'visible', timeout: 5000 });
      }
      return;
    } catch (error) {
      if (attempt === attempts) {
        throw error;
      }
      // Close a half-open menu so the next attempt starts from a clean toolbar.
      await page.keyboard.press('Escape').catch(() => {});
    }
  }
}
