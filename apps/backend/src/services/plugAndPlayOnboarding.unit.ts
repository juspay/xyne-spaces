import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCompletePlugAndPlayPayload,
  mergePlugAndPlayPayload,
  PLUG_AND_PLAY_ONBOARDING_TYPE,
  sanitizePlugAndPlayPayload,
} from './plugAndPlayOnboarding.ts';

describe('plug-and-play onboarding persist', () => {
  it('uses a dedicated questionnaire type', () => {
    assert.equal(PLUG_AND_PLAY_ONBOARDING_TYPE, 'plug-and-play-onboarding');
  });

  it('merges later taps without wiping earlier keys', () => {
    const merged = mergePlugAndPlayPayload(
      { onboardingRole: 'role_builder' },
      { onboardingDomain: 'domain_software' }
    );
    assert.deepEqual(merged, {
      onboardingRole: 'role_builder',
      onboardingDomain: 'domain_software',
    });
  });

  it('allows replay after complete so /onboarding stays reusable', () => {
    const completed = {
      onboardingRole: 'role_ops',
      onboardingDomain: 'domain_finance',
      onboardingTryFirst: 'try_recap',
      onboardingPrototypeConnectKeys: ['slack'],
      onboardingCompletedAt: '2026-09-02T00:00:00.000Z',
    };
    assert.deepEqual(
      mergePlugAndPlayPayload(completed, {
        onboardingRole: 'role_other',
        onboardingPrototypeConnectKeys: ['teams'],
        onboardingCompletedAt: '2026-09-10T00:00:00.000Z',
      }),
      {
        ...completed,
        onboardingRole: 'role_other',
        onboardingPrototypeConnectKeys: ['teams'],
        onboardingCompletedAt: '2026-09-10T00:00:00.000Z',
      }
    );
  });

  it('drops unknown connector keys and does not invent OAuth fields', () => {
    const sanitized = sanitizePlugAndPlayPayload({
      onboardingPrototypeConnectKeys: ['slack', 'jira', 'teams'],
      oauthUrl: 'https://slack.com/oauth',
    });
    assert.deepEqual(sanitized.onboardingPrototypeConnectKeys, ['slack', 'teams']);
    assert.equal('oauthUrl' in sanitized, false);
  });

  it('rejects complete when intake keys are missing', () => {
    const error = assertCompletePlugAndPlayPayload({
      onboardingCompletedAt: '2026-09-02T00:00:00.000Z',
    });
    assert.equal(typeof error, 'string');
  });

  it('allows complete with skip (empty connect keys)', () => {
    assert.equal(
      assertCompletePlugAndPlayPayload({
        onboardingRole: 'role_lead',
        onboardingDomain: 'domain_healthcare',
        onboardingTryFirst: 'try_chat',
        onboardingPrototypeConnectKeys: [],
        onboardingCompletedAt: '2026-09-02T00:00:00.000Z',
      }),
      null
    );
  });
});
