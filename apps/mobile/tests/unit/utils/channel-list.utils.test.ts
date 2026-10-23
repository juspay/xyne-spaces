import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ChannelListChannelRow } from '@/src/types/channel-list';
import {
  SEARCH_HIGHLIGHT_CLASS,
  CHANNEL_FILTER_TABS,
  formatUnreadLabel,
  hasNewActivity,
  sortChannelRowsByUnread,
  partitionChannelListRows,
} from '@/src/components/chat/channel-list/channel-list.utils';

type RowOpts = {
  unreadCount?: number;
  lastViewedAt?: number;
  lastActivityAt?: number;
};

function mkRow(id: string, opts: RowOpts = {}): ChannelListChannelRow {
  const data: ChannelListChannelRow['data'] = {
    id,
    name: id,
    visibility: 'public' as ChannelListChannelRow['data']['visibility'],
    unreadCount: opts.unreadCount ?? 0,
  };
  if (opts.lastViewedAt !== undefined) data.lastViewedAt = opts.lastViewedAt;
  if (opts.lastActivityAt !== undefined) data.lastActivityAt = opts.lastActivityAt;
  return { kind: 'channel', id, data };
}

const ids = (rows: readonly ChannelListChannelRow[]): string[] => rows.map(r => r.id);

describe('channel-list constants', () => {
  it('exposes the shared search highlight class', () => {
    assert.equal(SEARCH_HIGHLIGHT_CLASS, 'bg-yellow-300 text-yellow-950');
  });

  it('lists the filter tabs in display order', () => {
    assert.deepEqual([...CHANNEL_FILTER_TABS], ['all', 'mentions', 'starred']);
  });

  it('re-exports formatCountLabel as formatUnreadLabel', () => {
    assert.equal(formatUnreadLabel(5), '5');
    assert.equal(formatUnreadLabel(150), '99+');
  });
});

describe('hasNewActivity', () => {
  it('is true whenever there is an unread count', () => {
    assert.equal(hasNewActivity(1, undefined, undefined), true);
    assert.equal(hasNewActivity(3, 100, 50), true);
  });

  it('is true when activity happened after the last view', () => {
    assert.equal(hasNewActivity(0, 100, 200), true);
  });

  it('is false when activity is at or before the last view', () => {
    assert.equal(hasNewActivity(0, 200, 200), false);
    assert.equal(hasNewActivity(0, 200, 100), false);
  });

  it('is false when timestamps are missing and nothing is unread', () => {
    assert.equal(hasNewActivity(0, undefined, undefined), false);
    assert.equal(hasNewActivity(0, undefined, 500), false);
    assert.equal(hasNewActivity(0, 500, undefined), false);
  });

  it('treats a zero activity timestamp as no activity', () => {
    // lastActivityAt of 0 is falsy, so it cannot count as "newer".
    assert.equal(hasNewActivity(0, 0, 0), false);
  });
});

describe('sortChannelRowsByUnread', () => {
  it('lifts unread rows above read rows while preserving relative order', () => {
    const rows = [
      mkRow('read-1'),
      mkRow('unread-1', { unreadCount: 2 }),
      mkRow('read-2'),
      mkRow('unread-2', { unreadCount: 1 }),
    ];
    assert.deepEqual(ids(sortChannelRowsByUnread(rows)), [
      'unread-1',
      'unread-2',
      'read-1',
      'read-2',
    ]);
  });

  it('returns a new array and leaves the input untouched', () => {
    const rows = [mkRow('a', { unreadCount: 1 }), mkRow('b')];
    const result = sortChannelRowsByUnread(rows);
    assert.notEqual(result, rows);
    assert.deepEqual(ids(rows), ['a', 'b']);
  });

  it('handles an empty input', () => {
    assert.deepEqual(sortChannelRowsByUnread([]), []);
  });
});

describe('partitionChannelListRows', () => {
  it('keeps a starred channel under Starred when it is also unread', () => {
    // The regression this function was rewritten for: the Starred pill used to
    // subtract every unread row, leaving only starred channels with no
    // activity — the least useful half of the list.
    const starred = [mkRow('S-read'), mkRow('S-unread', { unreadCount: 3 })];

    const sections = partitionChannelListRows(starred, [], new Set());

    assert.deepEqual(ids(sections.starred), ['S-read', 'S-unread']);
  });

  it('keeps a starred channel under Starred when it is also mentioned', () => {
    const starred = [mkRow('S-mentioned', { unreadCount: 1 })];

    const sections = partitionChannelListRows(starred, [], new Set(['S-mentioned']));

    assert.deepEqual(ids(sections.starred), ['S-mentioned']);
    assert.deepEqual(ids(sections.mentions), ['S-mentioned']);
  });

  it('lists unstarred channels under Mentions without adding them to Starred', () => {
    const channels = [mkRow('C1', { unreadCount: 1 }), mkRow('C2', { unreadCount: 1 })];

    const sections = partitionChannelListRows([], channels, new Set(['C1']));

    assert.deepEqual(ids(sections.mentions), ['C1']);
    assert.deepEqual(ids(sections.starred), []);
  });

  it('leaves a mentioned channel out of Mentions once it has been read', () => {
    const channels = [mkRow('C-read')];

    const sections = partitionChannelListRows([], channels, new Set(['C-read']));

    assert.deepEqual(ids(sections.mentions), []);
  });

  it('treats activity newer than the last view as unread for Mentions', () => {
    const channels = [mkRow('C1', { lastViewedAt: 10, lastActivityAt: 20 })];

    const sections = partitionChannelListRows([], channels, new Set(['C1']));

    assert.deepEqual(ids(sections.mentions), ['C1']);
  });

  it('preserves the order the caller sorted Starred into', () => {
    const starred = [mkRow('first', { unreadCount: 2 }), mkRow('second')];

    const sections = partitionChannelListRows(starred, [], new Set());

    assert.deepEqual(ids(sections.starred), ['first', 'second']);
  });

  it('returns empty buckets for empty inputs', () => {
    const sections = partitionChannelListRows([], [], new Set());
    assert.deepEqual(sections, {
      mentions: [],
      starred: [],
    });
  });
});
