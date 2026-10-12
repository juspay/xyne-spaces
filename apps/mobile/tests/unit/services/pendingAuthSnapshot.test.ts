import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PendingAuthState } from '@/src/contexts/AuthContext';
import { toOnboardingContext, type SignInSnapshot } from '@/src/features/onboarding/model/context';
import {
  PENDING_AUTH_TTL_MS,
  decodePendingAuth,
  encodePendingAuth,
  isRestorablePendingAuth,
} from '@/src/services/pendingAuthSnapshot';

const NOW = 1_800_000_000_000;

const orgCreation: PendingAuthState = {
  kind: 'org_creation_required',
  provider: 'google',
  profile: { email: 'sam@example.com', name: 'Sam', picture: 'https://example.com/p.png' },
};

const withExistingCompany: PendingAuthState = {
  kind: 'org_creation_required',
  provider: 'google',
  profile: { email: 'sam@acme.com', name: 'Sam' },
  enterpriseJoinTarget: { orgName: 'Acme', workspaces: [{ id: 'w1', name: 'Eng' }] },
};

const removed: PendingAuthState = { ...orgCreation, userExistsButRemoved: true };

const picking: PendingAuthState = {
  kind: 'workspace_selection_required',
  provider: 'google',
  profile: { email: 'sam@example.com', name: 'Sam' },
  workspaces: [],
};

describe('pending auth snapshot', () => {
  it('round-trips a state that the deck can pick up', () => {
    const stored = encodePendingAuth(withExistingCompany, NOW);
    assert.ok(stored);

    // Through JSON, because that is what the storage layer does to it.
    const decoded = decodePendingAuth(JSON.parse(JSON.stringify(stored)), NOW + 1_000);
    assert.deepEqual(decoded, withExistingCompany);
  });

  it('stores nothing for a state the deck does not apply to', () => {
    assert.equal(encodePendingAuth(picking, NOW), null);
    assert.equal(encodePendingAuth(removed, NOW), null);
    assert.equal(encodePendingAuth(null, NOW), null);
  });

  it('stops trusting a snapshot before the cookie it depends on expires', () => {
    const stored = encodePendingAuth(orgCreation, NOW);

    assert.ok(decodePendingAuth(stored, NOW + PENDING_AUTH_TTL_MS));
    assert.equal(decodePendingAuth(stored, NOW + PENDING_AUTH_TTL_MS + 1), null);
    // The cookie lives ten minutes; the snapshot must give out first.
    assert.ok(PENDING_AUTH_TTL_MS < 10 * 60_000);
  });

  it('rejects a snapshot dated in the future, beyond ordinary clock drift', () => {
    const stored = encodePendingAuth(orgCreation, NOW);

    assert.ok(decodePendingAuth(stored, NOW - 30_000));
    assert.equal(decodePendingAuth(stored, NOW - 10 * 60_000), null);
  });

  it('degrades to nothing rather than throwing on a bad record', () => {
    const good = encodePendingAuth(orgCreation, NOW);
    assert.ok(good);

    const bad: unknown[] = [
      null,
      undefined,
      'not json',
      42,
      [],
      {},
      { ...good, v: 2 },
      { ...good, savedAt: 'yesterday' },
      { ...good, savedAt: Number.NaN },
      { ...good, state: null },
      { ...good, state: { ...orgCreation, kind: 'workspace_selection_required' } },
      { ...good, state: { ...orgCreation, profile: { name: 'Sam' } } },
      { ...good, state: { ...orgCreation, profile: { email: '', name: 'Sam' } } },
      { ...good, state: { ...orgCreation, userExistsButRemoved: true } },
    ];

    for (const record of bad) {
      assert.equal(decodePendingAuth(record, NOW), null, JSON.stringify(record));
    }
  });
});

describe('restorable pending auth tracks the onboarding deck', () => {
  // `isRestorablePendingAuth` is a copy of the rule in `toOnboardingContext`, kept separate so
  // AuthContext does not depend on a feature. This is what stops the two drifting apart: if the
  // deck starts applying to a new kind of sign-in, restoring must follow it.
  const cases: [string, PendingAuthState][] = [
    ['org creation', orgCreation],
    ['org creation with an existing company', withExistingCompany],
    ['account removed from its workspaces', removed],
    ['workspace selection', picking],
  ];

  for (const [name, state] of cases) {
    it(`agrees for: ${name}`, () => {
      const deckApplies = toOnboardingContext(state as unknown as SignInSnapshot) !== null;
      assert.equal(isRestorablePendingAuth(state), deckApplies);
    });
  }
});
