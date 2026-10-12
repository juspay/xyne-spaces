/**
 * One case per row of the deck spec's scenario table, so the engine and the design stay in step.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// Imported from the model modules rather than the feature barrel: the barrel re-exports the
// screen, and the logic runner cannot load react-native.
import {
  CompanyChoice,
  StartChoice,
  type OnboardingAnswers,
} from '@/src/features/onboarding/model/answers';
import {
  toOnboardingContext,
  type OnboardingContext,
} from '@/src/features/onboarding/model/context';
import {
  CONNECT_TOOLS_ENABLED,
  buildFlow,
  canAdvance,
  resolveOutcome,
} from '@/src/features/onboarding/model/flow';

/**
 * The connect-tools card closes every deck while it is enabled and is absent while it is not.
 * Written as a tail rather than hardcoded so these scenarios stay about the *other* cards.
 */
const TOOLS: readonly string[] = CONNECT_TOOLS_ENABLED ? ['connect-tools'] : [];

const BASE: OnboardingContext = {
  email: 'devesh@acme.com',
  profileName: 'Devesh',
  existingCompany: null,
  publicEmailDomainError: null,
  isInvited: false,
};

const WITH_COMPANY: OnboardingContext = {
  ...BASE,
  existingCompany: { orgName: 'Acme', workspaces: [{ id: 'ws-1', name: 'Acme HQ' }] },
};

function flow(context: OnboardingContext, answers: OnboardingAnswers): string[] {
  return [...buildFlow(context, answers)];
}

describe('onboarding flow', () => {
  it('picks the Xyne community', () => {
    const answers: OnboardingAnswers = { start: StartChoice.COMMUNITY, role: 'Product Manager' };
    assert.deepEqual(flow(BASE, answers), ['start', 'role', ...TOOLS]);
    assert.deepEqual(resolveOutcome(BASE, answers), { kind: 'join-community' });
  });

  it('picks a workspace at a company new to Xyne', () => {
    const answers: OnboardingAnswers = {
      start: StartChoice.WORKSPACE,
      role: 'Product Manager',
      workspaceName: 'Acme',
      companyName: 'Acme Inc',
    };
    // Placement first, questions after — and company size only because an org is being created.
    assert.deepEqual(flow(BASE, answers), [
      'start',
      'workspace-setup',
      'role',
      'company-size',
      ...TOOLS,
    ]);
    assert.deepEqual(resolveOutcome(BASE, answers), {
      kind: 'create-org',
      orgName: 'Acme Inc',
      workspaceName: 'Acme',
    });
  });

  it('asks for access to a company already on Xyne, and asks nothing else', () => {
    const answers: OnboardingAnswers = {
      start: StartChoice.WORKSPACE,
      company: CompanyChoice.REQUEST_JOIN,
    };
    // The deck ends on the company card: the request waits for an admin and no session comes of
    // it, so the questions are held until the person is actually let in.
    assert.deepEqual(flow(WITH_COMPANY, answers), ['start', 'company-on-xyne', ...TOOLS]);
    assert.deepEqual(resolveOutcome(WITH_COMPANY, answers), {
      kind: 'request-enterprise-join',
      workspaceId: 'ws-1',
      orgName: 'Acme',
    });
  });

  it('does not ask a name of someone who is only asking for access', () => {
    const noName: OnboardingContext = { ...WITH_COMPANY, profileName: null };
    const answers: OnboardingAnswers = {
      start: StartChoice.WORKSPACE,
      company: CompanyChoice.REQUEST_JOIN,
    };
    assert.ok(!flow(noName, answers).includes('name'));
  });

  it('creates a separate workspace inside a company already on Xyne', () => {
    const answers: OnboardingAnswers = {
      start: StartChoice.WORKSPACE,
      company: CompanyChoice.CREATE_NEW,
      workspaceName: 'Acme Labs',
    };
    // Company size is the org creator's question; opening a second workspace in an existing org
    // is not that, so the deck stops at the role.
    assert.deepEqual(flow(WITH_COMPANY, answers), [
      'start',
      'company-on-xyne',
      'workspace-setup',
      'role',
      ...TOOLS,
    ]);
    assert.deepEqual(resolveOutcome(WITH_COMPANY, answers), {
      kind: 'create-enterprise-workspace',
      workspaceName: 'Acme Labs',
    });
  });

  it('picks a workspace, then skips it', () => {
    const answers: OnboardingAnswers = {
      start: StartChoice.WORKSPACE,
      workspaceName: '   ',
    };
    assert.deepEqual(resolveOutcome(BASE, answers), { kind: 'join-community' });
    // Skipped, so no org is created and the size question has no place.
    assert.ok(!flow(BASE, answers).includes('company-size'));
    // Blank is the skip, so the card never blocks the forward button.
    assert.equal(canAdvance('workspace-setup', BASE, answers), true);
  });

  it('asks for a name when no provider gave one', () => {
    const emailSignUp: OnboardingContext = { ...BASE, profileName: null };
    const answers: OnboardingAnswers = { start: StartChoice.COMMUNITY };
    assert.deepEqual(flow(emailSignUp, answers), ['start', 'name', 'role', ...TOOLS]);
    assert.equal(canAdvance('name', emailSignUp, answers), false);
    assert.equal(canAdvance('name', emailSignUp, { ...answers, name: 'Devesh' }), true);
  });

  it('drops the start card for someone already placed in a workspace', () => {
    const invited: OnboardingContext = { ...BASE, isInvited: true };
    // Also the shape an approved join request takes on its way in: questions only.
    assert.deepEqual(flow(invited, {}), ['role', ...TOOLS]);
    assert.deepEqual(resolveOutcome(invited, {}), { kind: 'nothing' });
  });

  it('shrinks the deck when the answer changes back to the community', () => {
    const workspace = flow(BASE, { start: StartChoice.WORKSPACE });
    const community = flow(BASE, { start: StartChoice.COMMUNITY });
    // One card fewer — the setup card — whatever the deck's other cards add up to.
    assert.equal(workspace.length, community.length + 1);
    assert.ok(workspace.includes('workspace-setup'));
    assert.ok(!community.includes('workspace-setup'));
  });

  it('falls back to the community when the company has no workspace to ask', () => {
    const noWorkspaces: OnboardingContext = {
      ...BASE,
      existingCompany: { orgName: 'Acme', workspaces: [] },
    };
    const answers: OnboardingAnswers = {
      start: StartChoice.WORKSPACE,
      company: CompanyChoice.REQUEST_JOIN,
    };
    assert.deepEqual(resolveOutcome(noWorkspaces, answers), { kind: 'join-community' });
    // Nothing was asked of an admin, so the person is about to be let in and is asked as usual.
    assert.ok(flow(noWorkspaces, answers).includes('role'));
  });

  it('treats the role as optional, as the dashboard does', () => {
    assert.equal(canAdvance('role', BASE, {}), true);
    assert.equal(canAdvance('role', BASE, { role: '  Designer ' }), true);
  });

  it('needs a company size picked before moving on', () => {
    assert.equal(canAdvance('company-size', BASE, {}), false);
    assert.equal(canAdvance('company-size', BASE, { companySize: '11-100' }), true);
  });
});

describe('personal email domains', () => {
  const signIn = (
    email: string,
    extra: Record<string, unknown> = {},
  ): ReturnType<typeof toOnboardingContext> =>
    toOnboardingContext({
      kind: 'org_creation_required',
      profile: { email, name: 'A' },
      ...extra,
    });

  it('blocks the workspace option for a personal address even when the backend sent nothing', () => {
    // Native mobile carries no enterprise-login intent, so this is the case that actually occurs.
    assert.equal(
      signIn('someone@gmail.com')?.publicEmailDomainError,
      'Public email domains (gmail.com) cannot create enterprise workspaces. Please use your work email.',
    );
    assert.ok(signIn('Someone@Outlook.com')?.publicEmailDomainError?.includes('outlook.com'));
  });

  it('leaves a work address alone', () => {
    assert.equal(signIn('devesh@juspay.in')?.publicEmailDomainError, null);
  });

  it('prefers the backend message when it sends one', () => {
    assert.equal(
      signIn('someone@gmail.com', { publicEmailDomainError: 'From the server' })
        ?.publicEmailDomainError,
      'From the server',
    );
  });
});

describe('onboarding context', () => {
  it('only onboards a sign-in that landed with no workspace', () => {
    assert.equal(toOnboardingContext(null), null);
    assert.equal(
      toOnboardingContext({
        kind: 'workspace_selection_required',
        profile: { email: 'a@b.com', name: 'A' },
      }),
      null,
    );
  });

  it('leaves a removed account to the login screen', () => {
    assert.equal(
      toOnboardingContext({
        kind: 'org_creation_required',
        profile: { email: 'a@b.com', name: 'A' },
        userExistsButRemoved: true,
      }),
      null,
    );
  });

  it('carries the company that already owns the domain', () => {
    const context = toOnboardingContext({
      kind: 'org_creation_required',
      profile: { email: 'devesh@acme.com', name: '  ' },
      enterpriseJoinTarget: { orgName: 'Acme', workspaces: [{ id: 'ws-1', name: 'Acme HQ' }] },
    });

    assert.equal(context?.existingCompany?.orgName, 'Acme');
    // A blank provider name is what puts the name card into the deck.
    assert.equal(context?.profileName, null);
  });
});
