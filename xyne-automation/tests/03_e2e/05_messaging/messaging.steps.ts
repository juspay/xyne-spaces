import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { Step } from 'gauge-ts';
import { BASELINE_DM_KEY } from '@/fixtures/baseline';
import { buildRandomSuffix, getStoredUser } from '@/fixtures/fixture-helpers';
import { testContext } from '@/tests/shared/runtime/test-context';
import {
  assertValidChannelAlias,
  assertValidDmAlias,
  assertValidMessageAlias,
  assertValidUserAlias,
} from '@/tests/shared/support/literal-validation';

function ensureDmContext(userAlias: string, dmAlias: string): void {
  const user = getStoredUser(userAlias);
  if (!user.dms[dmAlias]) {
    user.dms[dmAlias] = { name: dmAlias, messages: {} };
  }
}

function ensureChannelContext(userAlias: string, channelAlias: string): void {
  const user = getStoredUser(userAlias);
  if (!user.channels[channelAlias]) {
    throw new Error(
      `No registered channel context for alias "${channelAlias}" for user "${userAlias}". Channel context must be populated by either baseline fixture rehydration or an explicit channel creation step before messaging steps can use it.`
    );
  }
}

function getStoredChannelMessageText(
  userAlias: string,
  channelAlias: string,
  messageAlias: string
): string {
  assertValidUserAlias(userAlias);
  assertValidChannelAlias(channelAlias);
  assertValidMessageAlias(messageAlias);
  const user = getStoredUser(userAlias);
  const message = user.channels[channelAlias]?.messages[messageAlias];
  assert.ok(
    message?.text,
    `No stored channel message "${messageAlias}" found for user "${userAlias}" in channel "${channelAlias}".`
  );
  return message.text;
}

async function clickHoverActionOnMessage(
  hoverActionSelector: string,
  messageText: string
): Promise<void> {
  const page = testContext.activePage;
  const message = page.locator(`[data-testid^="chat-message-"]:has-text("${messageText}")`).last();
  await message.waitFor({ state: 'visible' });

  const actionButton = page.locator(hoverActionSelector).first();
  // Hover actions vanish if the message re-renders under load — re-hover per attempt.
  for (let attempt = 1; attempt <= 3; attempt++) {
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

export default class MessagingSteps {
  // ===========================================
  // ACTION
  // ===========================================

  @Step('opening baseline DM for user <userAlias>')
  public async openingBaselineDmForUser(userAlias: string): Promise<void> {
    assertValidUserAlias(userAlias);
    const user = getStoredUser(userAlias);
    const dm = user.dms[BASELINE_DM_KEY];
    assert.ok(dm?.url, `Baseline DM URL not found for user "${userAlias}".`);
    const page = testContext.activePage;
    await page.goto(dm.url);
    await page.locator("[data-testid='message-input']").first().waitFor({ state: 'visible' });
    await page
      .locator("[data-testid='chat-list-loading']")
      .first()
      .waitFor({ state: 'hidden' })
      .catch(() => {
        // chat-list-loading may not render at all; safe to continue
      });
  }

  // ===========================================
  // SETUP
  // ===========================================

  @Step(
    'generating net-new message details <messageAlias> with text <baseText> in dm <dmAlias> for user <userAlias>'
  )
  public generateNetNewDmMessageDetails(
    messageAlias: string,
    baseText: string,
    dmAlias: string,
    userAlias: string
  ): void {
    assertValidMessageAlias(messageAlias);
    assertValidDmAlias(dmAlias);
    assertValidUserAlias(userAlias);

    ensureDmContext(userAlias, dmAlias);

    const user = getStoredUser(userAlias);
    if (user.dms[dmAlias].messages[messageAlias]) {
      return;
    }

    const suffix = buildRandomSuffix();
    const text = `${baseText}-${suffix}`;

    user.dms[dmAlias].messages[messageAlias] = {
      alias: messageAlias,
      baseText,
      text,
    };
  }

  @Step(
    'generating net-new message details <messageAlias> with text <baseText> in channel <channelAlias> for user <userAlias>'
  )
  public generateNetNewChannelMessageDetails(
    messageAlias: string,
    baseText: string,
    channelAlias: string,
    userAlias: string
  ): void {
    assertValidMessageAlias(messageAlias);
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);

    ensureChannelContext(userAlias, channelAlias);

    const user = getStoredUser(userAlias);
    if (user.channels[channelAlias].messages[messageAlias]) {
      return;
    }

    const suffix = buildRandomSuffix();
    const text = `${baseText}-${suffix}`;

    user.channels[channelAlias].messages[messageAlias] = {
      alias: messageAlias,
      baseText,
      text,
    };
  }

  @Step(
    'opening more actions for stored user <userAlias> channel <channelAlias> message <messageAlias>'
  )
  public async openMoreActionsForStoredChannelMessage(
    userAlias: string,
    channelAlias: string,
    messageAlias: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidChannelAlias(channelAlias);
    assertValidMessageAlias(messageAlias);
    await clickHoverActionOnMessage(
      "[data-testid='hover-action-more']",
      getStoredChannelMessageText(userAlias, channelAlias, messageAlias)
    );
  }

  @Step(
    'verifying message menu action <selector> is visible for stored user <userAlias> channel <channelAlias> message <messageAlias>'
  )
  public async verifyChannelMessageMenuActionVisible(
    selector: string,
    userAlias: string,
    channelAlias: string,
    messageAlias: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidChannelAlias(channelAlias);
    assertValidMessageAlias(messageAlias);
    await this.openMoreActionsForStoredChannelMessage(userAlias, channelAlias, messageAlias);
    await testContext.activePage.locator(selector).first().waitFor({ state: 'visible' });
  }

  @Step(
    'forwarding stored user <userAlias> channel <channelAlias> message <messageAlias> to user <targetUserAlias>'
  )
  public async forwardStoredChannelMessageToUser(
    userAlias: string,
    channelAlias: string,
    messageAlias: string,
    targetUserAlias: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidChannelAlias(channelAlias);
    assertValidMessageAlias(messageAlias);
    assertValidUserAlias(targetUserAlias);

    await this.openMoreActionsForStoredChannelMessage(userAlias, channelAlias, messageAlias);
    await testContext.activePage.locator("[data-testid='hover-action-forward-message']").click();
    await this.pickForwardTargetUser(targetUserAlias);
  }

  @Step(
    'verifying stored user <userAlias> channel <channelAlias> message <messageAlias> is deleted'
  )
  public async verifyStoredChannelMessageDeleted(
    userAlias: string,
    channelAlias: string,
    messageAlias: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidChannelAlias(channelAlias);
    assertValidMessageAlias(messageAlias);

    const messageText = getStoredChannelMessageText(userAlias, channelAlias, messageAlias);
    await expect(
      testContext.activePage.locator(`[data-testid^="chat-message-"]:has-text("${messageText}")`)
    ).toHaveCount(0, { timeout: 15000 });
  }

  @Step(
    'verifying clipboard contains stored channel message <messageAlias> for user <userAlias> channel <channelAlias>'
  )
  public async verifyClipboardContainsStoredChannelMessage(
    messageAlias: string,
    userAlias: string,
    channelAlias: string
  ): Promise<void> {
    assertValidMessageAlias(messageAlias);
    assertValidUserAlias(userAlias);
    assertValidChannelAlias(channelAlias);

    const messageText = getStoredChannelMessageText(userAlias, channelAlias, messageAlias);
    const clipboardText = await testContext.activePage.evaluate(() => {
      const clipboardNavigator = navigator as Navigator & {
        clipboard: { readText: () => Promise<string> };
      };
      return clipboardNavigator.clipboard.readText();
    });
    assert.ok(
      clipboardText.includes(messageText),
      `Expected clipboard text to include "${messageText}" but got "${clipboardText}".`
    );
  }

  @Step(
    'verifying clipboard contains copied channel message link for user <userAlias> channel <channelAlias>'
  )
  public async verifyClipboardContainsCopiedChannelMessageLink(
    userAlias: string,
    channelAlias: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidChannelAlias(channelAlias);

    const channel = getStoredUser(userAlias).channels[channelAlias];
    assert.ok(channel?.id, `No stored channel "${channelAlias}" found for user "${userAlias}".`);

    await expect
      .poll(
        async () => {
          const clipboardText = await testContext.activePage.evaluate(() => {
            const clipboardNavigator = navigator as Navigator & {
              clipboard: { readText: () => Promise<string> };
            };
            return clipboardNavigator.clipboard.readText();
          });
          return clipboardText;
        },
        {
          timeout: 10000,
          message: `Expected clipboard to contain copied link for channel "${channelAlias}".`,
        }
      )
      .toContain(`/chat/dir/${channel.id}`);
  }

  @Step(
    'sending clipboard text as stored channel message <messageAlias> in channel <channelAlias> for user <userAlias>'
  )
  public async sendClipboardTextAsStoredChannelMessage(
    messageAlias: string,
    channelAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidMessageAlias(messageAlias);
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    ensureChannelContext(userAlias, channelAlias);

    const clipboardText = await testContext.activePage.evaluate(() => {
      const clipboardNavigator = navigator as Navigator & {
        clipboard: { readText: () => Promise<string> };
      };
      return clipboardNavigator.clipboard.readText();
    });
    assert.ok(clipboardText.trim(), 'Expected clipboard text to be non-empty.');

    const user = getStoredUser(userAlias);
    user.channels[channelAlias].messages[messageAlias] = {
      alias: messageAlias,
      baseText: clipboardText,
      text: clipboardText,
    };

    await testContext.activePage.locator("[data-testid='message-input']").fill(clipboardText);
    await testContext.activePage.locator("[data-testid='send-message-button']").click();
  }

  @Step('sending clipboard text in message input')
  public async sendClipboardTextInMessageInput(): Promise<void> {
    const clipboardText = await testContext.activePage.evaluate(() => {
      const clipboardNavigator = navigator as Navigator & {
        clipboard: { readText: () => Promise<string> };
      };
      return clipboardNavigator.clipboard.readText();
    });
    assert.ok(clipboardText.trim(), 'Expected clipboard text to be non-empty.');

    await testContext.activePage.locator("[data-testid='message-input']").fill(clipboardText);
    await testContext.activePage.locator("[data-testid='send-message-button']").click();
  }

  @Step(
    'verifying copied channel message link preview is visible for user <userAlias> channel <channelAlias>'
  )
  public async verifyCopiedChannelMessageLinkPreviewVisible(
    userAlias: string,
    channelAlias: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidChannelAlias(channelAlias);

    const channel = getStoredUser(userAlias).channels[channelAlias];
    assert.ok(channel?.name, `No stored channel "${channelAlias}" found for user "${userAlias}".`);
    await expect(
      testContext.activePage.getByText(`Message in #${channel.name}`).last()
    ).toBeVisible({
      timeout: 15000,
    });
  }

  private async pickForwardTargetUser(targetUserAlias: string): Promise<void> {
    assertValidUserAlias(targetUserAlias);
    const targetUser = getStoredUser(targetUserAlias);
    const page = testContext.activePage;

    await page.locator("[data-testid='forward-message-form']").waitFor({ state: 'visible' });
    await page.locator("input[placeholder='Search channels or users...']").fill(targetUser.email);
    await page.locator('[data-combobox-popup]').getByText(targetUser.email).first().click();

    const forwardButton = page
      .locator("[data-testid='forward-message-form']")
      .getByRole('button', { name: 'Forward' });
    await expect(forwardButton).toBeEnabled({ timeout: 10000 });
    await forwardButton.click();
    await page.locator("[data-testid='forward-message-form']").waitFor({ state: 'hidden' });
  }
}
