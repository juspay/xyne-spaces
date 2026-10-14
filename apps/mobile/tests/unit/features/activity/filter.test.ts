import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACTIVITY_FILTERS,
  filterCountsFrom,
  resolveActivityFilter,
} from '@/src/features/activity/model/filter';
import { EMPTY_ACTIVITY_COUNTS } from '@/src/features/activity/domain/activityTypes';

describe('activity filters', () => {
  it('maps Unread onto the All tab with the unread toggle on', () => {
    assert.equal(resolveActivityFilter('unread').tab, 'all');
    assert.equal(resolveActivityFilter('unread').unreadOnly, true);
    assert.equal(resolveActivityFilter('all').unreadOnly, false);
  });

  it('maps every other chip onto its own tab, never unread-only', () => {
    for (const option of ACTIVITY_FILTERS) {
      if (option.id === 'unread') continue;
      assert.equal(option.tab, option.id);
      assert.equal(option.unreadOnly, false);
    }
  });

  it('counts All and Unread from the same total', () => {
    const counts = filterCountsFrom({
      ...EMPTY_ACTIVITY_COUNTS,
      all: 6,
      your_mentions: 2,
      replies: 1,
    });
    assert.equal(counts.all, 6);
    assert.equal(counts.unread, 6);
    assert.equal(counts.your_mentions, 2);
    assert.equal(counts.replies, 1);
    assert.equal(counts.tickets, 0);
  });
});
