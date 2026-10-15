/**
 * Desk fixtures: seeding helpers for Xyne Desk (support email) scenarios.
 *
 * Desk needs two things automation cannot drive for real: a Google OAuth
 * mailbox connection and Gmail delivering mail. The backend exposes test-only
 * stand-ins for those under /api/test/fixtures/desk/* (DESK_MOCK_ENABLED);
 * everything downstream (ingestion, tickets, replies, merge) is product code.
 *
 * Expected values (subject, body, sender) are generated here and stored on the
 * user's `tickets` map, so specs assert with `user:<alias>.tickets.<ticketAlias>.*`.
 * Assertions go through the UI or real APIs, never through fixture routes; the
 * fake Gmail outbox is the one exception, because it *is* the provider boundary.
 */

import assert from 'node:assert/strict';
import type { APIResponse } from '@playwright/test';
import { config } from '@/config';
import { buildRandomSuffix } from '@/fixtures/fixture-helpers';
import {
  type StoredConversation,
  type StoredTicket,
  type StoredUser,
  testContext,
} from '@/tests/shared/runtime/test-context';

export const DESK_MAILBOX_DOMAIN = 'desk-fixture.xyne.test';
const CUSTOMER_DOMAIN = 'customer.xyne.test';
const DELIVERY_BASE_TIMEOUT_MS = 60_000;
const DELIVERY_PER_MESSAGE_TIMEOUT_MS = 15_000;

export interface FakeGmailSentMail {
  kind: 'reply' | 'new';
  threadId: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
}

export interface GmailDeliveryResult {
  delivered: number;
  created: number;
  duplicates: number;
  skipped: number;
  conversationIds: string[];
}

// =============================================================================
// HTTP
// =============================================================================

async function assertOk(response: APIResponse, label: string): Promise<void> {
  if (!response.ok()) {
    const body = await response.text().catch(() => '<unreadable body>');
    throw new Error(`${label} failed (${response.status()}): ${body}`);
  }
}

/**
 * Calls the backend as the user logged in on the active browser (dashboard /api
 * proxy, same cookies as the UI). Callers log `user` in first, as the Desk
 * concepts do; the guard fails fast if a different user is logged in.
 */
async function postAsLoggedInUser(
  user: StoredUser,
  apiPath: string,
  data: unknown
): Promise<APIResponse> {
  assert.ok(user.workspaceId, `Expected stored user "${user.alias}" to have a workspaceId.`);
  const page = testContext.activePage;
  const activeUserId = await page.evaluate(() => localStorage.getItem('user_id')).catch(() => null);
  assert.ok(
    !activeUserId || !user.id || activeUserId === user.id,
    `Active browser is logged in as user id ${activeUserId}, not "${user.alias}". Log "${user.alias}" in first.`
  );
  return page.request.post(`${config.dashboard.baseUrl}${apiPath}`, {
    data,
    headers: { 'x-workspace-id': user.workspaceId },
  });
}

/** Fixture routes are test-env gated and unauthenticated, like channel-participants. */
async function callFixture(
  method: 'GET' | 'POST',
  fixturePath: string,
  options: { data?: unknown; timeout?: number } = {}
) {
  return testContext.activePage.request.fetch(
    `${config.backend.baseUrl}/api/test/fixtures/desk/${fixturePath}`,
    { method, ...options }
  );
}

/**
 * False when the backend runs without DESK_MOCK_ENABLED (403) or predates the
 * Desk fixture routes (404), so the shared baseline never fails on Desk.
 */
export async function isDeskFixtureBackendEnabled(): Promise<boolean> {
  const response = await callFixture('GET', `outbox?to=probe@${DESK_MAILBOX_DOMAIN}`);
  if (response.status() === 403 || response.status() === 404) return false;
  await assertOk(response, 'Desk fixture backend probe');
  return true;
}

// =============================================================================
// CHANNELS
// =============================================================================

/**
 * Creates a Desk email channel through the real channel API, then connects a
 * fake Gmail mailbox to it (the state the OAuth connect flow leaves behind).
 */
export async function createDeskChannel(
  user: StoredUser,
  projectAlias: string,
  channelAlias: string
): Promise<StoredConversation> {
  const project = user.projects[projectAlias];
  assert.ok(project?.id, `Expected stored project "${projectAlias}" to have an id.`);

  const suffix = buildRandomSuffix();
  const name = `${channelAlias}-${suffix}`.slice(0, 80);
  const mailboxEmail = `${name}@${DESK_MAILBOX_DOMAIN}`;

  const response = await postAsLoggedInUser(user, '/api/channels', {
    scopeType: 'DEFAULT',
    name,
    description: `Desk automation channel ${name}`,
    visibility: 'PRIVATE',
    projectId: project.id,
    type: 'EMAIL',
    deskType: 'EMAIL',
  });
  await assertOk(response, `Desk channel "${channelAlias}" creation`);
  const body = (await response.json()) as { id?: string; channelId?: string };
  const channelId = body.id ?? body.channelId;
  assert.ok(channelId, `Expected Desk channel "${channelAlias}" creation to return an id.`);

  await assertOk(
    await callFixture('POST', 'channel-mailbox', {
      data: { channelId, mailboxEmail, ownerEmail: user.email },
    }),
    `Desk channel "${channelAlias}" mailbox connection`
  );

  const channel: StoredConversation = {
    id: channelId,
    name,
    url: `${config.dashboard.baseUrl}/${user.workspaceId}/support/${channelId}`,
    messages: {},
    mailboxEmail,
  };
  user.channels[channelAlias] = channel;
  return channel;
}

// =============================================================================
// INBOUND MAIL
// =============================================================================

/** Generates a unique inbound customer email and stores it as a Desk ticket. */
export function generateDeskInboundTicket(
  user: StoredUser,
  ticketAlias: string,
  channelAlias: string,
  options: { withCc?: boolean } = {}
): StoredTicket {
  const suffix = buildRandomSuffix();
  const ticket: StoredTicket = {
    alias: ticketAlias,
    title: `Desk ${ticketAlias} ${suffix}`,
    description: `Customer report for ${ticketAlias} ${suffix}.`,
    email: {
      channelAlias,
      from: `customer.${suffix}@${CUSTOMER_DOMAIN}`,
      cc: options.withCc ? [`manager.${suffix}@${CUSTOMER_DOMAIN}`] : [],
      threadId: `fixture-thread-${suffix}`,
      messageId: `fixture-message-${suffix}`,
    },
  };
  user.tickets[ticketAlias] = ticket;
  return ticket;
}

function toGmailMessage(ticket: StoredTicket, mailboxEmail: string) {
  assert.ok(ticket.email, `Expected ticket "${ticket.alias}" to be a Desk email ticket.`);
  return {
    messageId: ticket.email.messageId,
    threadId: ticket.email.threadId,
    from: ticket.email.from,
    to: [mailboxEmail],
    cc: ticket.email.cc,
    subject: ticket.title,
    body: ticket.description ?? '',
  };
}

/**
 * Delivers the tickets' emails to the channel mailbox through the real Gmail
 * ingestion pipeline. On success the resulting conversation ids are stored on
 * the tickets; the raw response is returned for status/count assertions.
 */
export async function deliverDeskEmails(
  channel: StoredConversation,
  tickets: StoredTicket[],
  failAtMessageId?: string
): Promise<APIResponse> {
  assert.ok(channel.id && channel.mailboxEmail, `Expected "${channel.name}" to be a Desk channel.`);
  const mailboxEmail = channel.mailboxEmail;

  const response = await callFixture('POST', 'gmail-delivery', {
    data: {
      channelId: channel.id,
      historyId: String(Date.now()),
      messages: tickets.map((ticket) => toGmailMessage(ticket, mailboxEmail)),
      ...(failAtMessageId && { failAtMessageId }),
    },
    // Each message runs the full ingestion pipeline; without Vespa/LLM in the
    // Docker stack every one spends seconds in timeouts, so scale the budget.
    timeout: DELIVERY_BASE_TIMEOUT_MS + tickets.length * DELIVERY_PER_MESSAGE_TIMEOUT_MS,
  });

  if (response.ok()) {
    const result = (await response.json()) as GmailDeliveryResult;
    tickets.forEach((ticket, index) => {
      const conversationId = result.conversationIds[index];
      if (ticket.email && conversationId) ticket.email.conversationId = conversationId;
    });
  }
  return response;
}

// =============================================================================
// OUTBOUND MAIL (fake Gmail outbox)
// =============================================================================

export async function listFakeGmailOutbox(
  query: { threadId: string } | { to: string }
): Promise<FakeGmailSentMail[]> {
  const params = new URLSearchParams(query);
  const response = await callFixture('GET', `outbox?${params.toString()}`);
  await assertOk(response, 'Fake Gmail outbox read');
  return ((await response.json()) as { sent: FakeGmailSentMail[] }).sent;
}
