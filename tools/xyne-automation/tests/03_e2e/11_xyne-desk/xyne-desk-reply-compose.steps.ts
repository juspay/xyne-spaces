import assert from 'node:assert/strict';
import { Step } from 'gauge-ts';
import { config } from '@/config';
import { getStoredUser } from '@/fixtures/fixture-helpers';
import {
  assertConversationId,
  assertFixture,
  assertStatus,
  fetchAndStoreDeskTicketDetails,
  fetchSentMails,
  getLatestSentMail,
  getStoredChannelId,
  waitForComposedConversationId,
  withDevAuthenticatedApiContext,
} from '@/tests/03_e2e/11_xyne-desk/xyne-desk-api';
import {
  clickWhenVisible,
  focusDeskEmailComposerEditor,
  getDeskEmailComposer,
  gotoDeskUrl,
  openDeskReplyComposer,
  openDeskTicketBySubject,
  openStoredDeskChannelUrl,
  sendDeskEmailFromComposer,
  waitForVisible,
} from '@/tests/03_e2e/11_xyne-desk/xyne-desk-browser';
import { buildComposedMail } from '@/tests/03_e2e/11_xyne-desk/xyne-desk-mock-mail';
import {
  DEFAULT_DESK_API_USER_ALIAS,
  DESK_UI_TIMEOUT_MS,
  deskChannelDlEmails,
  mockDeskMails,
} from '@/tests/03_e2e/11_xyne-desk/xyne-desk-state';
import { testContext } from '@/tests/shared/runtime/test-context';
import {
  assertValidChannelAlias,
  assertValidUserAlias,
} from '@/tests/shared/support/literal-validation';

/** Opens the mail's ticket in the channel and sends `body` through Reply / Reply all. */
async function replyFromDeskChannel(
  mode: 'Reply' | 'Reply all',
  mailAlias: string,
  channelAlias: string,
  userAlias: string,
  body: string
): Promise<void> {
  const mail = assertFixture(mailAlias);
  getStoredChannelId(channelAlias, userAlias);
  assertConversationId(mail);

  await openDeskTicketBySubject(channelAlias, userAlias, mail.subject);
  await openDeskReplyComposer(mode, mail.messageId);
  await sendDeskEmailFromComposer(body);
  await testContext.activePage.waitForTimeout(500);
}

/** Asserts the latest captured reply for the mail's conversation. */
async function assertLatestReplySentMail(
  mailAlias: string,
  expected: { to: string[]; cc: string[]; body: RegExp; missingMessage: string }
): Promise<void> {
  const mail = assertFixture(mailAlias);
  const latest = await getLatestSentMail(
    { conversationId: assertConversationId(mail) },
    expected.missingMessage
  );

  assert.equal(latest.kind, 'reply');
  assert.equal(latest.status, 'sent');
  assert.equal(latest.from, mail.to);
  assert.deepEqual(latest.to, expected.to);
  assert.deepEqual(latest.cc ?? [], expected.cc);
  assert.deepEqual(latest.bcc ?? [], []);
  assert.equal(latest.subject, `Re: ${mail.subject}`);
  assert.match(String(latest.body), expected.body);
}

export default class XyneDeskReplyComposeSteps {
  // ---------------------------------------------------------------------------
  // ACTION
  // ---------------------------------------------------------------------------

  @Step('replying to mock Desk email <mailAlias> from channel <channelAlias> for user <userAlias>')
  public async replyToMockEmail(
    mailAlias: string,
    channelAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    await replyFromDeskChannel(
      'Reply',
      mailAlias,
      channelAlias,
      userAlias,
      'Thanks, we are checking this from Xyne Desk automation.'
    );
  }

  @Step(
    'replying all to mock Desk email <mailAlias> from channel <channelAlias> for user <userAlias>'
  )
  public async replyAllToMockEmail(
    mailAlias: string,
    channelAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    await replyFromDeskChannel(
      'Reply all',
      mailAlias,
      channelAlias,
      userAlias,
      'Reply-all response from Xyne Desk automation.'
    );
  }

  @Step('composing mock Desk email <mailAlias> from channel <channelAlias> for user <userAlias>')
  public async composeMockDeskEmail(
    mailAlias: string,
    channelAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    const mail = buildComposedMail(
      mailAlias,
      channelAlias,
      deskChannelDlEmails.get(channelAlias) ?? config.desk.mockDlEmail
    );

    await openStoredDeskChannelUrl(channelAlias, userAlias);
    const page = testContext.activePage;
    await clickWhenVisible(page.locator('[data-track-name="OpenComposeEmail"]').first());
    const composer = getDeskEmailComposer();
    await waitForVisible(composer);
    const toInput = composer.locator('[data-track-name="EditToField"]').first();
    await toInput.fill(mail.to);
    await toInput.press('Enter');
    await composer.locator('input[aria-label="Subject"]').fill(mail.subject);
    await sendDeskEmailFromComposer(mail.composedText ?? '');
    mail.conversationId = await waitForComposedConversationId(
      userAlias,
      getStoredChannelId(channelAlias, userAlias),
      mail.subject
    );
    await page.waitForTimeout(500);
    mockDeskMails.set(mailAlias, mail);
  }

  @Step('merging mock Desk ticket <sourceMailAlias> into <targetMailAlias> as user <userAlias>')
  public async mergeMockDeskTicket(
    sourceMailAlias: string,
    targetMailAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    const source = await fetchAndStoreDeskTicketDetails(sourceMailAlias);
    const target = await fetchAndStoreDeskTicketDetails(targetMailAlias);
    assert.ok(source.ticket?.id, `Expected source ticket for "${sourceMailAlias}".`);
    assert.ok(target.ticket?.id, `Expected target ticket for "${targetMailAlias}".`);

    const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
      apiContext.post(`/api/tickets/${source.ticket?.id}/merge`, {
        data: { targetTicketId: target.ticket?.id },
      })
    );
    await assertStatus(response, 'Desk ticket merge');
  }

  @Step('unmerging mock Desk ticket <sourceMailAlias> as user <userAlias>')
  public async unmergeMockDeskTicket(sourceMailAlias: string, userAlias: string): Promise<void> {
    assertValidUserAlias(userAlias);
    const source = await fetchAndStoreDeskTicketDetails(sourceMailAlias);
    assert.ok(source.ticket?.id, `Expected source ticket for "${sourceMailAlias}".`);

    const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
      apiContext.post(`/api/tickets/${source.ticket?.id}/unmerge`)
    );
    await assertStatus(response, 'Desk ticket unmerge');
  }

  @Step('unmerging mock Desk ticket <sourceMailAlias> through the UI for user <userAlias>')
  public async unmergeMockDeskTicketThroughUi(
    sourceMailAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    const source = await fetchAndStoreDeskTicketDetails(sourceMailAlias);
    const user = getStoredUser(userAlias);
    const targetTicketId = source.ticket?.mergedIntoTicketId;
    assert.ok(targetTicketId, `Expected ticket for "${sourceMailAlias}" to be merged.`);
    // The merged source ticket is archived; its email (with the Unmerge action)
    // is rendered inside the target ticket.
    const targetAlias = [...mockDeskMails.values()].find(
      (candidate) => candidate.ticketId === targetTicketId
    )?.alias;
    assert.ok(
      targetAlias,
      `Expected a stored mock mail for merge target ticket ${targetTicketId}.`
    );
    const target = await fetchAndStoreDeskTicketDetails(targetAlias);
    const ticket = target.ticket;
    const channelId = ticket?.channelId;
    assert.ok(ticket?.xyneId && channelId, `Expected ticket details for "${targetAlias}".`);

    await gotoDeskUrl(
      `${config.dashboard.baseUrl}/${user.workspaceId}/support/${channelId}/${ticket.xyneId}`
    );
    await clickWhenVisible(
      testContext.activePage.locator("[data-track-name='UnmergeTicket']").first()
    );
    await testContext.activePage.waitForTimeout(500);
  }

  // ---------------------------------------------------------------------------
  // ASSERTION
  // ---------------------------------------------------------------------------

  @Step('verifying Desk compose control is available for channel <channelAlias> user <userAlias>')
  public async verifyDeskComposeControlAvailable(
    channelAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    await openStoredDeskChannelUrl(channelAlias, userAlias);

    await waitForVisible(
      testContext.activePage.locator('[data-track-name="OpenComposeEmail"]').first()
    );
  }

  @Step(
    'verifying Desk priority and status filters work for channel <channelAlias> user <userAlias>'
  )
  public async verifyDeskFiltersWork(channelAlias: string, userAlias: string): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    await openStoredDeskChannelUrl(channelAlias, userAlias);
    const page = testContext.activePage;
    await page.locator("[data-testid='desk-filter-priority']").click();
    const high = page.locator("[data-testid='priority-filter-high']");
    await clickWhenVisible(high);
    assert.match((await high.getAttribute('class')) ?? '', /bg-accent/);

    await page.keyboard.press('Escape');
    await page.locator("[data-testid='desk-filter-status']").click();
    await waitForVisible(page.getByPlaceholder('Search status...'));
    await clickWhenVisible(page.getByRole('button', { name: 'In Progress', exact: true }).last());

    await page.keyboard.press('Escape');
    const clear = page.locator('[data-track-name="CLEAR_SUPPORT_FILTERS"]');
    await clickWhenVisible(clear);
    await clear.waitFor({ state: 'hidden', timeout: DESK_UI_TIMEOUT_MS });
  }

  @Step('verifying Desk AI and rewrite controls are available for email <mailAlias>')
  public async verifyDeskAiAndRewriteControlsAvailable(mailAlias: string): Promise<void> {
    const mail = assertFixture(mailAlias);
    assert.ok(mail.channelAlias, `Expected mock mail "${mailAlias}" to store channel alias.`);
    await openStoredDeskChannelUrl(mail.channelAlias, DEFAULT_DESK_API_USER_ALIAS);

    const page = testContext.activePage;
    await clickWhenVisible(page.getByText(mail.subject, { exact: false }).first());
    await waitForVisible(page.locator('[data-track-name="OPEN_XYNE_AI"]').first());

    await openDeskReplyComposer('Reply', mail.messageId);
    await focusDeskEmailComposerEditor();
    await page.keyboard.insertText('Please rewrite this Desk automation reply.');

    // Only opens the refine menu and checks its entries; no rewrite is invoked,
    // so the scenario never calls an external AI provider.
    await clickWhenVisible(
      getDeskEmailComposer().locator('[data-track-name="ToggleAIRefineDropdown"]').first()
    );
    for (const action of ['polish', 'shorten']) {
      await waitForVisible(
        page.locator(`[data-track-name="QuickRewrite"][data-track-metadata*='"${action}"']`).first()
      );
    }
    await waitForVisible(page.locator('[data-track-name="OpenAskAIFromDropdown"]').first());
  }

  @Step('verifying latest mock Desk composed mail matches <mailAlias>')
  public async verifyLatestMockComposedMail(mailAlias: string): Promise<void> {
    const mail = assertFixture(mailAlias);
    assert.ok(mail.channelAlias, `Expected composed mail "${mailAlias}" to store channel alias.`);
    const channelId = getStoredChannelId(mail.channelAlias, DEFAULT_DESK_API_USER_ALIAS);

    const latest = await getLatestSentMail(
      { channelId },
      'Expected latest mock Desk composed mail to exist.'
    );
    assert.equal(latest.kind, 'compose');
    assert.equal(latest.status, 'sent');
    assert.deepEqual(latest.to, [mail.to]);
    assert.deepEqual(latest.cc, mail.cc ?? []);
    assert.equal(latest.subject, mail.subject);
    assert.match(String(latest.body), /New composed Desk mail/);
  }

  @Step('verifying mock Desk sent mail count is <expectedCount> for incoming email <mailAlias>')
  public async verifyMockSentMailCount(expectedCount: string, mailAlias: string): Promise<void> {
    const conversationId = assertConversationId(assertFixture(mailAlias));
    const sentMails = await fetchSentMails({ conversationId });

    assert.equal(
      sentMails.length,
      Number.parseInt(expectedCount, 10),
      `Expected ${expectedCount} mock Desk sent mail(s).`
    );
  }

  @Step('verifying latest mock Desk sent mail matches incoming email <mailAlias>')
  public async verifyLatestMockSentMail(mailAlias: string): Promise<void> {
    const mail = assertFixture(mailAlias);
    await assertLatestReplySentMail(mailAlias, {
      to: mail.replyTo?.length ? mail.replyTo : [mail.from],
      cc: [],
      body: /Xyne Desk automation/,
      missingMessage: 'Expected latest mock Desk sent mail to exist.',
    });
  }

  @Step('verifying latest mock Desk sent reply-all mail matches incoming email <mailAlias>')
  public async verifyLatestMockReplyAllSentMail(mailAlias: string): Promise<void> {
    const mail = assertFixture(mailAlias);
    await assertLatestReplySentMail(mailAlias, {
      to: [mail.replyTo?.[0] ?? mail.from],
      cc: mail.cc ?? [],
      body: /Reply-all response/,
      missingMessage: 'Expected latest mock Desk sent reply-all mail to exist.',
    });
  }

  @Step('verifying mock Desk ticket <sourceMailAlias> is merged into <targetMailAlias>')
  public async verifyMockDeskTicketMerged(
    sourceMailAlias: string,
    targetMailAlias: string
  ): Promise<void> {
    const source = await fetchAndStoreDeskTicketDetails(sourceMailAlias);
    const target = await fetchAndStoreDeskTicketDetails(targetMailAlias);

    assert.equal(source.ticket?.isArchived, true);
    assert.equal(source.ticket?.mergedIntoTicketId, target.ticket?.id);
  }

  @Step('verifying mock Desk ticket <sourceMailAlias> is unmerged')
  public async verifyMockDeskTicketUnmerged(sourceMailAlias: string): Promise<void> {
    const source = await fetchAndStoreDeskTicketDetails(sourceMailAlias);

    assert.equal(source.ticket?.isArchived, false);
    assert.equal(source.ticket?.mergedIntoTicketId, null);
  }
}
