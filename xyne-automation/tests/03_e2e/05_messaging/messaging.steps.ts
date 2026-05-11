import assert from 'node:assert/strict';
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
    await page.waitForLoadState('networkidle');
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
}
