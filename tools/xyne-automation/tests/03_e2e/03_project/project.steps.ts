import assert from 'node:assert/strict';
import { Step } from 'gauge-ts';
import { config } from '@/config';
import {
  assertNetNewChannelAlias,
  isBaselineChannelKey,
  isBaselineProjectKey,
  loadBaselineFixtureRegistry,
} from '@/fixtures/baseline';
import { buildRandomSuffix, getStoredUser } from '@/fixtures/fixture-helpers';
import { getUserCatalogEntry } from '@/fixtures/user-catalog';
import { type StoredUser, testContext } from '@/tests/shared/runtime/test-context';
import {
  assertValidChannelAlias,
  assertValidProjectAlias,
  assertValidUserAlias,
} from '@/tests/shared/support/literal-validation';

interface AuthResponseUser {
  id?: unknown;
  email?: unknown;
  name?: unknown;
  profilePictureUrl?: unknown;
  workspaceId?: unknown;
}

function assertString(value: unknown, label: string): asserts value is string {
  assert.equal(typeof value, 'string', `Expected ${label} to be a string.`);
}

interface AuthResponseBody {
  user?: AuthResponseUser;
}

function buildSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

export default class ProjectSteps {
  // ===========================================
  // SETUP
  // ===========================================

  private async loginAndStoreUser(userAlias: string, setAsNewUser: boolean): Promise<void> {
    assertValidUserAlias(userAlias);

    const existingUser = testContext.storedUsers.get(userAlias);
    if (
      existingUser &&
      !setAsNewUser &&
      typeof existingUser.id === 'string' &&
      existingUser.id.length > 0
    ) {
      return;
    }

    const catalogUser = getUserCatalogEntry(userAlias);
    const params = new URLSearchParams({
      email: catalogUser.email,
      setAsNewUser: String(setAsNewUser),
    });

    const page = testContext.activePage;
    // Hit the test auth endpoint directly instead of clicking "Sign in with
    // Google": the dashboard only intercepts that button in test mode, so
    // against a plain dev server it redirects to real Google OAuth. The
    // session cookie lands in this browser context, same as the UI flow.
    const response = await page.request.post(
      `${config.dashboard.baseUrl}/api/test/auth/login?${params.toString()}`,
      { data: {}, timeout: 60000 }
    );
    assert.equal(
      response.ok(),
      true,
      `loginAndStoreUser('${userAlias}'): test login failed with status ${response.status()}.`
    );
    const body = (await response.json().catch(() => null)) as AuthResponseBody | null;
    const user = body?.user;

    assert.ok(user, 'Expected auth response to contain user data.');
    assertString(user.id, 'auth response user.id');
    assertString(user.email, 'auth response user.email');
    assertString(user.name, 'auth response user.name');

    // Land on a static same-origin file so storage can be seeded before the app mounts.
    await page.goto(`${config.dashboard.baseUrl}/version.json`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.evaluate(
      ({ userId, userEmail, skipOnboarding }) => {
        localStorage.setItem('user_id', userId);
        localStorage.setItem('user_email', userEmail);
        if (skipOnboarding) {
          // Existing-user scenarios intentionally skip AI onboarding so the
          // destination page never mounts the overlay.
          localStorage.setItem('xyne-ai-onboarding-completed', 'true');
          localStorage.removeItem('xyne-ai-onboarding-active');
          sessionStorage.removeItem('xyne-ai-onboarding-pending');
        }
      },
      { userId: user.id, userEmail: user.email, skipOnboarding: !setAsNewUser }
    );
    await page.goto(`${config.dashboard.baseUrl}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    const previous = testContext.storedUsers.get(userAlias);
    const storedUser: StoredUser = {
      alias: catalogUser.alias,
      role: catalogUser.role,
      id: user.id,
      email: user.email,
      name: user.name || catalogUser.alias,
      workspaceId: typeof user.workspaceId === 'string' ? user.workspaceId : undefined,
      profilePictureUrl:
        typeof user.profilePictureUrl === 'string' ? user.profilePictureUrl : undefined,
      projects: previous?.projects ?? {},
      channels: previous?.channels ?? {},
      dms: previous?.dms ?? {},
      tickets: previous?.tickets ?? {},
      userGroups: previous?.userGroups ?? {},
    };

    testContext.storedUsers.set(userAlias, storedUser);
  }

  private buildNetNewChannelFixture(userAlias: string, channelAlias: string): void {
    assertValidUserAlias(userAlias);
    assertNetNewChannelAlias(channelAlias);

    const user = getStoredUser(userAlias);

    if (user.channels[channelAlias]) {
      return;
    }

    const userSlug = buildSlug(user.name || user.email || user.id || 'user');
    const suffix = buildRandomSuffix();
    const channelName = `${userSlug}-channel-${suffix}`;

    user.channels[channelAlias] = { name: channelName, messages: {} };
  }

  @Step('logging in as user <userAlias>')
  public async loginUserWithExistingAccount(userAlias: string): Promise<void> {
    assertValidUserAlias(userAlias);

    await this.loginAndStoreUser(userAlias, false);
  }

  @Step('logging in as user <userAlias> as a new user')
  public async loginUserAsNewAccount(userAlias: string): Promise<void> {
    assertValidUserAlias(userAlias);

    await this.loginAndStoreUser(userAlias, true);
  }

  @Step('ensuring project <projectAlias> exists in fixture for user <userAlias>')
  public async ensureProjectExistsInFixture(
    projectAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidProjectAlias(projectAlias);
    assertValidUserAlias(userAlias);

    getUserCatalogEntry(userAlias);
    const user = getStoredUser(userAlias);

    if (user.projects[projectAlias]) {
      return;
    }

    if (isBaselineProjectKey(projectAlias)) {
      const registry = await loadBaselineFixtureRegistry();
      user.projects[projectAlias] = {
        id: registry.project.id,
        name: registry.project.name,
        code: registry.project.code,
        description: registry.project.description,
      };
      return;
    }

    throw new Error(
      `Project "${projectAlias}" is not stored and is not a baseline key. Use the create flow for net-new projects.`
    );
  }

  @Step('generating net-new project details <projectAlias> for user <userAlias>')
  public async generateNetNewProjectDetails(
    projectAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidProjectAlias(projectAlias);
    assertValidUserAlias(userAlias);

    const user = getStoredUser(userAlias);

    if (user.projects[projectAlias]) {
      return;
    }

    const userSlug = buildSlug(user.name || user.email || user.id || 'user');
    const suffix = buildRandomSuffix();
    const projectName = `${userSlug}-project-${suffix}`;
    const projectCode = `PR${suffix.toUpperCase()}`;
    const projectDescription = `project-${suffix}`;

    user.projects[projectAlias] = {
      name: projectName,
      code: projectCode,
      description: projectDescription,
    };
  }

  @Step('ensuring channel <channelAlias> exists in fixture for user <userAlias>')
  public async ensureChannelExistsInFixture(
    channelAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    getUserCatalogEntry(userAlias);

    const user = getStoredUser(userAlias);

    if (user.channels[channelAlias]) {
      return;
    }

    if (isBaselineChannelKey(channelAlias)) {
      const registry = await loadBaselineFixtureRegistry();
      user.channels[channelAlias] = {
        id: registry.channel.id,
        name: registry.channel.name,
        url: registry.channel.url,
        messages: {},
      };
      return;
    }

    throw new Error(
      `Channel "${channelAlias}" is not stored and is not a baseline key. Use the create flow for net-new channels.`
    );
  }

  @Step('generating net-new channel details <channelAlias> for user <userAlias>')
  public async generateNetNewChannelDetails(
    channelAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    this.buildNetNewChannelFixture(userAlias, channelAlias);
  }

  @Step('capturing created channel details for user <userAlias> channel <channelAlias>')
  public async waitForChannelCreationComplete(
    userAlias: string,
    channelAlias: string
  ): Promise<void> {
    assertValidUserAlias(userAlias);
    assertValidChannelAlias(channelAlias);

    const user = getStoredUser(userAlias);
    const storedChannel = user.channels[channelAlias];
    assert.ok(storedChannel, `Expected stored channel for alias "${channelAlias}".`);

    const page = testContext.activePage;
    const url = page.url();
    const match = url.match(/\/chat\/dir\/([^/?]+)/);
    assert.ok(match, `Expected URL to contain channel ID after creation. URL: ${url}`);

    storedChannel.id = match[1];
    storedChannel.url = page.url();
  }

  @Step('clicking on stored channel <channelAlias> name for user <userAlias>')
  public async clickStoredChannelName(channelAlias: string, userAlias: string): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);

    const user = getStoredUser(userAlias);
    const channel = user.channels[channelAlias];
    assert.ok(channel, `Expected stored channel "${channelAlias}" for user "${userAlias}".`);
    assert.ok(channel.name, `Expected stored channel "${channelAlias}" to have a name.`);

    const page = testContext.activePage;
    await page.getByText(channel.name, { exact: false }).first().click();
  }

  @Step('selecting stored project <projectAlias> for user <userAlias> in dropdown')
  public async selectStoredProjectInDropdown(
    projectAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidProjectAlias(projectAlias);
    assertValidUserAlias(userAlias);

    const user = getStoredUser(userAlias);
    const project = user.projects[projectAlias];
    assert.ok(project, `Expected stored project "${projectAlias}" for user "${userAlias}".`);
    assert.ok(project.name, `Expected stored project "${projectAlias}" to have a name.`);

    const page = testContext.activePage;
    const listbox = page.locator('[role="listbox"]').first();
    await listbox.waitFor({ state: 'visible' });

    // The form auto-selects the first project, and clicking an already
    // selected option toggles it off. If the target project is already shown
    // on the trigger, close the dropdown instead of re-clicking the option.
    const triggerLabel =
      (await page.locator("[data-testid='project-select-trigger']").first().textContent()) ?? '';
    if (triggerLabel.includes(project.name)) {
      await page.keyboard.press('Escape');
      await listbox.waitFor({ state: 'hidden' });
      return;
    }

    await listbox.getByText(project.name, { exact: false }).first().click();
  }
}
