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
import { buildFlow, canAdvance, resolveOutcome } from '@/src/features/onboarding/model/flow';

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
    const answers: OnboardingAnswers = { start: StartChoice.COMMUNITY, role: 'building' };
    assert.deepEqual(flow(BASE, answers), ['start', 'role', 'connect-tools']);
    assert.deepEqual(resolveOutcome(BASE, answers), { kind: 'join-community' });
  });

  it('picks a workspace at a company new to Xyne', () => {
    const answers: OnboardingAnswers = {
      start: StartChoice.WORKSPACE,
      role: 'leading',
      workspaceName: 'Acme',
      companyName: 'Acme Inc',
    };
    assert.deepEqual(flow(BASE, answers), ['start', 'role', 'workspace-setup', 'connect-tools']);
    assert.deepEqual(resolveOutcome(BASE, answers), {
      kind: 'create-org',
      orgName: 'Acme Inc',
      workspaceName: 'Acme',
    });
  });

  it('picks a workspace at a company already on Xyne', () => {
    const answers: OnboardingAnswers = {
      start: StartChoice.WORKSPACE,
      role: 'building',
      company: CompanyChoice.REQUEST_JOIN,
    };
    assert.deepEqual(flow(WITH_COMPANY, answers), [
      'start',
      'role',
      'company-on-xyne',
      'connect-tools',
    ]);
    assert.deepEqual(resolveOutcome(WITH_COMPANY, answers), {
      kind: 'request-enterprise-join',
      workspaceId: 'ws-1',
      orgName: 'Acme',
    });
  });

  it('creates a separate workspace inside a company already on Xyne', () => {
    const answers: OnboardingAnswers = {
      start: StartChoice.WORKSPACE,
      role: 'building',
      company: CompanyChoice.CREATE_NEW,
      workspaceName: 'Acme Labs',
    };
    assert.deepEqual(flow(WITH_COMPANY, answers), [
      'start',
      'role',
      'company-on-xyne',
      'workspace-setup',
      'connect-tools',
    ]);
    assert.deepEqual(resolveOutcome(WITH_COMPANY, answers), {
      kind: 'create-enterprise-workspace',
      workspaceName: 'Acme Labs',
    });
  });

  it('picks a workspace, then skips it', () => {
    const answers: OnboardingAnswers = {
      start: StartChoice.WORKSPACE,
      role: 'everything',
      workspaceName: '   ',
    };
    assert.deepEqual(resolveOutcome(BASE, answers), { kind: 'join-community' });
    // Blank is the skip, so the card never blocks the forward button.
    assert.equal(canAdvance('workspace-setup', BASE, answers), true);
  });

  it('asks for a name when no provider gave one', () => {
    const emailSignUp: OnboardingContext = { ...BASE, profileName: null };
    const answers: OnboardingAnswers = { start: StartChoice.COMMUNITY };
    assert.deepEqual(flow(emailSignUp, answers), ['start', 'name', 'role', 'connect-tools']);
    assert.equal(canAdvance('name', emailSignUp, answers), false);
    assert.equal(canAdvance('name', emailSignUp, { ...answers, name: 'Devesh' }), true);
  });

  it('drops the start card for an invited user', () => {
    const invited: OnboardingContext = { ...BASE, isInvited: true };
    assert.deepEqual(flow(invited, {}), ['role', 'connect-tools']);
    assert.deepEqual(resolveOutcome(invited, {}), { kind: 'nothing' });
  });

  it('shrinks the deck when the answer changes back to the community', () => {
    const workspace = flow(BASE, { start: StartChoice.WORKSPACE });
    const community = flow(BASE, { start: StartChoice.COMMUNITY });
    assert.equal(workspace.length, 4);
    assert.equal(community.length, 3);
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
