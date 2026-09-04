/**
 * Baseline fixture for the xyne-automation suite.
 *
 * **baseline** = read-only suite-shared fixture (project-1, channel-1).
 * Created once per run by bootstrapBaselineFixture(), reused across all scenarios.
 *
 * **net-new** = scenario-local entities with caller-provided aliases.
 * Created per-scenario, do not persist across runs.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { config } from '@/config';
import { baselineLogger } from '@/lib/logger';
import { buildRandomSuffix } from '@/fixtures/fixture-helpers';
import { getUserCatalogEntry } from '@/fixtures/user-catalog';
import {
  type StoredConversation,
  type StoredMessage,
  type StoredProject,
  type StoredUser,
  testContext,
} from '@/tests/shared/runtime/test-context';
import {
  ensureBrowserSession,
  resetAllBrowserSessionsForReuse,
} from '@/tests/shared/support/browser-manager';
import {
  assertValidChannelAlias,
  assertValidProjectAlias,
} from '@/tests/shared/support/literal-validation';
import { writeBaselineContextSnapshot } from '@/tests/shared/support/report-artifacts';

// =============================================================================
// CONTRACT
// =============================================================================

export const BASELINE_OWNER_ALIAS = 'admin-1';
export const BASELINE_USER_ALIAS = 'user-1';
export const BASELINE_SECONDARY_USER_ALIAS = 'user-2';
export const BASELINE_PROJECT_KEY = 'project-1';
export const BASELINE_CHANNEL_KEY = 'channel-1';
export const BASELINE_DM_KEY = 'dm-1';
export const BASELINE_SEED_MESSAGE_KEY = 'message-baseline';

const netNewChannelAliasPattern = /^channel-[a-zA-Z0-9-]+$/;

export function isBaselineProjectKey(alias: string): boolean {
  return alias === BASELINE_PROJECT_KEY;
}

export function isBaselineChannelKey(alias: string): boolean {
  return alias === BASELINE_CHANNEL_KEY;
}

export function assertBaselineProjectAlias(alias: string): void {
  assertValidProjectAlias(alias);
  if (alias !== BASELINE_PROJECT_KEY) {
    throw new Error(
      `Baseline ensure only accepts project-1 as alias. Got: ${alias}. For net-new projects, use the create flow.`
    );
  }
}

export function isNetNewChannelAlias(alias: string): boolean {
  return netNewChannelAliasPattern.test(alias) && alias !== BASELINE_CHANNEL_KEY;
}

export function assertNetNewChannelAlias(alias: string): void {
  assertValidChannelAlias(alias);
  if (!isNetNewChannelAlias(alias)) {
    throw new Error(
      `Channel creation only accepts net-new channel aliases. Got: ${alias}. Use channel-1 only through the baseline ensure flow.`
    );
  }
}

// =============================================================================
// REGISTRY
// =============================================================================

export interface BaselineProject {
  id?: string;
  name: string;
  code: string;
  description: string;
}

export interface BaselineSeedMessage {
  baseText: string;
  text: string;
}

export interface BaselineChannel {
  id?: string;
  name: string;
  url?: string;
  seedMessage?: BaselineSeedMessage;
}

export interface BaselineDm {
  id?: string;
  name: string;
  url?: string;
  ownerAlias: string;
  partnerAlias: string;
  seedMessage?: BaselineSeedMessage;
}

export interface BaselineFixtureData {
  runId: string;
  ownerUserAlias: string;
  project: BaselineProject;
  channel: BaselineChannel;
  dm?: BaselineDm;
}

const REGISTRY_FILENAME = 'baseline-fixtures.json';

function getBaselineFixtureFilePath(): string {
  const artifactDir = process.env.XYNE_RUN_ARTIFACT_DIR;
  if (!artifactDir) {
    throw new Error(
      'XYNE_RUN_ARTIFACT_DIR is not set. This should be set by the test runner (run-gauge.ts).'
    );
  }
  return path.resolve(artifactDir, REGISTRY_FILENAME);
}

export async function writeBaselineFixtureRegistry(data: BaselineFixtureData): Promise<void> {
  const filePath = getBaselineFixtureFilePath();
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function loadBaselineFixtureRegistry(): Promise<BaselineFixtureData> {
  const filePath = getBaselineFixtureFilePath();

  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch {
    throw new Error(
      `Baseline fixture registry not found: ${filePath}. Ensure BeforeSuite ran successfully.`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Error(`Baseline fixture registry contains invalid JSON: ${filePath}`);
  }

  const data = parsed as Record<string, unknown>;

  if (typeof data.runId !== 'string' || data.runId.length === 0) {
    throw new Error(`Baseline fixture registry missing "runId": ${filePath}`);
  }
  if (typeof data.ownerUserAlias !== 'string' || data.ownerUserAlias.length === 0) {
    throw new Error(`Baseline fixture registry missing "ownerUserAlias": ${filePath}`);
  }
  if (!data.project || typeof data.project !== 'object' || data.project === null) {
    throw new Error(`Baseline fixture registry missing "project": ${filePath}`);
  }

  const project = data.project as Record<string, unknown>;
  if (typeof project.name !== 'string' || project.name.length === 0) {
    throw new Error(`Baseline fixture registry missing "project.name": ${filePath}`);
  }
  if (typeof project.code !== 'string' || project.code.length === 0) {
    throw new Error(`Baseline fixture registry missing "project.code": ${filePath}`);
  }
  if (typeof project.description !== 'string' || project.description.length === 0) {
    throw new Error(`Baseline fixture registry missing "project.description": ${filePath}`);
  }

  if (!data.channel || typeof data.channel !== 'object' || data.channel === null) {
    throw new Error(`Baseline fixture registry missing "channel": ${filePath}`);
  }
  const channel = data.channel as Record<string, unknown>;
  if (typeof channel.name !== 'string' || channel.name.length === 0) {
    throw new Error(`Baseline fixture registry missing "channel.name": ${filePath}`);
  }

  const channelSeed = parseSeedMessage(channel.seedMessage);

  let dm: BaselineDm | undefined;
  if (data.dm && typeof data.dm === 'object' && data.dm !== null) {
    const dmRaw = data.dm as Record<string, unknown>;
    if (
      typeof dmRaw.name === 'string' &&
      dmRaw.name.length > 0 &&
      typeof dmRaw.ownerAlias === 'string' &&
      dmRaw.ownerAlias.length > 0 &&
      typeof dmRaw.partnerAlias === 'string' &&
      dmRaw.partnerAlias.length > 0
    ) {
      dm = {
        id: typeof dmRaw.id === 'string' && dmRaw.id.length > 0 ? dmRaw.id : undefined,
        name: dmRaw.name,
        url: typeof dmRaw.url === 'string' ? dmRaw.url : undefined,
        ownerAlias: dmRaw.ownerAlias,
        partnerAlias: dmRaw.partnerAlias,
        seedMessage: parseSeedMessage(dmRaw.seedMessage),
      };
    }
  }

  return {
    runId: data.runId,
    ownerUserAlias: data.ownerUserAlias,
    project: {
      id: typeof project.id === 'string' && project.id.length > 0 ? project.id : undefined,
      name: project.name,
      code: project.code,
      description: project.description,
    },
    channel: {
      id: typeof channel.id === 'string' && channel.id.length > 0 ? channel.id : undefined,
      name: channel.name,
      url: typeof channel.url === 'string' ? channel.url : undefined,
      seedMessage: channelSeed,
    },
    ...(dm ? { dm } : {}),
  };
}

function parseSeedMessage(value: unknown): BaselineSeedMessage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.baseText !== 'string' || typeof raw.text !== 'string') return undefined;
  if (raw.baseText.length === 0 || raw.text.length === 0) return undefined;
  return { baseText: raw.baseText, text: raw.text };
}

// =============================================================================
// BOOTSTRAP
// =============================================================================

interface AuthResponseBody {
  user?: {
    id?: unknown;
    email?: unknown;
    name?: unknown;
    profilePictureUrl?: unknown;
    workspaceId?: unknown;
  };
}

interface CreateChannelResponseBody {
  id?: unknown;
  name?: unknown;
}

function assertString(value: unknown, label: string): asserts value is string {
  assert.equal(typeof value, 'string', `Expected ${label} to be a string.`);
}

async function clearAuthState(): Promise<void> {
  const page = testContext.activePage;
  const context = testContext.currentSession.context;

  await context.clearCookies();
  // Keep the page on a script-free resource while switching fixture users.
  // This establishes the dashboard origin for localStorage without allowing a
  // pending app redirect to race the next login.
  await page.goto(`${config.dashboard.baseUrl}/version.json`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

async function loginAsUser(userAlias: string): Promise<StoredUser> {
  await clearAuthState();

  const catalogUser = getUserCatalogEntry(userAlias);
  const params = new URLSearchParams({ email: catalogUser.email, setAsNewUser: 'false' });

  const page = testContext.activePage;
  const response = await page.request.post(
    `${config.dashboard.baseUrl}/api/test/auth/login?${params.toString()}`,
    { data: {} }
  );
  assert.equal(
    response.ok(),
    true,
    `Expected baseline test login for ${userAlias} to succeed, got status ${response.status()}.`
  );
  const body = (await response.json().catch(() => null)) as AuthResponseBody | null;
  const user = body?.user;

  assert.ok(user, 'Expected auth response to contain user data.');
  assertString(user.id, 'user.id');
  assertString(user.email, 'user.email');
  assertString(user.name, 'user.name');
  assertString(user.workspaceId, 'user.workspaceId');

  await page.evaluate(
    ({ userId, userEmail }) => {
      localStorage.setItem('user_id', userId);
      localStorage.setItem('user_email', userEmail);
      localStorage.setItem('xyne-ai-onboarding-completed', 'true');
      localStorage.removeItem('xyne-ai-onboarding-active');
      sessionStorage.removeItem('xyne-ai-onboarding-pending');
    },
    { userId: user.id, userEmail: user.email }
  );

  return {
    alias: catalogUser.alias,
    role: catalogUser.role,
    id: user.id,
    email: user.email,
    name: user.name || catalogUser.alias,
    workspaceId: user.workspaceId,
    profilePictureUrl:
      typeof user.profilePictureUrl === 'string' ? user.profilePictureUrl : undefined,
    projects: {},
    channels: {},
    dms: {},
    tickets: {},
  };
}

async function addMemberToChannel(_adminUser: StoredUser, user: StoredUser): Promise<void> {
  const page = testContext.activePage;

  await page.locator("[data-testid='channel-info-trigger']").first().click();
  await page.locator("[data-testid='add-people-button']").first().click();

  const searchInput = page.locator("[data-testid='user-search-input']").first();
  await searchInput.waitFor({ state: 'visible' });
  await searchInput.fill(user.email);

  const searchResults = page.locator("[data-testid='user-search-results']").first();
  await searchResults.waitFor({ state: 'visible' });
  await searchResults.getByText(user.name, { exact: false }).first().click();

  await page.locator("[data-testid='add-people-submit']").first().click();
  await page.locator("[data-testid='add-people-submit']").waitFor({ state: 'hidden' });
  await page.locator("[data-testid='user-search-input']").waitFor({ state: 'hidden' });

  // Close any remaining sheet/dialog overlays (channel info panel, dialog backdrop)
  // by pressing Escape until no open-state overlay intercepts pointer events.
  for (let attempt = 0; attempt < 5; attempt++) {
    const openOverlay = page.locator('div[data-state="open"].fixed.inset-0.bg-black\\/50');
    if ((await openOverlay.count()) === 0) {
      break;
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  await page.locator("[data-testid='message-input']").first().waitFor({ state: 'visible' });

  // "submitted", not "added": the modal closes on submit regardless of the
  // mutation's outcome. Membership is verified in ensureBaselineChannelMembership.
  baselineLogger.info(`[5/5] Add-people submitted for ${user.alias} on baseline channel`);
}

// Whether the channel is in this member's sidebar. Must be checked from the
// member's own session -- the owner's view looks fine either way.
async function isBaselineChannelVisibleToMember(
  channelName: string,
  workspaceId: string,
  timeoutMs: number
): Promise<boolean> {
  const page = testContext.activePage;

  // Direct fixture login intentionally leaves the page on /version.json to
  // avoid loading the app for users that are only needed by API setup. Load the
  // authenticated member's chat route before checking their sidebar.
  await page.goto(`${config.dashboard.baseUrl}/${workspaceId}/chat/dir`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  const channelList = page.locator("[data-testid='channel-list']").first();
  await channelList.waitFor({ state: 'visible', timeout: 60000 });

  try {
    await channelList
      .getByText(channelName, { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function addChannelParticipantsViaApi(channelId: string, emails: string[]): Promise<void> {
  const url = `${config.backend.baseUrl}/api/test/fixtures/channel-participants`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId, emails }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '<unreadable body>');
    throw new Error(
      `Fixture API failed to add participants (${response.status}) at ${url}: ${detail}`
    );
  }
}

// Log in as each member and report those who cannot see the channel.
async function findMembersMissingChannel(
  channelName: string,
  members: StoredUser[],
  timeoutMs: number
): Promise<StoredUser[]> {
  const missing: StoredUser[] = [];
  for (const member of members) {
    const authenticatedMember = await loginAsUser(member.alias);
    assertString(
      authenticatedMember.workspaceId,
      `workspaceId for baseline member ${authenticatedMember.alias}`
    );
    if (
      !(await isBaselineChannelVisibleToMember(
        channelName,
        authenticatedMember.workspaceId,
        timeoutMs
      ))
    ) {
      missing.push(member);
    }
  }
  return missing;
}

// AddPeopleForm fires `void zero.mutate(channel.addParticipants(...))` without
// awaiting, so a dropped mutation is indistinguishable from success and leaves
// the channel private to its owner. Verify every intended member from their own
// session and repair via the test-only API if the UI add did not take. The
// error-level log is deliberate: a silent fallback would bury the regression.
async function ensureBaselineChannelMembership(
  channelId: string,
  channelName: string,
  members: StoredUser[]
): Promise<void> {
  let missing = await findMembersMissingChannel(channelName, members, 15000);

  if (missing.length > 0) {
    baselineLogger.error(
      `UI add-people did not take for baseline channel "${channelName}" -- not visible to ` +
        `${missing.map((m) => m.alias).join(', ')}. Repairing via the fixture API: ` +
        'channel.addParticipants was dropped, investigate rather than treating this as noise.'
    );

    await addChannelParticipantsViaApi(
      channelId,
      members.map((member) => member.email)
    );

    missing = await findMembersMissingChannel(channelName, members, 30000);
    if (missing.length > 0) {
      throw new Error(
        `Baseline channel "${channelName}" is still not visible to ` +
          `${missing.map((m) => `${m.alias} (${m.email})`).join(', ')} after the fixture API ` +
          'added the participants. The channel is unusable by those members.'
      );
    }

    baselineLogger.info(
      `Baseline channel membership repaired via fixture API for "${channelName}"`
    );
  }

  // findMembersMissingChannel leaves the last-checked member logged in; restore
  // the primary member so the caller creates the DM from the right session.
  const primary = members[0];
  if (primary) {
    await loginAsUser(primary.alias);
  }
}

// The chat view can hit a transient render race on the first cold load in a fresh
// container, tripping the app's error boundary. It recovers on reload, so navigate
// and reload until the expected control renders (later navigations are unaffected).
async function gotoChatViewUntilReady(url: string, readySelector: string): Promise<void> {
  const page = testContext.activePage;
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt === 1) {
      await page.goto(url, { waitUntil: 'networkidle' });
    } else {
      await page.reload({ waitUntil: 'networkidle' });
    }

    const ready = page.locator(readySelector).first();
    const boundary = page.getByText('Oops! Something went wrong', { exact: false }).first();
    const outcome = await Promise.race([
      ready
        .waitFor({ state: 'visible', timeout: 25000 })
        .then(() => 'ready' as const)
        .catch(() => 'timeout' as const),
      boundary
        .waitFor({ state: 'visible', timeout: 25000 })
        .then(() => 'boundary' as const)
        .catch(() => 'timeout' as const),
    ]);

    if (outcome === 'ready') return;
    baselineLogger.warn(
      `Chat view not ready at ${url} (attempt ${attempt}/${maxAttempts}, outcome=${outcome}); reloading.`
    );
  }
  // Surface a clear failure via the caller's expected control if still not ready.
  await page.locator(readySelector).first().waitFor({ state: 'visible', timeout: 25000 });
}

async function createProject(adminUser: StoredUser): Promise<BaselineProject> {
  const suffix = buildRandomSuffix();
  const projectName = `baseline-project-${suffix}`;
  const projectCode = `BL${suffix.toUpperCase()}`;
  const projectDescription = 'baseline project fixture';

  const page = testContext.activePage;

  await page.goto(`${config.dashboard.baseUrl}/${adminUser.workspaceId}/listProjects`, {
    waitUntil: 'domcontentloaded',
  });

  const projectsNav = page.locator("[data-testid='nav-list-projects']").first();
  if (await projectsNav.count()) {
    await projectsNav.click();
  }
  await page.waitForLoadState('networkidle');

  const newProjectTrigger = page.getByText('New', { exact: true }).first();
  // 60s: the first authenticated render on a cold Docker/CI start waits on zero-cache
  // sync + hydration and can exceed the default 30s.
  await newProjectTrigger.waitFor({ state: 'visible', timeout: 60000 });
  await newProjectTrigger.click();

  await page.locator("input[placeholder*='Enter project name']").first().fill(projectName);
  await page.locator("[data-testid='project-code-input']").first().fill(projectCode);
  await page
    .locator("textarea[placeholder*='Enter project description']")
    .first()
    .fill(projectDescription);

  // 60s timeout: this waiter is registered before the click and must cover
  // form submit + POST round-trip. Default 30s is too tight under heavy CI.
  const submitPromise = page.waitForResponse(
    (r) =>
      r.url().includes('/projects') &&
      (r.request().method() === 'POST' || r.request().method() === 'PUT'),
    { timeout: 60000 }
  );
  await page.getByRole('button', { name: 'Create Project' }).click();

  let projectId: string | undefined;
  try {
    const response = await submitPromise;
    const body = (await response.json().catch(() => null)) as { id?: string } | null;
    projectId = body?.id;
  } catch {
    baselineLogger.warn('Could not capture project creation response, will rely on URL parsing');
  }

  await page.locator("[data-testid='create-project-dialog']").waitFor({ state: 'hidden' });

  if (!projectId) {
    const projectLink = page.locator(`text=${projectName}`).first();
    try {
      await projectLink.waitFor({ state: 'visible', timeout: 5000 });
      const href = await projectLink.locator('..').getAttribute('href');
      if (href) {
        const match = href.match(/\/projects\/([^/]+)/);
        projectId = match?.[1];
      }
    } catch {
      // Project ID extraction failed, proceed without it
    }
  }

  const storedProject: StoredProject = {
    id: projectId,
    name: projectName,
    code: projectCode,
    description: projectDescription,
  };
  adminUser.projects[BASELINE_PROJECT_KEY] = storedProject;

  baselineLogger.info(`[3/5] Project created: ${projectName}`);

  return {
    id: projectId,
    name: projectName,
    code: projectCode,
    description: projectDescription,
  };
}

async function createChannel(adminUser: StoredUser): Promise<BaselineChannel> {
  const suffix = buildRandomSuffix();
  const channelName = `baseline-channel-${suffix}`;

  const page = testContext.activePage;

  await gotoChatViewUntilReady(
    `${config.dashboard.baseUrl}/${adminUser.workspaceId}/chat/dir`,
    "[data-testid='create-new-channel']"
  );
  await page.locator("[data-testid='create-new-channel']").first().click();
  await page.locator("[data-testid='add-channel-form']").first().waitFor({ state: 'visible' });

  await page.locator("[data-testid='channel-name-input']").first().fill(channelName);

  const baselineProject = adminUser.projects[BASELINE_PROJECT_KEY];
  const projectTrigger = page.locator("[data-testid='project-select-trigger']").first();
  const triggerShowsBaseline = projectTrigger.filter({ hasText: baselineProject.name });

  // EntitySelector toggles selection on re-click, and the form auto-selects the
  // first project on mount; opening the dropdown would clear that selection.
  const autoSelected = await triggerShowsBaseline
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  if (!autoSelected) {
    await projectTrigger.click();
    await page
      .locator(
        `[data-testid='project-select-trigger-options'] button:has-text("${baselineProject.name}")`
      )
      .first()
      .click();
    await triggerShowsBaseline.waitFor({ state: 'visible', timeout: 10000 });
  }

  const createButton = page.locator("[data-testid='create-channel-button']").first();
  await createButton.waitFor({ state: 'visible' });
  await page
    .locator("[data-testid='create-channel-button']:not([disabled])")
    .first()
    .waitFor({ state: 'visible', timeout: 10000 });

  // 60s timeout, same reasoning as the other baseline waiters: the clock
  // starts here and must cover the click + POST round-trip on slow CI.
  const createChannelResponse = page.waitForResponse(
    (response) => response.url().endsWith('/channels') && response.request().method() === 'POST',
    { timeout: 60000 }
  );

  await createButton.click();

  let response: Awaited<ReturnType<typeof page.waitForResponse>>;
  try {
    response = await createChannelResponse;
  } catch (waitError) {
    throw new Error(
      `Baseline channel creation: response never arrived. ` +
        `currentUrl=${page.url()}, original=${String(waitError)}`
    );
  }
  assert.equal(
    response.ok(),
    true,
    `Expected baseline channel creation request to succeed, got status ${response.status()}.`
  );

  const channelResponse = (await response
    .json()
    .catch(() => null)) as CreateChannelResponseBody | null;

  assert.ok(
    channelResponse,
    'Expected baseline channel creation response to contain channel data.'
  );
  assertString(channelResponse.id, 'baseline channel response id');

  await page.waitForURL(`**/chat/dir/${channelResponse.id}`);
  const channelInfoTrigger = page.locator("[data-testid='channel-info-trigger']").first();
  await channelInfoTrigger.waitFor({ state: 'visible' });

  try {
    const addPeopleInput = page.locator("[data-testid='user-search-input']").first();
    await addPeopleInput.waitFor({ state: 'visible', timeout: 5000 });
    await page.keyboard.press('Escape');
    await addPeopleInput.waitFor({ state: 'hidden', timeout: 5000 });
  } catch {
    // Add-members dialog may not appear; safe to continue
  }

  await channelInfoTrigger.waitFor({ state: 'visible' });

  const channelId = channelResponse.id;
  const channelUrl = `${config.dashboard.baseUrl}/${adminUser.workspaceId}/chat/dir/${channelResponse.id}`;

  const storedChannel: StoredConversation = {
    id: channelId,
    name: channelName,
    url: channelUrl,
    messages: {},
  };
  adminUser.channels[BASELINE_CHANNEL_KEY] = storedChannel;

  baselineLogger.info(`[4/5] Channel created: ${channelName}`);

  return { id: channelId, name: channelName, url: channelUrl };
}

async function sendSeedChannelMessage(channelId: string): Promise<BaselineSeedMessage> {
  const page = testContext.activePage;
  const baseText = 'baseline-channel-seed';
  const text = `${baseText}-${buildRandomSuffix()}`;

  const response = await page.request.post(`${config.dashboard.baseUrl}/api/zero/push-fallback`, {
    data: {
      name: 'conversations.send',
      args: {
        channelId,
        content: text,
        conversationId: randomUUID(),
        messageId: randomUUID(),
        timestamp: Date.now(),
        type: 'USER',
      },
    },
  });
  assert.equal(
    response.ok(),
    true,
    `Expected baseline seed message POST to succeed, got status ${response.status()}.`
  );

  baselineLogger.info('[6/8] Seed message sent in baseline channel');
  return { baseText, text };
}

async function createBaselineDmWithSeedMessage(
  ownerUser: StoredUser,
  partnerUser: StoredUser
): Promise<BaselineDm> {
  const page = testContext.activePage;
  const baseText = 'baseline-dm-seed';
  const text = `${baseText}-${buildRandomSuffix()}`;

  const response = await page.request.post(`${config.dashboard.baseUrl}/api/users/me/dms`, {
    data: {
      participantIds: [partnerUser.id],
      message: text,
    },
  });
  assert.equal(
    response.ok(),
    true,
    `Expected baseline DM creation POST to succeed, got status ${response.status()}.`
  );

  const body = (await response.json().catch(() => null)) as { id?: string } | null;
  const dmId = body?.id;
  assert.ok(
    typeof dmId === 'string' && dmId.length > 0,
    `Expected DM creation response to contain id, got: ${JSON.stringify(body)}`
  );

  const dmUrl = `${config.dashboard.baseUrl}/${ownerUser.workspaceId}/chat/dir/${dmId}`;

  baselineLogger.info('[8/8] Baseline DM created with seed message');

  return {
    id: dmId,
    name: partnerUser.name,
    url: dmUrl,
    ownerAlias: ownerUser.alias,
    partnerAlias: partnerUser.alias,
    seedMessage: { baseText, text },
  };
}

export async function bootstrapBaselineFixture(): Promise<void> {
  if (process.env.XYNE_SKIP_BASELINE_BOOTSTRAP === 'true') {
    baselineLogger.info('Baseline bootstrap skipped (XYNE_SKIP_BASELINE_BOOTSTRAP=true)');
    return;
  }

  writeBaselineContextSnapshot('before');
  const consoleErrors: string[] = [];
  try {
    await ensureBrowserSession(1280, 720, config.browser);
    testContext.activePage.on('pageerror', (e) =>
      consoleErrors.push(`PAGEERROR: ${String(e.stack ?? e.message ?? e).slice(0, 900)}`)
    );
    testContext.activePage.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(`console.error: ${m.text().slice(0, 300)}`);
    });
    const user = await loginAsUser(BASELINE_USER_ALIAS);
    baselineLogger.info(`[1/8] User created: ${user.alias}`);
    const partnerUser = await loginAsUser(BASELINE_SECONDARY_USER_ALIAS);
    baselineLogger.info(`[2/8] User created: ${partnerUser.alias}`);
    const adminUser = await loginAsUser(BASELINE_OWNER_ALIAS);
    baselineLogger.info(`[3/8] User created: ${adminUser.alias}`);
    const project = await createProject(adminUser);
    const channel = await createChannel(adminUser);
    assertString(channel.id, 'baseline channel id');
    await addMemberToChannel(adminUser, user);
    await addMemberToChannel(adminUser, partnerUser);
    const channelSeed = await sendSeedChannelMessage(channel.id);

    await loginAsUser(BASELINE_USER_ALIAS);
    baselineLogger.info('[7/8] Re-logged in as baseline user to create DM');
    assert.ok(channel.id, 'Expected baseline channel to have an id.');
    await ensureBaselineChannelMembership(channel.id, channel.name, [user, partnerUser]);
    const dm = await createBaselineDmWithSeedMessage(user, partnerUser);

    const runId = process.env.XYNE_RUN_ID ?? 'unknown-run';
    await writeBaselineFixtureRegistry({
      runId,
      ownerUserAlias: BASELINE_OWNER_ALIAS,
      project,
      channel: { ...channel, seedMessage: channelSeed },
      dm,
    });
    testContext.storedUsers.set(BASELINE_OWNER_ALIAS, adminUser);
    testContext.storedUsers.set(BASELINE_USER_ALIAS, user);
    testContext.storedUsers.set(BASELINE_SECONDARY_USER_ALIAS, partnerUser);
    writeBaselineContextSnapshot('after');
  } catch (bootstrapError) {
    // Capture app state at the failure point so bootstrap failures are diagnosable
    // from the copied reports instead of a bare stack.
    try {
      const artifactDir = process.env.XYNE_RUN_ARTIFACT_DIR;
      if (artifactDir) {
        const page = testContext.activePage;
        await page.screenshot({
          path: path.resolve(artifactDir, 'baseline-failure.png'),
          fullPage: true,
        });
        const body = await page.locator('body').innerText().catch(() => '');
        baselineLogger.error(
          `Baseline bootstrap failed at ${page.url()}. Body(0..300): ${body.slice(0, 300)}`
        );
        baselineLogger.error(
          `Page console/errors (last 12): ${consoleErrors.slice(-12).join(' || ')}`
        );
      }
    } catch (_snapErr) {
      // best-effort diagnostics only
    }
    throw bootstrapError;
  } finally {
    await resetAllBrowserSessionsForReuse();
    testContext.resetScenarioState();
  }
}

export async function loadBaselineFixtureIntoWorkerContext(): Promise<void> {
  if (process.env.XYNE_SKIP_BASELINE_BOOTSTRAP === 'true') {
    return;
  }

  let registry: BaselineFixtureData;
  try {
    registry = await loadBaselineFixtureRegistry();
  } catch (error) {
    baselineLogger.error('Failed to load baseline fixture registry', { error: String(error) });
    throw error;
  }

  const channelMessages: Record<string, StoredMessage> = registry.channel.seedMessage
    ? {
        [BASELINE_SEED_MESSAGE_KEY]: {
          alias: BASELINE_SEED_MESSAGE_KEY,
          baseText: registry.channel.seedMessage.baseText,
          text: registry.channel.seedMessage.text,
        },
      }
    : {};

  const ownerCatalog = getUserCatalogEntry(BASELINE_OWNER_ALIAS);
  const ownerUser: StoredUser = {
    alias: ownerCatalog.alias,
    role: ownerCatalog.role,
    id: '',
    email: ownerCatalog.email,
    name: ownerCatalog.alias,
    projects: {
      [BASELINE_PROJECT_KEY]: {
        id: registry.project.id,
        name: registry.project.name,
        code: registry.project.code,
        description: registry.project.description,
      },
    },
    channels: {
      [BASELINE_CHANNEL_KEY]: {
        id: registry.channel.id,
        name: registry.channel.name,
        url: registry.channel.url,
        messages: { ...channelMessages },
      },
    },
    dms: {},
    tickets: {},
  };

  testContext.registerPersistentStoredUser(ownerUser);

  const secondaryCatalog = getUserCatalogEntry(BASELINE_SECONDARY_USER_ALIAS);
  const secondaryUser: StoredUser = {
    alias: secondaryCatalog.alias,
    role: secondaryCatalog.role,
    id: '',
    email: secondaryCatalog.email,
    name: secondaryCatalog.alias,
    projects: {},
    channels: {
      [BASELINE_CHANNEL_KEY]: {
        id: registry.channel.id,
        name: registry.channel.name,
        url: registry.channel.url,
        messages: { ...channelMessages },
      },
    },
    dms: {},
    tickets: {},
  };
  testContext.registerPersistentStoredUser(secondaryUser);

  if (registry.dm && registry.dm.ownerAlias === BASELINE_USER_ALIAS) {
    const userCatalog = getUserCatalogEntry(BASELINE_USER_ALIAS);
    const dmMessages: Record<string, StoredMessage> = registry.dm.seedMessage
      ? {
          [BASELINE_SEED_MESSAGE_KEY]: {
            alias: BASELINE_SEED_MESSAGE_KEY,
            baseText: registry.dm.seedMessage.baseText,
            text: registry.dm.seedMessage.text,
          },
        }
      : {};

    const baselineUser: StoredUser = {
      alias: userCatalog.alias,
      role: userCatalog.role,
      id: '',
      email: userCatalog.email,
      name: userCatalog.alias,
      projects: {},
      channels: {
        [BASELINE_CHANNEL_KEY]: {
          id: registry.channel.id,
          name: registry.channel.name,
          url: registry.channel.url,
          messages: { ...channelMessages },
        },
      },
      dms: {
        [BASELINE_DM_KEY]: {
          id: registry.dm.id,
          name: registry.dm.name,
          url: registry.dm.url,
          messages: dmMessages,
        },
      },
      tickets: {},
    };

    testContext.registerPersistentStoredUser(baselineUser);
  }
}
