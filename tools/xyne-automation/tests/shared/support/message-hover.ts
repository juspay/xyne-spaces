import { testContext } from '@/tests/shared/runtime/test-context';

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
  const message = page
    .locator(scopeSelector)
    .first()
    .locator(`[data-testid^="chat-message-"]:has-text("${messageText}")`)
    .last();
  const actionButton = page.locator(hoverActionSelector).first();

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
      await actionButton.click({ force: true, timeout: 5000 });
      return;
    } catch (error) {
      if (attempt === attempts) {
        throw error;
      }
    }
  }
}
