import assert from 'node:assert/strict';
import { type APIRequestContext, type APIResponse, request } from '@playwright/test';
import { config } from '@/config';
import { buildRandomSuffix, getStoredUser } from '@/fixtures/fixture-helpers';
import { getUserCatalogEntry } from '@/fixtures/user-catalog';
import {
  apiContextsByUserAlias,
  type ConnectedDeskSourceStatus,
  DEFAULT_DESK_API_USER_ALIAS,
  DESK_UI_TIMEOUT_MS,
  type DeskChannelTicket,
  type DeskTicketDetails,
  deskChannelDlEmails,
  type MockDeskMailFixture,
  type MockDlMail,
  mockDeskMails,
  mockDlEmails,
  type SentMail,
  slackChannelIds,
} from '@/tests/03_e2e/11_xyne-desk/xyne-desk-state';
import { testContext } from '@/tests/shared/runtime/test-context';
import {
  assertValidChannelAlias,
  assertValidUserAlias,
} from '@/tests/shared/support/literal-validation';

type DeskChannelKind = 'DL' | 'personal' | 'Slack';

// ---------------------------------------------------------------------------
// API context + response helpers
// ---------------------------------------------------------------------------

async function createDevAuthenticatedApiContext(userAlias: string): Promise<APIRequestContext> {
  const existingContext = apiContextsByUserAlias.get(userAlias);
  if (existingContext) return existingContext;

  const user = getStoredUser(userAlias);
  assert.ok(user.workspaceId, `Expected user "${userAlias}" to have a workspaceId.`);

  // Desk backend setup/assertion calls are API-only, but they must use the same
  // test-auth cookie path as the browser. In Docker/Jenkins the backend sees
  // API calls from another container, so x-dev-mode headers can be rejected by
  // the auth middleware's safe-network guard before the Desk test route runs.
  const apiContext = await request.newContext({
    baseURL: config.backend.baseUrl,
    extraHTTPHeaders: {
      Accept: 'application/json',
      'x-workspace-id': user.workspaceId,
    },
  });

  const catalogUser = getUserCatalogEntry(userAlias);
  const params = new URLSearchParams({
    email: catalogUser.email,
    setAsNewUser: 'false',
  });
  const loginResponse = await apiContext.post(`/api/test/auth/login?${params.toString()}`, {
    data: {},
    timeout: DESK_UI_TIMEOUT_MS,
  });

  if (!loginResponse.ok()) {
    const responseBody = await loginResponse.text().catch(() => '');
    await apiContext.dispose();
    throw new Error(
      `Desk API auth for "${userAlias}" failed with status ${loginResponse.status()}. Body: ${responseBody}`
    );
  }

  apiContextsByUserAlias.set(userAlias, apiContext);
  return apiContext;
}

export async function withDevAuthenticatedApiContext<T>(
  userAlias: string,
  callback: (apiContext: APIRequestContext) => Promise<T>
): Promise<T> {
  assertValidUserAlias(userAlias);
  const apiContext = await createDevAuthenticatedApiContext(userAlias);
  return callback(apiContext);
}

/** Throws with the response body when the status is not one of `expected` (default 200). */
export async function assertStatus(
  response: Pick<APIResponse, 'status' | 'text'>,
  label: string,
  expected: number[] = [200]
): Promise<void> {
  if (!expected.includes(response.status())) {
    const responseBody = await response.text();
    throw new Error(`${label} failed with status ${response.status()}. Body: ${responseBody}`);
  }
}

export function extractConversationId(body: Record<string, unknown>, message: string): string {
  const conversation = body.conversation as { conversationId?: string } | undefined;
  const conversationId =
    typeof body.conversationId === 'string' ? body.conversationId : conversation?.conversationId;
  assert.ok(conversationId, message);
  return conversationId;
}

// ---------------------------------------------------------------------------
// Fixture + stored-state lookups
// ---------------------------------------------------------------------------

export function assertFixture(alias: string): MockDeskMailFixture {
  const fixture = mockDeskMails.get(alias);
  assert.ok(fixture, `Expected mock desk mail fixture "${alias}" to exist.`);
  return fixture;
}

export function assertConversationId(mail: MockDeskMailFixture): string {
  assert.ok(mail.conversationId, `Expected mock mail "${mail.alias}" to have a conversationId.`);
  return mail.conversationId;
}

export function getStoredChannelId(channelAlias: string, userAlias: string): string {
  assertValidChannelAlias(channelAlias);
  assertValidUserAlias(userAlias);

  const user = getStoredUser(userAlias);
  const channel = user.channels[channelAlias];
  assert.ok(channel?.id, `Expected stored channel "${channelAlias}" to have an id.`);
  return channel.id;
}

export function getMockDlEmail(dlAlias: string): string {
  const email = mockDlEmails.get(dlAlias);
  assert.ok(email, `Expected mock DL "${dlAlias}" to have been created.`);
  return email;
}

function getSharedMailboxDomain(): string {
  return (
    config.desk.mockSharedMailbox.split('@')[1] ||
    config.desk.mockDlEmail.split('@')[1] ||
    'example.test'
  );
}

/** Lower-cased `<localPart>@<mock shared mailbox domain>`. */
export function buildDeskMailboxEmail(localPart: string): string {
  return `${localPart}@${getSharedMailboxDomain()}`.toLowerCase();
}

function sanitizeNamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Builds an 80-char-safe channel name with the run id and a random suffix, so
 * parallel and repeated runs never collide on channel names.
 */
function buildUniqueDeskChannelName(channelAlias: string): string {
  const runId = sanitizeNamePart(process.env.XYNE_RUN_ID ?? 'local');
  if (!runId) {
    throw new Error('XYNE_RUN_ID must contain at least one alphanumeric character when set');
  }
  const normalizedAlias = sanitizeNamePart(channelAlias) || 'channel-desk';
  const uniqueSuffix = `${runId}-${buildRandomSuffix()}`;
  const maxAliasLength = Math.max(1, 80 - uniqueSuffix.length - 1);
  const trimmedAlias = normalizedAlias.slice(0, maxAliasLength).replace(/-+$/g, '');

  return `${trimmedAlias}-${uniqueSuffix}`;
}

// ---------------------------------------------------------------------------
// Workspace mailbox + channels
// ---------------------------------------------------------------------------

export async function postMockSharedMailbox(userAlias: string): Promise<APIResponse> {
  return withDevAuthenticatedApiContext(userAlias, (apiContext) =>
    apiContext.post('/api/test/desk/workspace-mailbox', {
      data: {
        email: config.desk.mockSharedMailbox,
        sourceType: 'google',
      },
    })
  );
}

export async function connectMockDeskChannelSource(
  userAlias: string,
  channelId: string,
  email: string,
  label: string
): Promise<void> {
  const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
    apiContext.post('/api/test/desk/channel-source', {
      data: {
        channelId,
        email,
        sourceType: 'google',
      },
    })
  );
  await assertStatus(response, label);
}

export async function disconnectDeskChannelSource(
  channelAlias: string,
  userAlias: string,
  label: string
): Promise<void> {
  const channelId = getStoredChannelId(channelAlias, userAlias);
  const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
    apiContext.post(`/api/test/desk/channel-source/${channelId}/disconnect`)
  );
  await assertStatus(response, label);
}

function buildDeskChannelTypeFields(
  kind: DeskChannelKind,
  mailboxEmail: string,
  slackChannelId: string
): Record<string, string> {
  if (kind === 'DL') return { type: 'EMAIL', deskType: 'DL', dlEmail: mailboxEmail };
  if (kind === 'personal') return { type: 'EMAIL', deskType: 'EMAIL' };
  return { type: 'SLACK', deskType: 'SLACK', slackChannelId };
}

/**
 * Creates a private Desk channel of `kind` through the API and stores it for the
 * user. No-op when the alias is already stored. Personal channels also get a
 * mock mailbox source; Slack channels get a mock Slack workspace first.
 */
export async function createDeskChannelViaApi(
  kind: DeskChannelKind,
  channelAlias: string,
  userAlias: string,
  projectAlias: string
): Promise<void> {
  const user = getStoredUser(userAlias);
  const project = user.projects[projectAlias];
  assert.ok(project?.id, `Expected stored project "${projectAlias}" to have an id.`);

  if (user.channels[channelAlias]?.id) {
    return;
  }

  if (kind === 'Slack') {
    const workspaceResponse = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
      apiContext.post('/api/test/desk/slack-workspace')
    );
    await assertStatus(workspaceResponse, 'Mock Slack workspace setup');
  }

  const channelName = buildUniqueDeskChannelName(channelAlias);
  const mailboxEmail = buildDeskMailboxEmail(channelName);
  const slackChannelId = `C${buildRandomSuffix().replace(/-/g, '').toUpperCase()}`;

  const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
    apiContext.post('/api/channels', {
      data: {
        scopeType: 'DEFAULT',
        name: channelName,
        description: `Mock ${kind} Desk automation channel ${channelName}`,
        visibility: 'PRIVATE',
        projectId: project.id,
        ...buildDeskChannelTypeFields(kind, mailboxEmail, slackChannelId),
      },
    })
  );
  await assertStatus(response, `Mock ${kind} Desk channel creation`, [200, 201]);

  const body = (await response.json()) as { id?: string; channelId?: string; name?: string };
  const channelId = body.id ?? body.channelId;
  assert.ok(channelId, `Expected mock ${kind} Desk channel creation to return a channel id.`);

  if (kind === 'personal') {
    await connectMockDeskChannelSource(
      userAlias,
      channelId,
      mailboxEmail,
      'Mock personal Desk channel source setup'
    );
  }

  user.channels[channelAlias] = {
    id: channelId,
    name: typeof body.name === 'string' ? body.name : channelName,
    url: `${config.dashboard.baseUrl}/${user.workspaceId}/support/${channelId}`,
    messages: {},
  };
  if (kind === 'Slack') {
    slackChannelIds.set(channelAlias, slackChannelId);
  } else {
    deskChannelDlEmails.set(channelAlias, mailboxEmail);
  }
}

export async function fetchDeskChannelConnectionStatus(
  channelAlias: string,
  userAlias: string
): Promise<ConnectedDeskSourceStatus> {
  const channelId = getStoredChannelId(channelAlias, userAlias);

  const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
    apiContext.get(`/api/channels/${channelId}/connected-email`)
  );
  await assertStatus(response, 'Desk channel connection status');

  return (await response.json()) as ConnectedDeskSourceStatus;
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

async function requestChannelTickets(userAlias: string, channelId: string): Promise<APIResponse> {
  return withDevAuthenticatedApiContext(userAlias, (apiContext) =>
    apiContext.get(`/api/test/desk/channel/${channelId}/tickets`)
  );
}

async function readChannelTickets(response: APIResponse): Promise<DeskChannelTicket[]> {
  const body = (await response.json()) as { tickets?: DeskChannelTicket[] };
  return body.tickets ?? [];
}

export async function fetchChannelTickets(
  userAlias: string,
  channelId: string,
  label: string
): Promise<DeskChannelTicket[]> {
  const response = await requestChannelTickets(userAlias, channelId);
  await assertStatus(response, label);
  return readChannelTickets(response);
}

// Composed mail is captured before its conversation exists, so the capture
// carries no conversationId; resolve it from the ticket the compose created.
export async function waitForComposedConversationId(
  userAlias: string,
  channelId: string,
  subject: string
): Promise<string> {
  const deadline = Date.now() + DESK_UI_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await requestChannelTickets(userAlias, channelId);
    if (response.ok()) {
      const ticket = (await readChannelTickets(response)).find(
        (candidate) => candidate.title === subject
      );
      if (ticket?.conversationId) return ticket.conversationId;
    }
    await testContext.activePage.waitForTimeout(500);
  }
  throw new Error(
    `Composed Desk mail "${subject}" did not create a ticket in channel ${channelId}.`
  );
}

export async function fetchAndStoreDeskTicketDetails(
  mailAlias: string
): Promise<DeskTicketDetails> {
  const mail = assertFixture(mailAlias);
  const conversationId = assertConversationId(mail);

  const response = await withDevAuthenticatedApiContext(DEFAULT_DESK_API_USER_ALIAS, (apiContext) =>
    apiContext.get(`/api/test/desk/ticket/${conversationId}`)
  );
  await assertStatus(response, 'Mock Desk ticket details request');

  const details = (await response.json()) as DeskTicketDetails;
  if (details.ticket?.id) {
    mail.ticketId = details.ticket.id;
  }
  if (details.ticket?.xyneId) {
    mail.xyneId = details.ticket.xyneId;
  }
  return details;
}

// ---------------------------------------------------------------------------
// Sent mails + mock inboxes
// ---------------------------------------------------------------------------

export async function fetchSentMails(
  query: { conversationId: string } | { channelId: string }
): Promise<SentMail[]> {
  const [key, value] = Object.entries(query)[0] as [string, string];
  const response = await withDevAuthenticatedApiContext(DEFAULT_DESK_API_USER_ALIAS, (apiContext) =>
    apiContext.get(`/api/test/desk/sent-mails?${key}=${encodeURIComponent(value)}`)
  );
  await assertStatus(response, 'Mock Desk sent mails request');

  const body = (await response.json()) as { sentMails?: SentMail[] };
  return body.sentMails ?? [];
}

export async function getLatestSentMail(
  query: { conversationId: string } | { channelId: string },
  missingMessage: string
): Promise<SentMail> {
  const sentMails = await fetchSentMails(query);
  const latest = sentMails[sentMails.length - 1];
  assert.ok(latest, missingMessage);
  return latest;
}

export async function fetchMockInbox(memberEmail: string): Promise<MockDlMail[]> {
  const response = await withDevAuthenticatedApiContext(DEFAULT_DESK_API_USER_ALIAS, (apiContext) =>
    apiContext.get(`/api/test/desk/mock-inbox/${encodeURIComponent(memberEmail)}`)
  );
  await assertStatus(response, `Mock inbox "${memberEmail}" request`);

  const body = (await response.json()) as { inbox?: MockDlMail[] };
  return body.inbox ?? [];
}
