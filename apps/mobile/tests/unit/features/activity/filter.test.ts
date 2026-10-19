import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  filterCountsFrom,
  isFilterVisible,
  visibleActivityFilters,
} from '@/src/features/activity/model/filter';
import { EMPTY_ACTIVITY_COUNTS } from '@/src/features/activity/domain/activityTypes';

const ids = (actionable: boolean): string[] =>
  visibleActivityFilters(actionable).map(option => option.id);

describe('activity filters', () => {
  it('shows All and the standard tabs by default', () => {
    assert.deepEqual(ids(false), [
      'all',
      'your_mentions',
      'replies',
      'reactions',
      'tickets',
      'group_mentions',
    ]);
  });

  it('swaps to All, Actionable and FYI when actionable is on', () => {
    assert.deepEqual(ids(true), ['all', 'actionable', 'fyi']);
  });

  it('knows which chips belong to which set', () => {
    assert.equal(isFilterVisible('all', true), true);
    assert.equal(isFilterVisible('replies', true), false);
    assert.equal(isFilterVisible('fyi', false), false);
    assert.equal(isFilterVisible('fyi', true), true);
  });

  it('counts each chip from its own tab', () => {
    const counts = filterCountsFrom({
      ...EMPTY_ACTIVITY_COUNTS,
      all: 6,
      your_mentions: 2,
      replies: 1,
      actionable: 3,
    });
    assert.equal(counts.all, 6);
    assert.equal(counts.your_mentions, 2);
    assert.equal(counts.replies, 1);
    assert.equal(counts.actionable, 3);
    assert.equal(counts.tickets, 0);
  });
});
