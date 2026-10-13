import assert from 'node:assert/strict';
import { Step } from 'gauge-ts';
import { config } from '@/config';
import { getStoredUser } from '@/fixtures/fixture-helpers';
import {
  assertConversationId,
  assertFixture,
  assertStatus,
  extractConversationId,
  fetchAndStoreDeskTicketDetails,
  fetchChannelTickets,
  getStoredChannelId,
  withDevAuthenticatedApiContext,
} from '@/tests/03_e2e/11_xyne-desk/xyne-desk-api';
import { escapeRegExp } from '@/tests/03_e2e/11_xyne-desk/xyne-desk-browser';
import {
  buildAutoMergeMailPair,
  buildIncomingMail,
  buildReplyAllMailWithAttachment,
  buildSlackMessage,
} from '@/tests/03_e2e/11_xyne-desk/xyne-desk-mock-mail';
import {
  DEFAULT_DESK_API_USER_ALIAS,
  deskChannelDlEmails,
  mockDeskMails,
  slackChannelIds,
} from '@/tests/03_e2e/11_xyne-desk/xyne-desk-state';
import {
  assertValidChannelAlias,
  assertValidUserAlias,
} from '@/tests/shared/support/literal-validation';

/** Posts a mock inbound event, then stores its conversation and ticket ids on the mail. */
async function injectMockDeskEvent(
  mailAlias: string,
  userAlias: string,
  path: string,
  data: Record<string, unknown>,
  label: string,
  missingConversationMessage: string
): Promise<void> {
  const mail = assertFixture(mailAlias);
  const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
    apiContext.post(path, { data })
  );
  await assertStatus(response, label);

  const body = (await response.json()) as Record<string, unknown>;
  mail.conversationId = extractConversationId(body, missingConversationMessage);
  await fetchAndStoreDeskTicketDetails(mailAlias);
}

export default class XyneDeskMailSteps {
  // ---------------------------------------------------------------------------
  // SETUP
  // ---------------------------------------------------------------------------

  @Step('generating mock incoming Desk email <mailAlias>')
  public async generateMockIncomingEmail(mailAlias: string): Promise<void> {
    mockDeskMails.set(mailAlias, buildIncomingMail(mailAlias));
  }

  @Step(
    'generating mock Desk email pair <firstMailAlias> and <secondMailAlias> with the same subject and domain'
  )
  public async generateMockDeskEmailPair(
    firstMailAlias: string,
    secondMailAlias: string
  ): Promise<void> {
    for (const mail of buildAutoMergeMailPair(firstMailAlias, secondMailAlias)) {
      mockDeskMails.set(mail.alias, mail);
    }
  }

  @Step('generating mock incoming Desk email <mailAlias> with reply-all recipients and attachment')
  public async generateMockIncomingEmailWithReplyAllAndAttachment(
    mailAlias: string
  ): Promise<void> {
    mockDeskMails.set(mailAlias, buildReplyAllMailWithAttachment(mailAlias));
  }

  @Step('generating mock Slack Desk message <mailAlias>')
  public async generateMockSlackDeskMessage(mailAlias: string): Promise<void> {
    mockDeskMails.set(mailAlias, buildSlackMessage(mailAlias));
  }

  // ---------------------------------------------------------------------------
  // ACTION
  // ---------------------------------------------------------------------------

  @Step(
    'injecting mock incoming Desk email <mailAlias> into channel <channelAlias> for user <userAlias>'
  )
  public async injectMockIncomingEmail(
    mailAlias: string,
    channelAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    const mail = assertFixture(mailAlias);
    const channelId = getStoredChannelId(channelAlias, userAlias);
    const dlEmail = deskChannelDlEmails.get(channelAlias) || config.desk.mockDlEmail;
    mail.to = dlEmail;
    mail.channelAlias = channelAlias;

    await injectMockDeskEvent(
      mailAlias,
      userAlias,
      '/api/test/desk/incoming-email',
      {
        channelId,
        from: mail.from,
        to: [dlEmail],
        cc: mail.cc ?? [],
        bcc: mail.bcc ?? [],
        replyTo: mail.replyTo ?? [],
        subject: mail.subject,
        body: mail.body,
        threadId: mail.threadId,
        messageId: mail.messageId,
        attachments: mail.attachments ?? [],
      },
      'Mock incoming Desk email injection',
      'Expected incoming mail response to include conversationId.'
    );
  }

  @Step(
    'injecting mock Slack Desk message <mailAlias> into channel <channelAlias> for user <userAlias>'
  )
  public async injectMockSlackDeskMessage(
    mailAlias: string,
    channelAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    const mail = assertFixture(mailAlias);
    const channelId = getStoredChannelId(channelAlias, userAlias);
    const slackChannelId = slackChannelIds.get(channelAlias);
    assert.ok(slackChannelId, `Expected stored Slack channel id for "${channelAlias}".`);
    mail.to = `${slackChannelId}@slack.example.test`;
    mail.channelAlias = channelAlias;

    await injectMockDeskEvent(
      mailAlias,
      userAlias,
      '/api/test/desk/slack-event',
      {
        channelId,
        from: mail.from,
        to: [mail.to],
        subject: mail.subject,
        body: mail.body,
        threadId: mail.threadId,
        messageId: mail.messageId,
      },
      'Mock Slack Desk event injection',
      'Expected Slack message response to include conversationId.'
    );
  }

  @Step(
    'updating mock Desk ticket for email <mailAlias> priority to <priority> and status to <status>'
  )
  public async updateMockDeskTicket(
    mailAlias: string,
    priority: string,
    status: string
  ): Promise<void> {
    const conversationId = assertConversationId(assertFixture(mailAlias));

    const response = await withDevAuthenticatedApiContext(
      DEFAULT_DESK_API_USER_ALIAS,
      (apiContext) =>
        apiContext.patch(`/api/test/desk/ticket/${conversationId}`, {
          data: {
            priority,
            status,
          },
        })
    );
    await assertStatus(response, 'Mock Desk ticket update');
  }

  // ---------------------------------------------------------------------------
  // ASSERTION
  // ---------------------------------------------------------------------------

  @Step('verifying mock Desk email <mailAlias> was ingested')
  public async verifyMockEmailWasIngested(mailAlias: string): Promise<void> {
    const mail = assertFixture(mailAlias);
    const details = await fetchAndStoreDeskTicketDetails(mailAlias);
    assert.ok(details.ticket?.id, `Expected mock Desk email "${mailAlias}" to create a ticket.`);
    assert.equal(details.emails?.[0]?.subject, mail.subject);
    assert.equal(details.emails?.[0]?.from, mail.from);
    if (mail.composedText) {
      const visibleText = String(details.emails?.[0]?.body ?? '').replace(/<[^>]*>/g, ' ');
      assert.ok(
        visibleText.includes(mail.composedText),
        `Expected composed mail body to contain "${mail.composedText}". Actual: ${visibleText}`
      );
    } else {
      assert.equal(details.emails?.[0]?.body, mail.body);
    }
    if (mail.channelAlias) {
      const channel = getStoredUser(DEFAULT_DESK_API_USER_ALIAS).channels[mail.channelAlias];
      assert.equal(details.ticket?.channelId, channel?.id);
    }
  }

  @Step(
    'verifying Desk channel <channelAlias> contains only email <mailAlias> for user <userAlias>'
  )
  public async verifyDeskChannelContainsOnlyEmail(
    channelAlias: string,
    mailAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    const mail = assertFixture(mailAlias);
    const channelId = getStoredChannelId(channelAlias, userAlias);

    const tickets = await fetchChannelTickets(userAlias, channelId, 'Desk channel ticket listing');
    const actualTitles = tickets.map((ticket) => ticket.title);
    assert.deepEqual(
      actualTitles,
      [mail.subject],
      `Expected channel "${channelAlias}" to contain only email "${mailAlias}" ("${mail.subject}"). Actual ticket titles: ${JSON.stringify(actualTitles)}`
    );
  }

  @Step(
    'verifying mock Desk ticket for email <mailAlias> has expected subject body sender and attachment'
  )
  public async verifyMockDeskTicketDetails(mailAlias: string): Promise<void> {
    const mail = assertFixture(mailAlias);
    const details = await fetchAndStoreDeskTicketDetails(mailAlias);
    const ticket = details.ticket;
    const firstEmail = details.emails?.[0];

    assert.equal(ticket?.title, mail.subject);
    assert.match(String(ticket?.description ?? ''), new RegExp(escapeRegExp(mail.body)));
    assert.equal(firstEmail?.subject, mail.subject);
    assert.equal(firstEmail?.body, mail.body);
    assert.equal(firstEmail?.from, mail.from);
    assert.deepEqual(firstEmail?.cc ?? [], mail.cc ?? []);
    assert.deepEqual(firstEmail?.replyTo ?? [], mail.replyTo ?? []);

    const expectedAttachments = mail.attachments ?? [];
    assert.equal(
      details.attachments?.length ?? 0,
      expectedAttachments.length,
      `Expected ${expectedAttachments.length} attachment(s) for "${mailAlias}".`
    );
    for (const attachment of expectedAttachments) {
      assert.ok(
        details.attachments?.some(
          (candidate) =>
            candidate.originalFilename === attachment.filename &&
            candidate.mimetype === attachment.mimetype &&
            candidate.size === attachment.size
        ),
        `Expected attachment "${attachment.filename}" to be stored.`
      );
    }
  }

  @Step(
    'verifying Desk data shows mock email <mailAlias> in channel <channelAlias> for user <userAlias>'
  )
  public async verifyDeskDataShowsMockEmail(
    mailAlias: string,
    channelAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    const mail = assertFixture(mailAlias);
    const channelId = getStoredChannelId(channelAlias, userAlias);

    const details = await fetchAndStoreDeskTicketDetails(mailAlias);
    assert.equal(details.ticket?.channelId, channelId);
    assert.equal(details.ticket?.title, mail.subject);
    assert.equal(details.emails?.[0]?.body, mail.body);
  }

  @Step(
    'verifying mock Desk ticket for email <mailAlias> priority is <priority> and status is <status>'
  )
  public async verifyMockDeskTicketUpdate(
    mailAlias: string,
    priority: string,
    status: string
  ): Promise<void> {
    const details = await fetchAndStoreDeskTicketDetails(mailAlias);
    assert.equal(details.ticket?.priority, priority);
    assert.equal(details.ticket?.statusV2, status);
  }

  @Step('verifying mock Desk emails <firstMailAlias> and <secondMailAlias> share one conversation')
  public async verifyMockDeskEmailsShareConversation(
    firstMailAlias: string,
    secondMailAlias: string
  ): Promise<void> {
    const first = assertFixture(firstMailAlias);
    const second = assertFixture(secondMailAlias);
    assert.ok(
      first.conversationId && second.conversationId,
      'Expected both emails to be ingested.'
    );
    assert.equal(second.conversationId, first.conversationId);
  }

  @Step(
    'verifying mock Desk emails <firstMailAlias> and <secondMailAlias> have separate conversations'
  )
  public async verifyMockDeskEmailsHaveSeparateConversations(
    firstMailAlias: string,
    secondMailAlias: string
  ): Promise<void> {
    const first = assertFixture(firstMailAlias);
    const second = assertFixture(secondMailAlias);
    assert.ok(
      first.conversationId && second.conversationId,
      'Expected both emails to be ingested.'
    );
    assert.notEqual(second.conversationId, first.conversationId);
  }
}
