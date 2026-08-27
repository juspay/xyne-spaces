import assert from 'node:assert/strict';
import { type APIRequestContext, type Locator, request } from '@playwright/test';
import { Step } from 'gauge-ts';
import { config } from '@/config';
import { buildRandomSuffix, getStoredUser } from '@/fixtures/fixture-helpers';
import { getUserCatalogEntry } from '@/fixtures/user-catalog';
import { buildUniqueDeskChannelName } from '@/tests/03_e2e/11_xyne-desk/xyne-desk-name-utils';
import {
  apiContextsByUserAlias,
  deskChannelDlEmails,
  type MockDeskMailFixture,
  mockDeskMails,
  mockDlEmails,
  slackChannelIds,
} from '@/tests/03_e2e/11_xyne-desk/xyne-desk-state';
import { type StoredConversation, testContext } from '@/tests/shared/runtime/test-context';
import { mirrorBackendAuthCookiesToDashboard } from '@/tests/shared/support/auth-cookies';
import {
  assertValidChannelAlias,
  assertValidProjectAlias,
  assertValidUserAlias,
} from '@/tests/shared/support/literal-validation';

interface SentMail {
  channelId?: unknown;
  conversationId?: unknown;
  from?: unknown;
  to?: unknown;
  cc?: unknown;
  bcc?: unknown;
  subject?: unknown;
  body?: unknown;
  kind?: unknown;
  status?: unknown;
  attachmentCount?: unknown;
}

interface DeskTicketDetails {
  ticket?: {
    id?: string;
    xyneId?: string;
    title?: string;
    description?: string;
    priority?: string;
    statusV2?: string;
    channelId?: string;
    isArchived?: boolean;
    mergedIntoTicketId?: string | null;
  };
  emails?: Array<{
    id?: string;
    subject?: string;
    body?: string;
    from?: string;
    to?: string[];
    cc?: string[];
    bcc?: string[];
    replyTo?: string[];
  }>;
  attachments?: Array<{
    entityId?: string;
    originalFilename?: string;
    mimetype?: string;
    size?: number;
  }>;
}

interface MockDlMail {
  dlEmail?: unknown;
  subject?: unknown;
}

interface ConnectedDeskSourceStatus {
  email?: string | null;
  isConnected?: boolean;
  hasSource?: boolean;
  sourceType?: string | null;
  connectedLabel?: string | null;
}

const DEFAULT_DESK_API_USER_ALIAS = 'admin-1';
const DESK_UI_TIMEOUT_MS = config.timeout * 2;

function assertFixture(alias: string): MockDeskMailFixture {
  const fixture = mockDeskMails.get(alias);
  assert.ok(fixture, `Expected mock desk mail fixture "${alias}" to exist.`);
  return fixture;
}

function getSharedMailboxDomain(): string {
  return (
    config.desk.mockSharedMailbox.split('@')[1] ||
    config.desk.mockDlEmail.split('@')[1] ||
    'example.test'
  );
}

async function assertOkResponse(
  response: { status(): number; text(): Promise<string> },
  label: string
): Promise<void> {
  if (response.status() !== 200) {
    const responseBody = await response.text();
    throw new Error(`${label} failed with status ${response.status()}. Body: ${responseBody}`);
  }
}

async function hasDashboardAuthCookieForWorkspace(workspaceId: string): Promise<boolean> {
  const cookies = await testContext.currentSession.context.cookies(config.dashboard.baseUrl);
  return cookies.some((cookie) => cookie.name === `xyne_ws_${workspaceId}_token` && cookie.value);
}

async function clearDeskBrowserAuthState(): Promise<void> {
  const page = testContext.activePage;
  const context = testContext.currentSession.context;

  await page
    .goto(`${config.dashboard.baseUrl}/auth`, {
      waitUntil: 'domcontentloaded',
      timeout: DESK_UI_TIMEOUT_MS,
    })
    .catch(() => undefined);
  await context.clearCookies();
  try {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  } catch {
    // The next test-auth call writes fresh auth cookies; storage cleanup is best-effort.
  }
}

async function assertDashboardAuthCookieForWorkspace(
  workspaceId: string,
  userAlias: string
): Promise<void> {
  if (await hasDashboardAuthCookieForWorkspace(workspaceId)) return;

  const cookieNames = (
    await testContext.currentSession.context.cookies(config.dashboard.baseUrl)
  ).map((cookie) => cookie.name);
  throw new Error(
    `Desk browser auth for "${userAlias}" did not create xyne_ws_${workspaceId}_token on dashboard origin. Cookies: ${cookieNames.join(', ')}`
  );
}

async function ensureBrowserAuthenticatedForDesk(
  userAlias: string,
  options: { force?: boolean } = {}
): Promise<void> {
  assertValidUserAlias(userAlias);
  const storedUser = getStoredUser(userAlias);
  assert.ok(storedUser.workspaceId, `Expected user "${userAlias}" to have a workspaceId.`);

  if (!options.force && (await hasDashboardAuthCookieForWorkspace(storedUser.workspaceId))) {
    return;
  }

  if (options.force) {
    await clearDeskBrowserAuthState();
  }

  const catalogUser = getUserCatalogEntry(userAlias);
  const params = new URLSearchParams({
    email: catalogUser.email,
    setAsNewUser: 'false',
  });

  const response = await testContext.currentSession.context.request.post(
    `${config.backend.baseUrl}/api/test/auth/login?${params.toString()}`,
    {
      data: {},
      timeout: DESK_UI_TIMEOUT_MS,
    }
  );

  if (!response.ok()) {
    const responseBody = await response.text().catch(() => '');
    throw new Error(
      `Desk browser auth for "${userAlias}" failed with status ${response.status()}. Body: ${responseBody}`
    );
  }

  await mirrorBackendAuthCookiesToDashboard(testContext.currentSession.context, response);
  await assertDashboardAuthCookieForWorkspace(storedUser.workspaceId, userAlias);
}

async function waitForDeskPageToSettle(): Promise<void> {
  const page = testContext.activePage;
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}

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
      'x-desk-test-user-alias': userAlias,
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

async function withDevAuthenticatedApiContext<T>(
  userAlias: string,
  callback: (apiContext: APIRequestContext) => Promise<T>
): Promise<T> {
  assertValidUserAlias(userAlias);
  const apiContext = await createDevAuthenticatedApiContext(userAlias);
  return callback(apiContext);
}

async function assertOkOrCreatedResponse(
  response: { status(): number; text(): Promise<string> },
  label: string
): Promise<void> {
  if (![200, 201].includes(response.status())) {
    const responseBody = await response.text();
    throw new Error(`${label} failed with status ${response.status()}. Body: ${responseBody}`);
  }
}

export default class XyneDeskSteps {
  @Step('opening Xyne Desk for user <userAlias>')
  public async openXyneDesk(userAlias: string): Promise<void> {
    assertValidUserAlias(userAlias);
    const user = getStoredUser(userAlias);
    const workspacePrefix = user.workspaceId ? `/${user.workspaceId}` : '';
    const page = testContext.activePage;
    const supportPage = page.locator("[data-testid='support-page']");

    await ensureBrowserAuthenticatedForDesk(userAlias);

    const openWorkspaceHome = async (): Promise<void> => {
      await page.goto(`${config.dashboard.baseUrl}${workspacePrefix}/chat/dir`, {
        waitUntil: 'domcontentloaded',
        timeout: DESK_UI_TIMEOUT_MS,
      });
      await waitForDeskPageToSettle();
    };

    if (!page.url().startsWith(config.dashboard.baseUrl) || page.url().includes('/auth')) {
      await openWorkspaceHome();
    }

    if (page.url().includes('/auth')) {
      await ensureBrowserAuthenticatedForDesk(userAlias, { force: true });
      await openWorkspaceHome();
    }

    await this.navigateToSupportModule(workspacePrefix);
    await waitForDeskPageToSettle();

    if (page.url().includes('/auth')) {
      await ensureBrowserAuthenticatedForDesk(userAlias, { force: true });
      await openWorkspaceHome();
      await this.navigateToSupportModule(workspacePrefix);
      await waitForDeskPageToSettle();
    }

    await supportPage.waitFor({ state: 'visible', timeout: DESK_UI_TIMEOUT_MS });
  }

  @Step('configuring mock Desk shared mailbox for user <userAlias>')
  public async configureMockSharedMailbox(userAlias: string): Promise<void> {
    assertValidUserAlias(userAlias);
    getStoredUser(userAlias);

    const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
      apiContext.post('/api/test/desk/workspace-mailbox', {
        data: {
          email: config.desk.mockSharedMailbox,
          sourceType: 'google',
        },
      })
    );

    await assertOkResponse(response, 'Mock Desk shared mailbox setup');
  }

  @Step('verifying user <userAlias> cannot configure mock Desk shared mailbox')
  public async verifyUserCannotConfigureMockSharedMailbox(userAlias: string): Promise<void> {
    assertValidUserAlias(userAlias);
    getStoredUser(userAlias);

    const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
      apiContext.post('/api/test/desk/workspace-mailbox', {
        data: {
          email: config.desk.mockSharedMailbox,
          sourceType: 'google',
        },
      })
    );
    const responseBody = await response.text();

    assert.equal(
      response.status(),
      403,
      `Expected user "${userAlias}" to be blocked from mock Desk shared mailbox setup. Body: ${responseBody}`
    );
  }

  @Step('clearing mock Desk sent mails for channel <channelAlias> user <userAlias>')
  public async clearMockDeskSentMails(channelAlias: string, userAlias: string): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);

    const user = getStoredUser(userAlias);
    const channel = user.channels[channelAlias];
    assert.ok(channel?.id, `Expected stored channel "${channelAlias}" to have an id.`);
    const channelId = channel.id;

    const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
      apiContext.delete(`/api/test/desk/sent-mails?channelId=${encodeURIComponent(channelId)}`)
    );

    await assertOkResponse(response, 'Mock Desk sent-mail reset');
  }

  @Step('verifying Desk channel <channelAlias> is connected for user <userAlias>')
  public async verifyDeskChannelConnected(channelAlias: string, userAlias: string): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    const status = await this.fetchDeskChannelConnectionStatus(channelAlias, userAlias);

    assert.equal(
      status.hasSource,
      true,
      `Expected Desk channel "${channelAlias}" to have a source.`
    );
    assert.equal(
      status.isConnected,
      true,
      `Expected Desk channel "${channelAlias}" to be connected.`
    );
  }

  @Step('disconnecting Desk mailbox for channel <channelAlias> user <userAlias>')
  public async disconnectDeskMailbox(channelAlias: string, userAlias: string): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    const channelId = this.getStoredChannelId(channelAlias, userAlias);

    const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
      apiContext.post(`/api/test/desk/channel-source/${channelId}/disconnect`)
    );

    await assertOkResponse(response, 'Desk mailbox disconnect');
  }

  @Step('reconnecting mock Desk mailbox for channel <channelAlias> user <userAlias>')
  public async reconnectMockDeskMailbox(channelAlias: string, userAlias: string): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    const channelId = this.getStoredChannelId(channelAlias, userAlias);
    const user = getStoredUser(userAlias);
    const channel = user.channels[channelAlias];
    const email =
      deskChannelDlEmails.get(channelAlias) ||
      `${channel.name ?? channelAlias}@${getSharedMailboxDomain()}`.toLowerCase();

    const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
      apiContext.post('/api/test/desk/channel-source', {
        data: {
          channelId,
          email,
          sourceType: 'google',
        },
      })
    );

    await assertOkResponse(response, 'Mock Desk mailbox reconnect');
    deskChannelDlEmails.set(channelAlias, email);
  }

  @Step('disconnecting Slack Desk channel <channelAlias> for user <userAlias>')
  public async disconnectSlackDeskChannel(channelAlias: string, userAlias: string): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    const channelId = this.getStoredChannelId(channelAlias, userAlias);

    const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
      apiContext.post(`/api/test/desk/channel-source/${channelId}/disconnect`)
    );

    await assertOkResponse(response, 'Slack Desk disconnect');
  }

  @Step('verifying Desk channel <channelAlias> is disconnected for user <userAlias>')
  public async verifyDeskChannelDisconnected(
    channelAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    const status = await this.fetchDeskChannelConnectionStatus(channelAlias, userAlias);

    assert.equal(status.hasSource, true, `Expected Desk channel "${channelAlias}" to keep source.`);
    assert.equal(
      status.isConnected,
      false,
      `Expected Desk channel "${channelAlias}" to be disconnected.`
    );
  }

  @Step('typing generated Desk DL email for channel <channelAlias> user <userAlias> in <selector>')
  public async typeGeneratedDlEmail(
    channelAlias: string,
    userAlias: string,
    selector: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);

    const user = getStoredUser(userAlias);
    const channel = user.channels[channelAlias];
    assert.ok(channel?.name, `Expected stored channel "${channelAlias}" to have a name.`);

    const email = `${channel.name}@${getSharedMailboxDomain()}`.toLowerCase();
    deskChannelDlEmails.set(channelAlias, email);

    const element = testContext.activePage.locator(selector).first();
    await element.waitFor({ state: 'visible' });
    await element.fill(email);
  }

  @Step(
    'creating mock DL Desk channel <channelAlias> for user <userAlias> in project <projectAlias>'
  )
  public async createMockDlDeskChannel(
    channelAlias: string,
    userAlias: string,
    projectAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    assertValidProjectAlias(projectAlias);

    const user = getStoredUser(userAlias);
    const project = user.projects[projectAlias];
    assert.ok(project?.id, `Expected stored project "${projectAlias}" to have an id.`);

    if (user.channels[channelAlias]?.id) {
      return;
    }

    const channelName = buildUniqueDeskChannelName(channelAlias);
    const dlEmail = `${channelName}@${getSharedMailboxDomain()}`.toLowerCase();

    const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
      apiContext.post('/api/channels', {
        data: {
          scopeType: 'DEFAULT',
          name: channelName,
          description: `Mock DL Desk automation channel ${channelName}`,
          visibility: 'PRIVATE',
          projectId: project.id,
          type: 'EMAIL',
          deskType: 'DL',
          dlEmail,
        },
      })
    );

    await assertOkOrCreatedResponse(response, 'Mock DL Desk channel creation');

    const body = (await response.json()) as { id?: string; channelId?: string; name?: string };
    const channelId = body.id ?? body.channelId;
    assert.ok(channelId, 'Expected mock DL Desk channel creation to return a channel id.');

    const storedChannel: StoredConversation = {
      id: channelId,
      name: typeof body.name === 'string' ? body.name : channelName,
      url: `${config.dashboard.baseUrl}/${user.workspaceId}/support/${channelId}`,
      messages: {},
    };
    user.channels[channelAlias] = storedChannel;
    deskChannelDlEmails.set(channelAlias, dlEmail);
  }

  @Step(
    'Creating personal Desk channel <channelAlias> for user <userAlias> in project <projectAlias>'
  )
  public async createPersonalDeskChannel(
    channelAlias: string,
    userAlias: string,
    projectAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    assertValidProjectAlias(projectAlias);

    const user = getStoredUser(userAlias);
    const project = user.projects[projectAlias];
    assert.ok(project?.id, `Expected stored project "${projectAlias}" to have an id.`);

    if (user.channels[channelAlias]?.id) {
      return;
    }

    const channelName = buildUniqueDeskChannelName(channelAlias);
    const mailboxEmail = `${channelName}@${getSharedMailboxDomain()}`.toLowerCase();

    const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
      apiContext.post('/api/channels', {
        data: {
          scopeType: 'DEFAULT',
          name: channelName,
          description: `Mock personal Desk automation channel ${channelName}`,
          visibility: 'PRIVATE',
          projectId: project.id,
          type: 'EMAIL',
          deskType: 'EMAIL',
        },
      })
    );

    await assertOkOrCreatedResponse(response, 'Mock personal Desk channel creation');

    const body = (await response.json()) as { id?: string; channelId?: string; name?: string };
    const channelId = body.id ?? body.channelId;
    assert.ok(channelId, 'Expected mock personal Desk channel creation to return a channel id.');

    const sourceResponse = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
      apiContext.post('/api/test/desk/channel-source', {
        data: {
          channelId,
          email: mailboxEmail,
          sourceType: 'google',
        },
      })
    );
    await assertOkResponse(sourceResponse, 'Mock personal Desk channel source setup');

    const storedChannel: StoredConversation = {
      id: channelId,
      name: typeof body.name === 'string' ? body.name : channelName,
      url: `${config.dashboard.baseUrl}/${user.workspaceId}/support/${channelId}`,
      messages: {},
    };
    user.channels[channelAlias] = storedChannel;
    deskChannelDlEmails.set(channelAlias, mailboxEmail);
  }

  @Step('Creating Slack Desk channel <channelAlias> for user <userAlias> in project <projectAlias>')
  public async createSlackDeskChannel(
    channelAlias: string,
    userAlias: string,
    projectAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    assertValidProjectAlias(projectAlias);

    const user = getStoredUser(userAlias);
    const project = user.projects[projectAlias];
    assert.ok(project?.id, `Expected stored project "${projectAlias}" to have an id.`);

    if (user.channels[channelAlias]?.id) {
      return;
    }

    const workspaceResponse = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
      apiContext.post('/api/test/desk/slack-workspace')
    );
    await assertOkResponse(workspaceResponse, 'Mock Slack workspace setup');

    const channelName = buildUniqueDeskChannelName(channelAlias);
    const slackChannelId = `C${buildRandomSuffix().replace(/-/g, '').toUpperCase()}`;

    const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
      apiContext.post('/api/channels', {
        data: {
          scopeType: 'DEFAULT',
          name: channelName,
          description: `Mock Slack Desk automation channel ${channelName}`,
          visibility: 'PRIVATE',
          projectId: project.id,
          type: 'SLACK',
          deskType: 'SLACK',
          slackChannelId,
        },
      })
    );

    await assertOkOrCreatedResponse(response, 'Mock Slack Desk channel creation');

    const body = (await response.json()) as { id?: string; channelId?: string; name?: string };
    const channelId = body.id ?? body.channelId;
    assert.ok(channelId, 'Expected mock Slack Desk channel creation to return a channel id.');

    const storedChannel: StoredConversation = {
      id: channelId,
      name: typeof body.name === 'string' ? body.name : channelName,
      url: `${config.dashboard.baseUrl}/${user.workspaceId}/support/${channelId}`,
      messages: {},
    };
    user.channels[channelAlias] = storedChannel;
    slackChannelIds.set(channelAlias, slackChannelId);
  }

  @Step('clicking on stored Desk channel <channelAlias> for user <userAlias>')
  public async clickStoredDeskChannel(channelAlias: string, userAlias: string): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);

    const user = getStoredUser(userAlias);
    const channel = user.channels[channelAlias];
    assert.ok(channel?.name, `Expected stored channel "${channelAlias}" to have a name.`);

    await testContext.activePage
      .locator('[data-testid="desk-channel-row"]')
      .filter({ hasText: channel.name })
      .first()
      .click();
  }

  @Step('capturing selected Desk channel details for user <userAlias> channel <channelAlias>')
  public async captureSelectedDeskChannel(userAlias: string, channelAlias: string): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidChannelAlias(channelAlias);

    const user = getStoredUser(userAlias);
    const storedChannel = user.channels[channelAlias];
    assert.ok(storedChannel, `Expected stored channel for alias "${channelAlias}".`);

    await testContext.activePage.waitForURL(/\/support\/[^/?#]+/, { timeout: 30000 });
    const match = testContext.activePage.url().match(/\/support\/([^/?#]+)/);
    assert.ok(
      match,
      `Expected URL to contain Desk channel ID. URL: ${testContext.activePage.url()}`
    );

    storedChannel.id = match[1];
    storedChannel.url = testContext.activePage.url();
  }

  @Step('generating mock incoming Desk email <mailAlias>')
  public async generateMockIncomingEmail(mailAlias: string): Promise<void> {
    const suffix = buildRandomSuffix();
    mockDeskMails.set(mailAlias, {
      alias: mailAlias,
      subject: `Desk happy flow ${suffix}`,
      body: `Customer reported a happy-flow automation issue ${suffix}.`,
      from: `customer.${suffix}@example.test`,
      to: config.desk.mockDlEmail,
      threadId: `mock-thread-${suffix}`,
      messageId: `mock-message-${suffix}-inbound`,
    });
  }

  @Step('generating mock incoming Desk email <mailAlias> with reply-all recipients and attachment')
  public async generateMockIncomingEmailWithReplyAllAndAttachment(
    mailAlias: string
  ): Promise<void> {
    const suffix = buildRandomSuffix();
    mockDeskMails.set(mailAlias, {
      alias: mailAlias,
      subject: `Desk advanced flow ${suffix}`,
      body: `Customer reported an advanced automation issue ${suffix}. Please verify UI, update, reply all, and attachment handling.`,
      from: `customer.${suffix}@example.test`,
      to: config.desk.mockDlEmail,
      cc: [`manager.${suffix}@example.test`, `observer.${suffix}@example.test`],
      bcc: [],
      replyTo: [`reply.${suffix}@example.test`],
      attachments: [
        {
          filename: `desk-evidence-${suffix}.txt`,
          mimetype: 'text/plain',
          size: 256,
        },
      ],
      threadId: `mock-thread-advanced-${suffix}`,
      messageId: `mock-message-advanced-${suffix}-inbound`,
    });
  }

  @Step('generating mock Slack Desk message <mailAlias>')
  public async generateMockSlackDeskMessage(mailAlias: string): Promise<void> {
    const suffix = buildRandomSuffix();
    mockDeskMails.set(mailAlias, {
      alias: mailAlias,
      subject: `Slack Desk happy flow ${suffix}`,
      body: `Slack customer message created by automation ${suffix}.`,
      from: `slack.user.${suffix}@example.test`,
      to: `mock-slack-${suffix}@slack.example.test`,
      threadId: `mock-slack-thread-${suffix}`,
      messageId: `mock-slack-message-${suffix}-inbound`,
    });
  }

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
    const user = getStoredUser(userAlias);
    const channel = user.channels[channelAlias];
    assert.ok(channel?.id, `Expected stored channel "${channelAlias}" to have an id.`);
    const dlEmail = deskChannelDlEmails.get(channelAlias) || config.desk.mockDlEmail;
    mail.to = dlEmail;
    mail.channelAlias = channelAlias;

    const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
      apiContext.post('/api/test/desk/incoming-email', {
        data: {
          channelId: channel.id,
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
      })
    );

    await assertOkResponse(response, 'Mock incoming Desk email injection');

    const body = (await response.json()) as Record<string, unknown>;
    const conversation = body.conversation as { conversationId?: string } | undefined;
    const conversationId =
      typeof body.conversationId === 'string' ? body.conversationId : conversation?.conversationId;
    assert.ok(conversationId, 'Expected incoming mail response to include conversationId.');
    mail.conversationId = conversationId;
    await this.fetchAndStoreDeskTicketDetails(mailAlias);
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
    const user = getStoredUser(userAlias);
    const channel = user.channels[channelAlias];
    assert.ok(channel?.id, `Expected stored channel "${channelAlias}" to have an id.`);
    const slackChannelId = slackChannelIds.get(channelAlias);
    assert.ok(slackChannelId, `Expected stored Slack channel id for "${channelAlias}".`);
    mail.to = `${slackChannelId}@slack.example.test`;
    mail.channelAlias = channelAlias;

    const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
      apiContext.post('/api/test/desk/incoming-email', {
        data: {
          channelId: channel.id,
          from: mail.from,
          to: [mail.to],
          subject: mail.subject,
          body: mail.body,
          threadId: mail.threadId,
          messageId: mail.messageId,
        },
      })
    );

    await assertOkResponse(response, 'Mock Slack Desk message injection');

    const body = (await response.json()) as Record<string, unknown>;
    const conversation = body.conversation as { conversationId?: string } | undefined;
    const conversationId =
      typeof body.conversationId === 'string' ? body.conversationId : conversation?.conversationId;
    assert.ok(conversationId, 'Expected Slack message response to include conversationId.');
    mail.conversationId = conversationId;
  }

  @Step('waiting for mock Desk email <mailAlias> subject to appear in <selector>')
  public async waitForMockEmailSubject(mailAlias: string, selector: string): Promise<void> {
    const mail = assertFixture(mailAlias);
    await testContext.activePage
      .locator(selector)
      .getByText(mail.subject, { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: DESK_UI_TIMEOUT_MS });
  }

  @Step('verifying Desk compose control is available for channel <channelAlias> user <userAlias>')
  public async verifyDeskComposeControlAvailable(
    channelAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    await this.openStoredDeskChannelUrl(channelAlias, userAlias);

    await testContext.activePage
      .locator("[data-testid='desk-compose-button']")
      .first()
      .waitFor({ state: 'visible', timeout: DESK_UI_TIMEOUT_MS });
  }

  @Step('verifying Desk AI and rewrite controls are available for email <mailAlias>')
  public async verifyDeskAiAndRewriteControlsAvailable(mailAlias: string): Promise<void> {
    const mail = assertFixture(mailAlias);
    assert.ok(mail.channelAlias, `Expected mock mail "${mailAlias}" to store channel alias.`);
    await this.openStoredDeskChannelUrl(mail.channelAlias, DEFAULT_DESK_API_USER_ALIAS);

    const page = testContext.activePage;
    const ticketSubject = page.getByText(mail.subject, { exact: false }).first();
    await ticketSubject.waitFor({ state: 'visible', timeout: DESK_UI_TIMEOUT_MS });
    await ticketSubject.click();

    await page
      .locator("[data-testid='desk-ticket-ask-ai-button']")
      .first()
      .waitFor({ state: 'visible', timeout: DESK_UI_TIMEOUT_MS });

    const replyButton = page
      .locator("[data-testid='desk-email-reply-button'], [data-testid='desk-open-reply-button']")
      .first();
    await replyButton.waitFor({ state: 'visible', timeout: DESK_UI_TIMEOUT_MS });
    await replyButton.click();

    const editor = page.locator("[data-testid='desk-email-editor']").first();
    await editor.waitFor({ state: 'visible', timeout: DESK_UI_TIMEOUT_MS });
    await editor.click();
    await page.keyboard.insertText('Please rewrite this Desk automation reply.');

    const refineButton = page.locator("[data-testid='desk-ai-refine-button']").first();
    await refineButton.waitFor({ state: 'visible', timeout: DESK_UI_TIMEOUT_MS });
    await refineButton.click();

    await page
      .locator("[data-testid='desk-quick-rewrite-polish']")
      .first()
      .waitFor({ state: 'visible', timeout: DESK_UI_TIMEOUT_MS });
    await page
      .locator("[data-testid='desk-quick-rewrite-shorten']")
      .first()
      .waitFor({ state: 'visible', timeout: DESK_UI_TIMEOUT_MS });
    await page
      .locator("[data-testid='desk-ask-ai-from-composer-button']")
      .first()
      .waitFor({ state: 'visible', timeout: DESK_UI_TIMEOUT_MS });
  }

  @Step('verifying mock Desk email <mailAlias> was ingested')
  public async verifyMockEmailWasIngested(mailAlias: string): Promise<void> {
    const mail = assertFixture(mailAlias);
    assert.ok(mail.conversationId, `Expected mock Desk email "${mailAlias}" to be ingested.`);
  }

  @Step(
    'verifying mock Desk ticket for email <mailAlias> has expected subject body sender and attachment'
  )
  public async verifyMockDeskTicketDetails(mailAlias: string): Promise<void> {
    const mail = assertFixture(mailAlias);
    const details = await this.fetchAndStoreDeskTicketDetails(mailAlias);
    const ticket = details.ticket;
    const firstEmail = details.emails?.[0];

    assert.equal(ticket?.title, mail.subject);
    assert.match(String(ticket?.description ?? ''), new RegExp(this.escapeRegExp(mail.body)));
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
    const user = getStoredUser(userAlias);
    const channel = user.channels[channelAlias];
    assert.ok(channel?.id, `Expected stored channel "${channelAlias}" to have an id.`);

    const details = await this.fetchAndStoreDeskTicketDetails(mailAlias);
    assert.equal(details.ticket?.channelId, channel.id);
    assert.equal(details.ticket?.title, mail.subject);
    assert.equal(details.emails?.[0]?.body, mail.body);
  }

  @Step(
    'updating mock Desk ticket for email <mailAlias> priority to <priority> and status to <status>'
  )
  public async updateMockDeskTicket(
    mailAlias: string,
    priority: string,
    status: string
  ): Promise<void> {
    const mail = assertFixture(mailAlias);
    assert.ok(mail.conversationId, `Expected mock mail "${mailAlias}" to have a conversationId.`);

    const response = await withDevAuthenticatedApiContext(
      DEFAULT_DESK_API_USER_ALIAS,
      (apiContext) =>
        apiContext.patch(`/api/test/desk/ticket/${mail.conversationId}`, {
          data: {
            priority,
            status,
          },
        })
    );
    await assertOkResponse(response, 'Mock Desk ticket update');
  }

  @Step(
    'verifying mock Desk ticket for email <mailAlias> priority is <priority> and status is <status>'
  )
  public async verifyMockDeskTicketUpdate(
    mailAlias: string,
    priority: string,
    status: string
  ): Promise<void> {
    const details = await this.fetchAndStoreDeskTicketDetails(mailAlias);
    assert.equal(details.ticket?.priority, priority);
    assert.equal(details.ticket?.statusV2, status);
  }

  @Step('replying to mock Desk email <mailAlias> from channel <channelAlias> for user <userAlias>')
  public async replyToMockEmail(
    mailAlias: string,
    channelAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);

    const mail = assertFixture(mailAlias);
    const user = getStoredUser(userAlias);
    const channel = user.channels[channelAlias];
    assert.ok(channel?.id, `Expected stored channel "${channelAlias}" to have an id.`);
    assert.ok(mail.conversationId, `Expected mock mail "${mailAlias}" to have a conversationId.`);
    const replyRecipients = mail.replyTo?.length ? mail.replyTo : [mail.from];

    const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
      apiContext.post(`/api/email/${mail.conversationId}/reply`, {
        data: {
          body: `<p>Thanks, we are checking this from Xyne Desk automation.</p>`,
          type: 'REPLY',
          to: replyRecipients,
        },
      })
    );

    await assertOkResponse(response, 'Desk reply API');
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

    const mail = assertFixture(mailAlias);
    const user = getStoredUser(userAlias);
    const channel = user.channels[channelAlias];
    assert.ok(channel?.id, `Expected stored channel "${channelAlias}" to have an id.`);
    assert.ok(mail.conversationId, `Expected mock mail "${mailAlias}" to have a conversationId.`);

    const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
      apiContext.post(`/api/email/${mail.conversationId}/reply`, {
        data: {
          body: `<p>Reply-all response from Xyne Desk automation.</p>`,
          type: 'REPLY_ALL',
          to: [mail.replyTo?.[0] ?? mail.from],
          cc: mail.cc ?? [],
          bcc: [],
        },
      })
    );

    await assertOkResponse(response, 'Desk reply-all API');
  }

  @Step('composing mock Desk email <mailAlias> from channel <channelAlias> for user <userAlias>')
  public async composeMockDeskEmail(
    mailAlias: string,
    channelAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);

    const suffix = buildRandomSuffix();
    const channelId = this.getStoredChannelId(channelAlias, userAlias);
    const mail: MockDeskMailFixture = {
      alias: mailAlias,
      subject: `Desk compose flow ${suffix}`,
      body: `<p>New composed Desk mail from automation ${suffix}.</p>`,
      from: deskChannelDlEmails.get(channelAlias) ?? config.desk.mockDlEmail,
      to: `compose.recipient.${suffix}@example.test`,
      cc: [`compose.cc.${suffix}@example.test`],
      bcc: [],
      threadId: `mock-compose-thread-${suffix}`,
      messageId: `mock-compose-message-${suffix}`,
      channelAlias,
    };

    const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
      apiContext.post('/api/email/compose', {
        data: {
          channelId,
          to: [mail.to],
          cc: mail.cc ?? [],
          bcc: mail.bcc ?? [],
          subject: mail.subject,
          body: mail.body,
        },
      })
    );

    await assertOkResponse(response, 'Desk compose API');

    const body = (await response.json()) as {
      conversationId?: string;
      ticketId?: string;
      ticketXyneId?: string;
      threadId?: string;
    };
    assert.ok(body.conversationId, 'Expected Desk compose response to include conversationId.');
    assert.ok(body.ticketId, 'Expected Desk compose response to include ticketId.');
    mail.conversationId = body.conversationId;
    mail.ticketId = body.ticketId;
    mail.xyneId = body.ticketXyneId;
    if (body.threadId) {
      mail.threadId = body.threadId;
    }
    mockDeskMails.set(mailAlias, mail);
  }

  @Step('verifying latest mock Desk composed mail matches <mailAlias>')
  public async verifyLatestMockComposedMail(mailAlias: string): Promise<void> {
    const mail = assertFixture(mailAlias);
    assert.ok(mail.channelAlias, `Expected composed mail "${mailAlias}" to store channel alias.`);
    const channelId = this.getStoredChannelId(mail.channelAlias, DEFAULT_DESK_API_USER_ALIAS);

    const response = await withDevAuthenticatedApiContext(
      DEFAULT_DESK_API_USER_ALIAS,
      (apiContext) =>
        apiContext.get(`/api/test/desk/sent-mails?channelId=${encodeURIComponent(channelId)}`)
    );
    await assertOkResponse(response, 'Mock Desk sent mails request');

    const body = (await response.json()) as { sentMails?: SentMail[] };
    const sentMails = body.sentMails ?? [];
    const latest = sentMails[sentMails.length - 1];
    assert.ok(latest, 'Expected latest mock Desk composed mail to exist.');
    assert.equal(latest.kind, 'compose');
    assert.equal(latest.status, 'sent');
    assert.deepEqual(latest.to, [mail.to]);
    assert.deepEqual(latest.cc, mail.cc ?? []);
    assert.equal(latest.subject, mail.subject);
    assert.match(String(latest.body), /New composed Desk mail/);
  }

  @Step('merging mock Desk ticket <sourceMailAlias> into <targetMailAlias> as user <userAlias>')
  public async mergeMockDeskTicket(
    sourceMailAlias: string,
    targetMailAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    const source = await this.fetchAndStoreDeskTicketDetails(sourceMailAlias);
    const target = await this.fetchAndStoreDeskTicketDetails(targetMailAlias);
    assert.ok(source.ticket?.id, `Expected source ticket for "${sourceMailAlias}".`);
    assert.ok(target.ticket?.id, `Expected target ticket for "${targetMailAlias}".`);

    const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
      apiContext.post(`/api/tickets/${source.ticket?.id}/merge`, {
        data: { targetTicketId: target.ticket?.id },
      })
    );

    await assertOkResponse(response, 'Desk ticket merge');
  }

  @Step('verifying mock Desk ticket <sourceMailAlias> is merged into <targetMailAlias>')
  public async verifyMockDeskTicketMerged(
    sourceMailAlias: string,
    targetMailAlias: string
  ): Promise<void> {
    const source = await this.fetchAndStoreDeskTicketDetails(sourceMailAlias);
    const target = await this.fetchAndStoreDeskTicketDetails(targetMailAlias);

    assert.equal(source.ticket?.isArchived, true);
    assert.equal(source.ticket?.mergedIntoTicketId, target.ticket?.id);
  }

  @Step('unmerging mock Desk ticket <sourceMailAlias> as user <userAlias>')
  public async unmergeMockDeskTicket(sourceMailAlias: string, userAlias: string): Promise<void> {
    assertValidUserAlias(userAlias);
    const source = await this.fetchAndStoreDeskTicketDetails(sourceMailAlias);
    assert.ok(source.ticket?.id, `Expected source ticket for "${sourceMailAlias}".`);

    const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
      apiContext.post(`/api/tickets/${source.ticket?.id}/unmerge`)
    );

    await assertOkResponse(response, 'Desk ticket unmerge');
  }

  @Step('verifying mock Desk ticket <sourceMailAlias> is unmerged')
  public async verifyMockDeskTicketUnmerged(sourceMailAlias: string): Promise<void> {
    const source = await this.fetchAndStoreDeskTicketDetails(sourceMailAlias);

    assert.equal(source.ticket?.isArchived, false);
    assert.equal(source.ticket?.mergedIntoTicketId, null);
  }

  @Step('verifying mock Desk sent mail count is <expectedCount> for incoming email <mailAlias>')
  public async verifyMockSentMailCount(expectedCount: string, mailAlias: string): Promise<void> {
    const mail = assertFixture(mailAlias);
    assert.ok(mail.conversationId, `Expected mock mail "${mailAlias}" to have a conversationId.`);
    const conversationId = mail.conversationId;

    const response = await withDevAuthenticatedApiContext(
      DEFAULT_DESK_API_USER_ALIAS,
      (apiContext) =>
        apiContext.get(
          `/api/test/desk/sent-mails?conversationId=${encodeURIComponent(conversationId)}`
        )
    );
    await assertOkResponse(response, 'Mock Desk sent mails request');

    const body = (await response.json()) as { sentMails?: SentMail[] };
    assert.equal(
      body.sentMails?.length ?? 0,
      Number.parseInt(expectedCount, 10),
      `Expected ${expectedCount} mock Desk sent mail(s).`
    );
  }

  @Step('verifying latest mock Desk sent mail matches incoming email <mailAlias>')
  public async verifyLatestMockSentMail(mailAlias: string): Promise<void> {
    const mail = assertFixture(mailAlias);
    assert.ok(mail.conversationId, `Expected mock mail "${mailAlias}" to have a conversationId.`);
    const conversationId = mail.conversationId;

    const response = await withDevAuthenticatedApiContext(
      DEFAULT_DESK_API_USER_ALIAS,
      (apiContext) =>
        apiContext.get(
          `/api/test/desk/sent-mails?conversationId=${encodeURIComponent(conversationId)}`
        )
    );
    await assertOkResponse(response, 'Mock Desk sent mails request');

    const body = (await response.json()) as { sentMails?: SentMail[] };
    const sentMails = body.sentMails ?? [];
    const latest = sentMails[sentMails.length - 1];
    assert.ok(latest, 'Expected latest mock Desk sent mail to exist.');
    assert.equal(latest.kind, 'reply');
    assert.equal(latest.status, 'sent');
    assert.equal(latest.from, mail.to);
    assert.deepEqual(latest.to, mail.replyTo?.length ? mail.replyTo : [mail.from]);
    assert.equal(latest.subject, `Re: ${mail.subject}`);
    assert.match(String(latest.body), /Xyne Desk automation/);
  }

  @Step('verifying latest mock Desk sent reply-all mail matches incoming email <mailAlias>')
  public async verifyLatestMockReplyAllSentMail(mailAlias: string): Promise<void> {
    const mail = assertFixture(mailAlias);
    assert.ok(mail.conversationId, `Expected mock mail "${mailAlias}" to have a conversationId.`);
    const conversationId = mail.conversationId;

    const response = await withDevAuthenticatedApiContext(
      DEFAULT_DESK_API_USER_ALIAS,
      (apiContext) =>
        apiContext.get(
          `/api/test/desk/sent-mails?conversationId=${encodeURIComponent(conversationId)}`
        )
    );
    await assertOkResponse(response, 'Mock Desk sent mails request');

    const body = (await response.json()) as { sentMails?: SentMail[] };
    const sentMails = body.sentMails ?? [];
    const latest = sentMails[sentMails.length - 1];
    assert.ok(latest, 'Expected latest mock Desk sent reply-all mail to exist.');
    assert.equal(latest.kind, 'reply');
    assert.equal(latest.status, 'sent');
    assert.equal(latest.from, mail.to);
    assert.deepEqual(latest.to, [mail.replyTo?.[0] ?? mail.from]);
    assert.deepEqual(latest.cc, mail.cc ?? []);
    assert.equal(latest.subject, `Re: ${mail.subject}`);
    assert.match(String(latest.body), /Reply-all response/);
  }

  @Step('resetting mock DL provider state')
  public async resetMockDlProviderState(): Promise<void> {
    mockDlEmails.clear();

    const response = await withDevAuthenticatedApiContext(
      DEFAULT_DESK_API_USER_ALIAS,
      (apiContext) => apiContext.post('/api/test/desk/mock-dl/reset')
    );

    await assertOkResponse(response, 'Mock DL provider reset');
  }

  @Step('creating mock DL <dlAlias>')
  public async createMockDl(dlAlias: string): Promise<void> {
    const suffix = buildRandomSuffix();
    const email = `${dlAlias}.${suffix}@${getSharedMailboxDomain()}`.toLowerCase();
    mockDlEmails.set(dlAlias, email);

    const response = await withDevAuthenticatedApiContext(
      DEFAULT_DESK_API_USER_ALIAS,
      (apiContext) => apiContext.post('/api/test/desk/mock-dl', { data: { email } })
    );

    await assertOkResponse(response, `Mock DL "${dlAlias}" creation`);
  }

  @Step('adding member <memberEmail> to mock DL <dlAlias>')
  public async addMemberToMockDl(memberEmail: string, dlAlias: string): Promise<void> {
    const dlEmail = this.getMockDlEmail(dlAlias);
    const response = await withDevAuthenticatedApiContext(
      DEFAULT_DESK_API_USER_ALIAS,
      (apiContext) =>
        apiContext.post(`/api/test/desk/mock-dl/${encodeURIComponent(dlEmail)}/members`, {
          data: { memberEmail },
        })
    );

    await assertOkResponse(response, `Mock DL "${dlAlias}" member add`);
  }

  @Step('removing member <memberEmail> from mock DL <dlAlias>')
  public async removeMemberFromMockDl(memberEmail: string, dlAlias: string): Promise<void> {
    const dlEmail = this.getMockDlEmail(dlAlias);
    const response = await withDevAuthenticatedApiContext(
      DEFAULT_DESK_API_USER_ALIAS,
      (apiContext) =>
        apiContext.delete(
          `/api/test/desk/mock-dl/${encodeURIComponent(dlEmail)}/members/${encodeURIComponent(
            memberEmail
          )}`
        )
    );

    await assertOkResponse(response, `Mock DL "${dlAlias}" member removal`);
  }

  @Step('sending mock provider mail <mailAlias> to mock DL <dlAlias>')
  public async sendMockProviderMailToDl(mailAlias: string, dlAlias: string): Promise<void> {
    const dlEmail = this.getMockDlEmail(dlAlias);
    const suffix = buildRandomSuffix();
    const subject = `Mock DL delivery ${mailAlias} ${suffix}`;

    const response = await withDevAuthenticatedApiContext(
      DEFAULT_DESK_API_USER_ALIAS,
      (apiContext) =>
        apiContext.post(`/api/test/desk/mock-dl/${encodeURIComponent(dlEmail)}/send`, {
          data: {
            from: `sender.${suffix}@example.test`,
            subject,
            body: `Mock provider DL delivery body for ${mailAlias}.`,
          },
        })
    );

    await assertOkResponse(response, `Mock provider mail "${mailAlias}" send`);
  }

  @Step('verifying mock inbox <memberEmail> total mail count is <expectedCount>')
  public async verifyMockInboxTotalCount(
    memberEmail: string,
    expectedCount: string
  ): Promise<void> {
    const inbox = await this.fetchMockInbox(memberEmail);

    assert.equal(
      inbox.length,
      Number.parseInt(expectedCount, 10),
      `Expected "${memberEmail}" mock inbox to contain ${expectedCount} mail(s).`
    );
  }

  @Step('verifying mock inbox <memberEmail> has <expectedCount> mails from mock DL <dlAlias>')
  public async verifyMockInboxCountFromDl(
    memberEmail: string,
    expectedCount: string,
    dlAlias: string
  ): Promise<void> {
    const dlEmail = this.getMockDlEmail(dlAlias);
    const inbox = await this.fetchMockInbox(memberEmail);
    const mailsFromDl = inbox.filter((mail) => mail.dlEmail === dlEmail);

    assert.equal(
      mailsFromDl.length,
      Number.parseInt(expectedCount, 10),
      `Expected "${memberEmail}" mock inbox to contain ${expectedCount} mail(s) from "${dlEmail}".`
    );
  }

  private getStoredChannelId(channelAlias: string, userAlias: string): string {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);

    const user = getStoredUser(userAlias);
    const channel = user.channels[channelAlias];
    assert.ok(channel?.id, `Expected stored channel "${channelAlias}" to have an id.`);
    return channel.id;
  }

  private async fetchDeskChannelConnectionStatus(
    channelAlias: string,
    userAlias: string
  ): Promise<ConnectedDeskSourceStatus> {
    const channelId = this.getStoredChannelId(channelAlias, userAlias);

    const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
      apiContext.get(`/api/channels/${channelId}/connected-email`)
    );
    await assertOkResponse(response, 'Desk channel connection status');

    return (await response.json()) as ConnectedDeskSourceStatus;
  }

  private getMockDlEmail(dlAlias: string): string {
    const email = mockDlEmails.get(dlAlias);
    assert.ok(email, `Expected mock DL "${dlAlias}" to have been created.`);
    return email;
  }

  private async fetchMockInbox(memberEmail: string): Promise<MockDlMail[]> {
    const response = await withDevAuthenticatedApiContext(
      DEFAULT_DESK_API_USER_ALIAS,
      (apiContext) => apiContext.get(`/api/test/desk/mock-inbox/${encodeURIComponent(memberEmail)}`)
    );
    await assertOkResponse(response, `Mock inbox "${memberEmail}" request`);

    const body = (await response.json()) as { inbox?: MockDlMail[] };
    return body.inbox ?? [];
  }

  private async fetchAndStoreDeskTicketDetails(mailAlias: string): Promise<DeskTicketDetails> {
    const mail = assertFixture(mailAlias);
    assert.ok(mail.conversationId, `Expected mock mail "${mailAlias}" to have a conversationId.`);

    const response = await withDevAuthenticatedApiContext(
      DEFAULT_DESK_API_USER_ALIAS,
      (apiContext) => apiContext.get(`/api/test/desk/ticket/${mail.conversationId}`)
    );
    await assertOkResponse(response, 'Mock Desk ticket details request');

    const details = (await response.json()) as DeskTicketDetails;
    if (details.ticket?.id) {
      mail.ticketId = details.ticket.id;
    }
    if (details.ticket?.xyneId) {
      mail.xyneId = details.ticket.xyneId;
    }
    return details;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async navigateToSupportModule(workspacePrefix: string): Promise<void> {
    const page = testContext.activePage;
    const supportInboxUrl = `${config.dashboard.baseUrl}${workspacePrefix}/support/all`;
    const desktopSupportNav = page.locator("[data-testid='nav-support']").first();
    if (await this.isVisible(desktopSupportNav, 5000)) {
      await desktopSupportNav.click();
      await waitForDeskPageToSettle();
      if (page.url().replace(/\/$/, '').endsWith('/support')) {
        await page.goto(supportInboxUrl, {
          waitUntil: 'domcontentloaded',
          timeout: DESK_UI_TIMEOUT_MS,
        });
        await waitForDeskPageToSettle();
      }
      return;
    }

    const moreNav = page
      .locator("[data-testid='mobile-nav-more'], [aria-label='More options']")
      .first();
    if (!(await this.isVisible(moreNav, 5000))) {
      await page.goto(supportInboxUrl, {
        waitUntil: 'domcontentloaded',
        timeout: DESK_UI_TIMEOUT_MS,
      });
      await waitForDeskPageToSettle();
      return;
    }

    await moreNav.click();
    const mobileSupportNav = page.locator("[data-testid='mobile-nav-support']").first();
    if (await this.isVisible(mobileSupportNav, 5000)) {
      await mobileSupportNav.click();
      await waitForDeskPageToSettle();
      return;
    }

    const supportLink = page.getByRole('link', { name: 'Support' }).first();
    if (await this.isVisible(supportLink, 5000)) {
      await supportLink.click();
      await waitForDeskPageToSettle();
      if (page.url().replace(/\/$/, '').endsWith('/support')) {
        await page.goto(supportInboxUrl, {
          waitUntil: 'domcontentloaded',
          timeout: DESK_UI_TIMEOUT_MS,
        });
        await waitForDeskPageToSettle();
      }
      return;
    }

    await page.goto(supportInboxUrl, {
      waitUntil: 'domcontentloaded',
      timeout: DESK_UI_TIMEOUT_MS,
    });
    await waitForDeskPageToSettle();
  }

  private async openStoredDeskChannelUrl(channelAlias: string, userAlias: string): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);

    const user = getStoredUser(userAlias);
    const channel = user.channels[channelAlias];
    assert.ok(channel?.id, `Expected stored channel "${channelAlias}" to have an id.`);
    const channelId = channel.id;

    await ensureBrowserAuthenticatedForDesk(userAlias);

    const workspacePrefix = user.workspaceId ? `/${user.workspaceId}` : '';
    const url = `${config.dashboard.baseUrl}${workspacePrefix}/support/${channelId}`;
    const supportInboxUrl = `${config.dashboard.baseUrl}${workspacePrefix}/support/all`;
    const page = testContext.activePage;
    const supportPage = page.locator("[data-testid='support-page']");

    const openSupportPage = async (): Promise<void> => {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: DESK_UI_TIMEOUT_MS,
      });
      await waitForDeskPageToSettle();
      if (page.url().includes('/auth')) {
        throw new Error(`Direct Desk channel open redirected to auth. Current URL: ${page.url()}`);
      }
      await supportPage.waitFor({ state: 'visible', timeout: DESK_UI_TIMEOUT_MS });
    };

    const openSupportViaChannelList = async (): Promise<void> => {
      await page.goto(supportInboxUrl, {
        waitUntil: 'domcontentloaded',
        timeout: DESK_UI_TIMEOUT_MS,
      });
      await waitForDeskPageToSettle();
      if (page.url().includes('/auth')) {
        await ensureBrowserAuthenticatedForDesk(userAlias, { force: true });
        await page.goto(supportInboxUrl, {
          waitUntil: 'domcontentloaded',
          timeout: DESK_UI_TIMEOUT_MS,
        });
        await waitForDeskPageToSettle();
      }
      await supportPage.waitFor({ state: 'visible', timeout: DESK_UI_TIMEOUT_MS });

      const channelRow = page
        .locator('[data-testid="desk-channel-row"]')
        .filter({ hasText: channel.name ?? channelAlias })
        .first();

      if (!(await this.isVisible(channelRow, DESK_UI_TIMEOUT_MS))) {
        throw new Error(
          `Desk channel row "${channel.name ?? channelAlias}" was not visible on Support page. Current URL: ${page.url()}`
        );
      }

      await channelRow.click();
      await page
        .waitForURL(new RegExp(`/support/${this.escapeRegExp(channelId)}(?:[/?#]|$)`), {
          timeout: DESK_UI_TIMEOUT_MS,
        })
        .catch(() => undefined);
      await waitForDeskPageToSettle();
      await supportPage.waitFor({ state: 'visible', timeout: DESK_UI_TIMEOUT_MS });
    };

    const openSupportWithNavigationFallback = async (directError: unknown): Promise<void> => {
      const firstErrorMessage =
        directError instanceof Error ? directError.message : String(directError);
      try {
        await openSupportViaChannelList();
      } catch (fallbackError) {
        const fallbackMessage =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error(
          `Support page did not render for channel "${channelAlias}" user "${userAlias}". Current URL: ${page.url()}. Direct open failed: ${firstErrorMessage}. Navigation fallback failed: ${fallbackMessage}`
        );
      }
    };

    const openSupportWithFreshAuth = async (): Promise<void> => {
      await ensureBrowserAuthenticatedForDesk(userAlias, { force: true });
      try {
        await openSupportPage();
      } catch (error) {
        await openSupportWithNavigationFallback(error);
      }
    };

    try {
      await openSupportPage();
    } catch (error) {
      if (page.url().includes('/auth')) {
        await openSupportWithFreshAuth();
        return;
      }

      await openSupportWithNavigationFallback(error);
    }
  }

  private async isVisible(locator: Locator, timeout: number): Promise<boolean> {
    try {
      await locator.waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }
}
