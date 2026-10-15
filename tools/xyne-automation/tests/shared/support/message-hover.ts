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
  await message.waitFor({ state: 'visible' });

  const actionButton = page.locator(hoverActionSelector).first();
  // The toolbar hides whenever the list scrolls (e.g. a new message arrives), and
  // re-hovering the same point fires no new pointerover, so move the pointer off
  // the list first to make every attempt a fresh hover.
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.mouse.move(0, 0);
    await message.scrollIntoViewIfNeeded();
    await message.hover({ force: true });
    try {
      await actionButton.waitFor({ state: 'visible', timeout: 5000 });
      await actionButton.click({ force: true, timeout: 5000 });
      return;
    } catch (error) {
      if (attempt === 3) {
        throw error;
      }
    }
  }
}
