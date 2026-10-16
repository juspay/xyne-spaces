import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { UserType } from '@xyne/shared';

import {
  getActorFilterKey,
  isActorFilterActive,
} from '@/src/features/activity/domain/activityActorFilter';
import {
  actorFilterFrom,
  countActiveFilters,
  DEFAULT_ACTIVITY_PREFERENCES,
} from '@/src/features/activity/model/preferences';

const prefs = (overrides: Partial<typeof DEFAULT_ACTIVITY_PREFERENCES>) => ({
  ...DEFAULT_ACTIVITY_PREFERENCES,
  ...overrides,
});

describe('actor filter', () => {
  it('is empty for everyone', () => {
    const filter = actorFilterFrom(DEFAULT_ACTIVITY_PREFERENCES);
    assert.equal(isActorFilterActive(filter), false);
    assert.equal(getActorFilterKey(filter), '');
  });

  it('maps User onto people only', () => {
    const filter = actorFilterFrom(prefs({ actorKind: 'user' }));
    assert.deepEqual(filter.types, [UserType.USER]);
    assert.equal(filter.id, undefined);
  });

  it('maps Agent onto every automated kind, as the dashboard does', () => {
    const filter = actorFilterFrom(prefs({ actorKind: 'agent' }));
    assert.deepEqual(filter.types, [UserType.BOT, UserType.APP, UserType.AGENT]);
  });

  it('carries the chosen person', () => {
    const filter = actorFilterFrom(prefs({ actorKind: 'agent', actorUserId: 'a1' }));
    assert.equal(filter.id, 'a1');
    assert.notEqual(
      getActorFilterKey(filter),
      getActorFilterKey(actorFilterFrom(prefs({ actorKind: 'agent' }))),
    );
  });
});

describe('countActiveFilters', () => {
  it('counts the controls that differ from their defaults', () => {
    assert.equal(countActiveFilters(DEFAULT_ACTIVITY_PREFERENCES), 0);
    assert.equal(
      countActiveFilters(prefs({ unreadOnly: true, actorKind: 'user', actionable: true })),
      3,
    );
  });

  it('does not count the view mode, which changes how rows look, not which', () => {
    assert.equal(countActiveFilters(prefs({ viewMode: 'condensed' })), 0);
  });
});
