import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ActivityClassification } from '@xyne/shared';

import type { ActivityLike } from '@/src/features/activity/domain/activityTypes';
import {
  getUnreadActivityCounts,
  getUnreadActivitySignature,
  getUnreadChannelActivityCounts,
  hasVisibleActivities,
  isUnreadChannelActivity,
  selectActivitiesForWorkspace,
  selectActivityBadgeCount,
  selectVisibleActivities,
} from '@/src/features/activity/domain/activitySelectors';

const activity = (over: Partial<ActivityLike>): ActivityLike => ({
  id: 'a',
  workspaceId: 'W',
  isRead: false,
  classification: ActivityClassification.PENDING,
  ...over,
});

// A row with no id at all (distinct from id: undefined under exactOptionalPropertyTypes).
const noIdActivity = (over: Partial<ActivityLike>): ActivityLike => ({
  workspaceId: 'W',
  isRead: false,
  classification: ActivityClassification.PENDING,
  ...over,
});

describe('selectActivitiesForWorkspace', () => {
  it('returns nothing when no workspace id is supplied', () => {
    assert.deepEqual(selectActivitiesForWorkspace([activity({ id: '1' })], ''), []);
  });

  it('drops null/undefined entries and mismatched workspaces, keeps null-workspace rows', () => {
    const scoped = activity({ id: '1', workspaceId: 'W' });
    const global = activity({ id: '2', workspaceId: null });
    const other = activity({ id: '3', workspaceId: 'OTHER' });
    const result = selectActivitiesForWorkspace([scoped, null, undefined, global, other], 'W');
    assert.deepEqual(
      result.map(a => a.id),
      ['1', '2'],
    );
  });
});

describe('selectVisibleActivities', () => {
  const rows = [
    activity({ id: '1', actorAction: 'mentioned_user', isRead: false }),
    activity({ id: '2', actorAction: 'mentioned_user', isRead: true }),
    noIdActivity({ actorAction: 'mentioned_user', isRead: false }),
  ];

  it('requires an id and matches the active tab', () => {
    const visible = selectVisibleActivities(rows, 'your_mentions', false);
    assert.deepEqual(
      visible.map(a => a.id),
      ['1', '2'],
    );
  });

  it('honours the unread-only filter', () => {
    const visible = selectVisibleActivities(rows, 'your_mentions', true);
    assert.deepEqual(
      visible.map(a => a.id),
      ['1'],
    );
  });

  it('powers hasVisibleActivities', () => {
    assert.equal(hasVisibleActivities(rows, 'your_mentions', true), true);
    assert.equal(hasVisibleActivities(rows, 'replies', false), false);
  });
});

describe('getUnreadActivityCounts', () => {
  it('returns a fresh zeroed count object for empty input', () => {
    const counts = getUnreadActivityCounts([]);
    assert.equal(counts.all, 0);
    assert.equal(counts.your_mentions, 0);
    assert.equal(counts.tickets, 0);
  });

  it('tallies unread activities across every tab and ignores read rows', () => {
    const rows: ActivityLike[] = [
      activity({ id: '1', actorAction: 'mentioned_user' }),
      activity({ id: '2', actorAction: 'replied' }),
      activity({ id: '3', actorAction: 'added' }),
      activity({ id: '4', ticketId: 't1', classification: ActivityClassification.ACTIONABLE }),
      activity({ id: '5', actorAction: 'group_mention' }),
      activity({
        id: '6',
        actorAction: 'direct_message',
        classification: ActivityClassification.FYI,
      }),
      activity({ id: '7', actorAction: 'mentioned_user', isRead: true }),
    ];
    const counts = getUnreadActivityCounts(rows);
    assert.equal(counts.all, 6);
    assert.equal(counts.your_mentions, 1);
    assert.equal(counts.replies, 1);
    assert.equal(counts.reactions, 1);
    assert.equal(counts.tickets, 1);
    assert.equal(counts.actionable, 1);
    assert.equal(counts.fyi, 1);
    assert.equal(counts.group_mentions, 1);
  });

  it('exposes the all count as the badge count', () => {
    const rows = [
      activity({ id: '1', actorAction: 'replied' }),
      activity({ id: '2', actorAction: 'added' }),
    ];
    assert.equal(selectActivityBadgeCount(rows), getUnreadActivityCounts(rows).all);
    assert.equal(selectActivityBadgeCount(rows), 2);
  });
});

describe('getUnreadActivitySignature', () => {
  it('is order-independent and changes when a fingerprinted field changes', () => {
    const a = activity({ id: '1', updatedAt: 10, actorAction: 'replied' });
    const b = activity({ id: '2', updatedAt: 20, actorAction: 'added' });
    assert.equal(getUnreadActivitySignature([a, b]), getUnreadActivitySignature([b, a]));

    const changed = getUnreadActivitySignature([activity({ id: '1', isRead: true }), b]);
    assert.notEqual(getUnreadActivitySignature([a, b]), changed);
  });

  it('ignores rows without an id', () => {
    assert.equal(getUnreadActivitySignature([noIdActivity({ actorAction: 'replied' })]), '');
  });
});

describe('isUnreadChannelActivity', () => {
  it('treats a fresh unread channel activity as unread', () => {
    const a = activity({ channelId: 'c1', createdAt: 100, isRead: false });
    assert.equal(isUnreadChannelActivity(a, 50), true);
    assert.equal(isUnreadChannelActivity(a, 150), false);
  });

  it('excludes membership, missed-call, thread, read and skipped activities', () => {
    assert.equal(isUnreadChannelActivity(activity({ channelId: 'c1', isRead: true }), 0), false);
    assert.equal(
      isUnreadChannelActivity(activity({ channelId: 'c1', isThreadActivity: true }), 0),
      false,
    );
    assert.equal(
      isUnreadChannelActivity(activity({ channelId: 'c1', actorAction: 'added_v2' }), 0),
      false,
    );
    assert.equal(
      isUnreadChannelActivity(
        activity({ channelId: 'c1', actionSource: 'call', actorAction: 'missed_call' }),
        0,
      ),
      false,
    );
    assert.equal(
      isUnreadChannelActivity(
        activity({ channelId: 'c1', classification: ActivityClassification.SKIP }),
        0,
      ),
      false,
    );
    assert.equal(isUnreadChannelActivity(activity({ channelId: null }), 0), false);
  });
});

describe('getUnreadChannelActivityCounts', () => {
  it('counts unread activities per channel relative to last viewed time', () => {
    const rows = [
      activity({ id: '1', channelId: 'c1', createdAt: 100 }),
      activity({ id: '2', channelId: 'c1', createdAt: 40 }),
      activity({ id: '3', channelId: 'c2', createdAt: 100 }),
      activity({ id: '4', channelId: 'c1', createdAt: 100, isThreadActivity: true }),
    ];
    const readState = new Map([['c1', { lastViewedAt: 50 }]]);
    const counts = getUnreadChannelActivityCounts(rows, readState);
    assert.equal(counts.get('c1'), 1);
    assert.equal(counts.get('c2'), 1);
  });
});
