import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addPrototypeConnectKey,
  buildCompletePayload,
  canCompleteOnboarding,
  parseOnboardingPayload,
  PROTOTYPE_CONNECT_STARTS_OAUTH,
  PROTOTYPE_CONNECTORS,
  resolveResumeTap,
  wizardOpeningTap,
  tap4FooterAction,
  tryFirstLandingPath,
  ONBOARDING_TAP_COPY,
} from './onboardingFlow.ts';

describe('plug-and-play onboarding flow', () => {
  it('resumes the first missing tap', () => {
    assert.equal(resolveResumeTap({}), 1);
    assert.equal(resolveResumeTap({ onboardingRole: 'role_builder' }), 2);
    assert.equal(
      resolveResumeTap({ onboardingRole: 'role_builder', onboardingDomain: 'domain_software' }),
      3,
    );
    assert.equal(
      resolveResumeTap({
        onboardingRole: 'role_builder',
        onboardingDomain: 'domain_software',
        onboardingTryFirst: 'try_recap',
      }),
      4,
    );
    assert.equal(
      resolveResumeTap({
        onboardingRole: 'role_builder',
        onboardingDomain: 'domain_software',
        onboardingTryFirst: 'try_recap',
        onboardingCompletedAt: '2026-09-02T00:00:00.000Z',
      }),
      'complete',
    );
    assert.equal(
      wizardOpeningTap({
        onboardingRole: 'role_builder',
        onboardingDomain: 'domain_software',
        onboardingTryFirst: 'try_recap',
        onboardingCompletedAt: '2026-09-02T00:00:00.000Z',
      }),
      1,
    );
    assert.equal(wizardOpeningTap({ onboardingRole: 'role_builder' }), 2);
  });

  it('keeps stored keys when later taps are missing', () => {
    const payload = parseOnboardingPayload({
      onboardingRole: 'role_ops',
      onboardingDomain: 'domain_finance',
    });
    assert.equal(payload.onboardingRole, 'role_ops');
    assert.equal(payload.onboardingDomain, 'domain_finance');
    assert.equal(payload.onboardingTryFirst, undefined);
    assert.equal(resolveResumeTap(payload), 3);
  });

  it('skip completes with empty connect keys and lands on try-first', () => {
    const completed = buildCompletePayload(
      {
        onboardingRole: 'role_lead',
        onboardingDomain: 'domain_healthcare',
        onboardingTryFirst: 'try_chat',
      },
      [],
      '2026-09-02T00:00:00.000Z',
    );
    assert.deepEqual(completed.onboardingPrototypeConnectKeys, []);
    assert.equal(tap4FooterAction(0), 'skip');
    assert.equal(tryFirstLandingPath('ws_1', 'try_chat'), '/ws_1/chat/dir');
    assert.equal(canCompleteOnboarding(completed), true);
  });

  it('keeps Slack and Teams checked together', () => {
    const afterSlack = addPrototypeConnectKey([], 'slack');
    const afterTeams = addPrototypeConnectKey(afterSlack, 'teams');
    assert.deepEqual(afterTeams, ['slack', 'teams']);
    assert.equal(tap4FooterAction(afterTeams.length), 'continue');
  });

  it('ignores a second click on the same connector', () => {
    const once = addPrototypeConnectKey([], 'slack');
    const twice = addPrototypeConnectKey(once, 'slack');
    assert.deepEqual(twice, ['slack']);
  });

  it('does not start OAuth from prototype Connect', () => {
    assert.equal(PROTOTYPE_CONNECT_STARTS_OAUTH, false);
    assert.deepEqual(
      PROTOTYPE_CONNECTORS.map(connector => connector.key),
      ['slack', 'teams', 'whatsapp', 'discord', 'google_chat'],
    );
  });

  it('does not complete when intake keys are missing (persist-fail stay)', () => {
    assert.equal(canCompleteOnboarding({ onboardingRole: 'role_builder' }), false);
    const parsed = parseOnboardingPayload({
      onboardingRole: 'role_builder',
      onboardingCompletedAt: 'nope-this-is-ignored-without-full-intake-on-client',
    });
    assert.equal(
      parsed.onboardingCompletedAt,
      'nope-this-is-ignored-without-full-intake-on-client',
    );
    assert.equal(canCompleteOnboarding(parsed), false);
  });

  it('maps try-first keys to landing routes', () => {
    assert.equal(tryFirstLandingPath('abc', 'try_recap'), '/abc/chat/dir/recap');
    assert.equal(tryFirstLandingPath('abc', 'try_support'), '/abc/support');
    assert.equal(tryFirstLandingPath('abc', 'try_search'), '/abc/search');
    assert.equal(tryFirstLandingPath('abc', 'try_ai'), '/abc/ai');
  });

  it('keeps wizard copy on four taps', () => {
    assert.equal(ONBOARDING_TAP_COPY[1].title, 'What do you do here?');
    assert.equal(ONBOARDING_TAP_COPY[4].title, 'See Spaces with the tools you already live in.');
  });
});
