import { describe, expect, it } from 'vitest';
import { ChannelScopeType, NotificationLevel } from '@xyne/shared';
import { chunk, selectChannelIdsToMarkRead } from './ChatDirectory.utils';

type Channel = Parameters<typeof selectChannelIdsToMarkRead>[0][number];

const channel = (
  id: string,
  lastActivityAt: number,
  scopeType = ChannelScopeType.DEFAULT,
): Channel => ({ id, scopeType, channelStats: { lastActivityAt } }) as unknown as Channel;

describe('selectChannelIdsToMarkRead', () => {
  const statuses = new Map([
    ['badge', { lastViewedAt: 100, desktopNotificationLevel: null }],
    ['bold', { lastViewedAt: 100, desktopNotificationLevel: null }],
    ['read', { lastViewedAt: 500, desktopNotificationLevel: null }],
    ['muted-bold', { lastViewedAt: 100, desktopNotificationLevel: NotificationLevel.NONE }],
    ['muted-badge', { lastViewedAt: 100, desktopNotificationLevel: NotificationLevel.NONE }],
    ['dm', { lastViewedAt: 100, desktopNotificationLevel: null }],
  ]) as Parameters<typeof selectChannelIdsToMarkRead>[2];

  it('picks channels with a badge and channels that are only bold', () => {
    const ids = selectChannelIdsToMarkRead(
      [channel('badge', 50), channel('bold', 200), channel('read', 200)],
      { badge: 3 },
      statuses,
    );
    expect(ids).toEqual(['badge', 'bold']);
  });

  it('includes muted channels only when they carry an unread badge', () => {
    const ids = selectChannelIdsToMarkRead(
      [channel('muted-bold', 200), channel('muted-badge', 200)],
      { 'muted-badge': 1 },
      statuses,
    );
    expect(ids).toEqual(['muted-badge']);
  });

  it('treats a DM as unread only by its count', () => {
    expect(
      selectChannelIdsToMarkRead([channel('dm', 200, ChannelScopeType.DM)], {}, statuses),
    ).toEqual([]);
    expect(
      selectChannelIdsToMarkRead([channel('dm', 200, ChannelScopeType.DM)], { dm: 2 }, statuses),
    ).toEqual(['dm']);
  });

  it('returns nothing for a fully read section', () => {
    expect(selectChannelIdsToMarkRead([channel('read', 200)], {}, statuses)).toEqual([]);
  });
});

describe('chunk', () => {
  it('splits into chunks of at most the given size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(
      chunk(
        Array.from({ length: 60 }, (_, i) => i),
        25,
      ).map(c => c.length),
    ).toEqual([25, 25, 10]);
  });

  it('returns no chunks for an empty list', () => {
    expect(chunk([], 25)).toEqual([]);
  });

  it('rejects a non-positive size', () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});
