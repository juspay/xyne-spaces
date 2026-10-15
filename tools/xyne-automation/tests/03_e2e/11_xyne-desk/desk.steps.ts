import assert from 'node:assert/strict';
import { type APIResponse, expect, type Locator } from '@playwright/test';
import { Step } from 'gauge-ts';
import { config } from '@/config';
import { isBaselineChannelKey } from '@/fixtures/baseline';
import {
  createDeskChannel,
  deliverDeskEmails,
  type FakeGmailSentMail,
  type GmailDeliveryResult,
  generateDeskInboundTicket,
  listFakeGmailOutbox,
} from '@/fixtures/desk';
import { buildRandomSuffix, getStoredUser } from '@/fixtures/fixture-helpers';
import {
  type StoredConversation,
  type StoredDeskEmail,
  type StoredTicket,
  type StoredUser,
  testContext,
} from '@/tests/shared/runtime/test-context';
import {
  assertValidChannelAlias,
  assertValidProjectAlias,
  assertValidTicketAlias,
  assertValidUserAlias,
} from '@/tests/shared/support/literal-validation';

const SUPPORT_PAGE = "[data-testid='support-page']";
const DESK_UI_TIMEOUT_MS = config.timeout * 2;

// Batch tickets are stored as `<batchAlias>-<index>` so they stay ordinary
// validated ticket aliases and are reset with the rest of scenario state.
function batchTicketAlias(batchAlias: string, index: number): string {
  return `${batchAlias}-${index}`;
}

function getDeskChannel(user: StoredUser, channelAlias: string): StoredConversation {
  const channel = user.channels[channelAlias];
  assert.ok(
    channel?.id && channel.mailboxEmail,
    `Expected stored Desk channel "${channelAlias}" for user "${user.alias}".`
  );
  return channel;
}

function getDeskTicket(
  user: StoredUser,
  ticketAlias: string
): StoredTicket & { email: StoredDeskEmail } {
  const ticket = user.tickets[ticketAlias];
  assert.ok(
    ticket?.email,
    `Expected stored Desk ticket "${ticketAlias}" for user "${user.alias}".`
  );
  return ticket as StoredTicket & { email: StoredDeskEmail };
}

function getBatchTickets(user: StoredUser, batchAlias: string): StoredTicket[] {
  const tickets: StoredTicket[] = [];
  for (let index = 0; user.tickets[batchTicketAlias(batchAlias, index)]; index += 1) {
    tickets.push(user.tickets[batchTicketAlias(batchAlias, index)]);
  }
  assert.ok(tickets.length > 0, `Expected generated Desk batch "${batchAlias}".`);
  return tickets;
}

function parseCount(value: string, label: string): number {
  const count = Number.parseInt(value, 10);
  assert.ok(Number.isInteger(count) && count >= 0, `Invalid ${label} "${value}".`);
  return count;
}

async function readDeliveryResult(): Promise<GmailDeliveryResult> {
  const response = testContext.lastResponse as APIResponse | null;
  assert.ok(response, 'Expected a Desk delivery response. Deliver Desk email first.');
  assert.equal(
    response.status(),
    200,
    `Expected Desk delivery to succeed: ${await response.text()}`
  );
  return (await response.json()) as GmailDeliveryResult;
}

async function openDeskChannel(user: StoredUser, channelAlias: string): Promise<void> {
  const channel = getDeskChannel(user, channelAlias);
  assert.ok(channel.url, `Expected stored Desk channel "${channelAlias}" to have a url.`);
  await testContext.activePage.goto(channel.url, { waitUntil: 'domcontentloaded' });
  await testContext.activePage
    .locator(SUPPORT_PAGE)
    .waitFor({ state: 'visible', timeout: DESK_UI_TIMEOUT_MS });
}

// The ticket page also hosts the internal-thread chat editor, so scope to the
// innermost container holding both an editor and the "Send email" button.
function emailComposer(): Locator {
  const page = testContext.activePage;
  return page
    .locator('div')
    .filter({ has: page.getByRole('button', { name: 'Send email' }) })
    .filter({ has: page.locator('[contenteditable="true"]') })
    .last();
}

async function sendFromComposer(body: string): Promise<void> {
  const composer = emailComposer();
  await composer.waitFor({ state: 'visible', timeout: DESK_UI_TIMEOUT_MS });
  const editor = composer.locator('[contenteditable="true"]').last();
  await editor.click();
  await editor.fill(body);
  // The send's effect is asserted on the fake Gmail outbox, which waits for it.
  await composer.getByRole('button', { name: 'Send email' }).last().click();
}

async function waitForOutbox(
  query: { threadId: string } | { to: string },
  predicate: (mail: FakeGmailSentMail) => boolean,
  description: string
): Promise<FakeGmailSentMail> {
  let matching: FakeGmailSentMail | undefined;
  await expect
    .poll(
      async () => {
        matching = (await listFakeGmailOutbox(query)).find(predicate);
        return matching !== undefined;
      },
      {
        message: `Expected fake Gmail outbox to contain ${description}.`,
        timeout: DESK_UI_TIMEOUT_MS,
      }
    )
    .toBe(true);
  assert.ok(matching);
  return matching;
}

export default class DeskSteps {
  // ===========================================
  // SETUP
  // ===========================================

  @Step(
    'ensuring Desk channel <channelAlias> exists in fixture for user <userAlias> in project <projectAlias>'
  )
  public async ensureDeskChannel(
    channelAlias: string,
    userAlias: string,
    projectAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    assertValidProjectAlias(projectAlias);
    const user = getStoredUser(userAlias);

    if (user.channels[channelAlias]?.mailboxEmail) {
      return;
    }
    assert.ok(
      !isBaselineChannelKey(channelAlias),
      `"${channelAlias}" is a baseline channel and cannot become a Desk channel.`
    );
    await createDeskChannel(user, projectAlias, channelAlias);
  }

  @Step('generating Desk email ticket <ticketAlias> in channel <channelAlias> for user <userAlias>')
  public async generateDeskEmailTicket(
    ticketAlias: string,
    channelAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidTicketAlias(ticketAlias);
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    generateDeskInboundTicket(getStoredUser(userAlias), ticketAlias, channelAlias);
  }

  @Step(
    'generating Desk email ticket <ticketAlias> with cc in channel <channelAlias> for user <userAlias>'
  )
  public async generateDeskEmailTicketWithCc(
    ticketAlias: string,
    channelAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidTicketAlias(ticketAlias);
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    generateDeskInboundTicket(getStoredUser(userAlias), ticketAlias, channelAlias, {
      withCc: true,
    });
  }

  @Step(
    'generating <count> Desk email tickets as batch <ticketAlias> in channel <channelAlias> for user <userAlias>'
  )
  public async generateDeskEmailBatch(
    count: string,
    ticketAlias: string,
    channelAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidTicketAlias(ticketAlias);
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    const total = parseCount(count, 'batch size');
    assert.ok(total > 0 && total <= 100, 'Desk batch size must be 1-100.');
    const user = getStoredUser(userAlias);
    for (let index = 0; index < total; index += 1) {
      generateDeskInboundTicket(user, batchTicketAlias(ticketAlias, index), channelAlias);
    }
  }

  // ===========================================
  // ACTION
  // ===========================================

  @Step('delivering Desk email ticket <ticketAlias> for user <userAlias>')
  public async deliverDeskEmailTicket(ticketAlias: string, userAlias: string): Promise<void> {
    assertValidTicketAlias(ticketAlias);
    assertValidUserAlias(userAlias);
    const user = getStoredUser(userAlias);
    const ticket = getDeskTicket(user, ticketAlias);
    const channel = getDeskChannel(user, ticket.email.channelAlias);

    const response = await deliverDeskEmails(channel, [ticket]);
    testContext.lastResponse = response;
    assert.equal(response.status(), 200, `Desk delivery failed: ${await response.text()}`);
  }

  @Step('delivering Desk email batch <ticketAlias> for user <userAlias>')
  public async deliverDeskEmailBatch(ticketAlias: string, userAlias: string): Promise<void> {
    assertValidTicketAlias(ticketAlias);
    assertValidUserAlias(userAlias);
    const user = getStoredUser(userAlias);
    const tickets = getBatchTickets(user, ticketAlias);
    const channel = getDeskChannel(user, getDeskTicket(user, tickets[0].alias).email.channelAlias);

    testContext.lastResponse = await deliverDeskEmails(channel, tickets);
  }

  @Step(
    'delivering Desk email batch <ticketAlias> for user <userAlias> failing at message <failIndex>'
  )
  public async deliverDeskEmailBatchWithFailure(
    ticketAlias: string,
    userAlias: string,
    failIndex: string
  ): Promise<void> {
    assertValidTicketAlias(ticketAlias);
    assertValidUserAlias(userAlias);
    const user = getStoredUser(userAlias);
    const tickets = getBatchTickets(user, ticketAlias);
    const index = parseCount(failIndex, 'fail index');
    assert.ok(index > 0 && index < tickets.length, 'Fail index must be inside the batch.');
    const failAt = getDeskTicket(user, tickets[index].alias).email.messageId;
    const channel = getDeskChannel(user, getDeskTicket(user, tickets[0].alias).email.channelAlias);

    testContext.lastResponse = await deliverDeskEmails(channel, tickets, failAt);
  }

  // Reply / Reply all from the latest email's footer pill (Gmail semantics:
  // anchors on the latest email). Selecting a mode opens the composer.
  @Step('replying with <mode> to open Desk ticket <ticketAlias> for user <userAlias>')
  public async replyToOpenDeskTicket(
    mode: string,
    ticketAlias: string,
    userAlias: string
  ): Promise<void> {
    assert.ok(mode === 'Reply' || mode === 'Reply all', 'Mode must be "Reply" or "Reply all".');
    assertValidTicketAlias(ticketAlias);
    assertValidUserAlias(userAlias);
    const ticket = getDeskTicket(getStoredUser(userAlias), ticketAlias);
    const page = testContext.activePage;

    await page.locator('[data-track-name="ReplyPillModeDropdown"]').first().click();
    await page.getByRole('menuitem', { name: mode, exact: true }).click();
    await sendFromComposer(`${mode} to ${ticket.title}`);
  }

  @Step(
    'composing Desk email ticket <ticketAlias> from channel <channelAlias> for user <userAlias>'
  )
  public async composeDeskEmail(
    ticketAlias: string,
    channelAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidTicketAlias(ticketAlias);
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    const user = getStoredUser(userAlias);
    const channel = getDeskChannel(user, channelAlias);
    assert.ok(channel.mailboxEmail);
    const suffix = buildRandomSuffix();
    // `email.from` is the customer side of the thread: here, the recipient.
    // Gmail assigns thread and message ids on send, so the outbox is matched by recipient.
    const ticket: StoredTicket & { email: StoredDeskEmail } = {
      alias: ticketAlias,
      title: `Desk compose ${suffix}`,
      description: `Composed Desk mail ${suffix}.`,
      email: {
        channelAlias,
        from: `recipient.${suffix}@customer.xyne.test`,
        cc: [],
        threadId: '',
        messageId: '',
      },
    };
    user.tickets[ticketAlias] = ticket;

    await openDeskChannel(user, channelAlias);
    const page = testContext.activePage;
    await page.locator('[data-track-name="OpenComposeEmail"]').first().click();
    const composer = emailComposer();
    await composer.waitFor({ state: 'visible', timeout: DESK_UI_TIMEOUT_MS });
    const toInput = composer.locator('[data-track-name="EditToField"]').first();
    await toInput.fill(ticket.email.from);
    await toInput.press('Enter');
    await composer.locator('input[aria-label="Subject"]').fill(ticket.title);
    await sendFromComposer(ticket.description ?? '');
  }

  // ===========================================
  // ASSERTION
  // ===========================================

  @Step('verifying fake Gmail sent <mode> for Desk ticket <ticketAlias> for user <userAlias>')
  public async verifyFakeGmailReply(
    mode: string,
    ticketAlias: string,
    userAlias: string
  ): Promise<void> {
    assert.ok(mode === 'Reply' || mode === 'Reply all', 'Mode must be "Reply" or "Reply all".');
    assertValidTicketAlias(ticketAlias);
    assertValidUserAlias(userAlias);
    const user = getStoredUser(userAlias);
    const ticket = getDeskTicket(user, ticketAlias);
    const channel = getDeskChannel(user, ticket.email.channelAlias);
    const body = `${mode} to ${ticket.title}`;

    const sent = await waitForOutbox(
      { threadId: ticket.email.threadId },
      (mail) => mail.kind === 'reply' && mail.body.includes(body),
      `a ${mode} on thread ${ticket.email.threadId}`
    );
    assert.equal(sent.from, channel.mailboxEmail);
    assert.deepEqual(sent.to, [ticket.email.from]);
    assert.deepEqual(sent.cc, mode === 'Reply all' ? ticket.email.cc : []);
    assert.equal(sent.subject, `Re: ${ticket.title}`);
  }

  @Step('verifying fake Gmail sent composed Desk email <ticketAlias> for user <userAlias>')
  public async verifyFakeGmailCompose(ticketAlias: string, userAlias: string): Promise<void> {
    assertValidTicketAlias(ticketAlias);
    assertValidUserAlias(userAlias);
    const user = getStoredUser(userAlias);
    const ticket = getDeskTicket(user, ticketAlias);
    const channel = getDeskChannel(user, ticket.email.channelAlias);

    const sent = await waitForOutbox(
      { to: ticket.email.from },
      (mail) => mail.kind === 'new' && mail.subject === ticket.title,
      `a new email "${ticket.title}"`
    );
    assert.equal(sent.from, channel.mailboxEmail);
    assert.ok(sent.body.includes(ticket.description ?? ''), `Unexpected body: ${sent.body}`);
  }

  @Step('verifying Desk delivery created <created> tickets and found <duplicates> duplicates')
  public async verifyDeskDeliveryCounts(created: string, duplicates: string): Promise<void> {
    const result = await readDeliveryResult();
    assert.equal(result.created, parseCount(created, 'created count'));
    assert.equal(result.duplicates, parseCount(duplicates, 'duplicate count'));
    assert.equal(result.skipped, 0);
  }

  @Step('verifying Desk delivery failed with a retryable error')
  public async verifyDeskDeliveryRetryableFailure(): Promise<void> {
    const response = testContext.lastResponse as APIResponse | null;
    assert.ok(response, 'Expected a Desk delivery response. Deliver Desk email first.');
    assert.equal(response.status(), 503, 'Expected the injected failure to return 503.');
    const body = (await response.json()) as { retryable?: boolean };
    assert.equal(body.retryable, true);
  }

  @Step('verifying every ticket of Desk batch <ticketAlias> is listed for user <userAlias>')
  public async verifyDeskBatchListed(ticketAlias: string, userAlias: string): Promise<void> {
    assertValidTicketAlias(ticketAlias);
    assertValidUserAlias(userAlias);
    const user = getStoredUser(userAlias);
    const tickets = getBatchTickets(user, ticketAlias);

    await openDeskChannel(user, getDeskTicket(user, tickets[0].alias).email.channelAlias);
    for (const ticket of tickets) {
      const rows = testContext.activePage.locator(SUPPORT_PAGE).getByText(ticket.title, {
        exact: true,
      });
      await rows.first().waitFor({ state: 'visible', timeout: DESK_UI_TIMEOUT_MS });
      assert.equal(await rows.count(), 1, `Expected exactly one ticket "${ticket.title}".`);
    }
  }
}
