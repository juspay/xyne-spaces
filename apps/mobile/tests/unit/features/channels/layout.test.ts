import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ChannelFilterMode, ChannelSortOrder } from '@xyne/shared';

import { ACTIVE_WINDOW_MS } from '@/src/components/chat/channel-list/channel-group-preferences';
import {
  buildChannelLayout,
  countChannels,
  type ChannelLayoutInput,
  type ChannelRowData,
  type ChannelSectionData,
} from '@/src/features/channels/model/layout';

const NOW = 1_000 * ACTIVE_WINDOW_MS;

function channel(id: string, overrides: Partial<ChannelRowData> = {}): ChannelRowData {
  return {
    id,
    name: id,
    isPrivate: false,
    unreadCount: 0,
    hasUnread: false,
    messageUnreadCount: 0,
    isMentioned: false,
    hasGroupMention: false,
    isMuted: false,
    isStarred: false,
    lastActivityAtMs: 0,
    sectionId: null,
    sectionPosition: '',
    ...overrides,
  };
}

const section = (
  id: string,
  overrides: Partial<Omit<ChannelSectionData, 'id' | 'name'>> = {},
): ChannelSectionData => ({
  id,
  name: id,
  isCollapsed: false,
  filterMode: ChannelFilterMode.ALL,
  sortOrder: null,
  ...overrides,
});

/** Everything shown, Recency, unless a test says otherwise. */
const layout = (input: Partial<ChannelLayoutInput>): ReturnType<typeof buildChannelLayout> =>
  buildChannelLayout({
    channels: [],
    sections: [],
    filter: 'all',
    isChannelsCollapsed: false,
    channelsPreference: { filterMode: ChannelFilterMode.ALL, sortOrder: ChannelSortOrder.RECENCY },
    now: NOW,
    ...input,
  });

const ids = (groups: ReturnType<typeof buildChannelLayout>['groups'], index = 0): string[] =>
  groups[index]?.channelIds ?? [];

describe('buildChannelLayout', () => {
  describe('with no sections', () => {
    it('lists every channel under one Channels group that does not fold', () => {
      const { groups } = layout({
        channels: [channel('a'), channel('b')],
        isChannelsCollapsed: true,
      });

      assert.equal(groups.length, 1);
      assert.equal(groups[0]?.kind, 'channels');
      assert.equal(groups[0]?.isCollapsible, false);
      assert.equal(groups[0]?.isCollapsed, false);
    });

    it("keeps starred channels on top, then the group's sort", () => {
      const { groups } = layout({
        channels: [
          channel('old', { lastActivityAtMs: 1 }),
          channel('recent', { lastActivityAtMs: 9 }),
          channel('unread', { unreadCount: 2, hasUnread: true, lastActivityAtMs: 2 }),
          channel('starred', { isStarred: true, lastActivityAtMs: 0 }),
        ],
      });

      assert.deepEqual(ids(groups), ['starred', 'recent', 'unread', 'old']);
    });
  });

  describe('with sections', () => {
    const channels = [
      channel('payments', { sectionId: 'checkout', sectionPosition: 'b', isStarred: true }),
      channel('releases', { sectionId: 'checkout', sectionPosition: 'a' }),
      channel('design', { sectionId: 'design' }),
      channel('random'),
    ];

    it('emits each section in order and Channels for the rest', () => {
      const { groups } = layout({
        channels,
        sections: [section('checkout'), section('design'), section('empty')],
      });

      assert.deepEqual(
        groups.map(group => group.id),
        ['checkout', 'design', 'empty', 'channels'],
      );
      assert.deepEqual(ids(groups, 3), ['random']);
      assert.ok(groups.every(group => group.isCollapsible));
    });

    it('orders a section in manual order by position, not by star', () => {
      const { groups } = layout({ channels, sections: [section('checkout')] });

      assert.deepEqual(ids(groups), ['releases', 'payments']);
    });

    it('keeps an empty section and skips an empty Channels group', () => {
      const { groups } = layout({
        channels: [channel('only', { sectionId: 'a' })],
        sections: [section('a'), section('b')],
      });

      assert.deepEqual(
        groups.map(group => group.id),
        ['a', 'b'],
      );
    });

    it("carries each group's collapsed state", () => {
      const { groups } = layout({
        channels,
        sections: [section('checkout', { isCollapsed: true }), section('design')],
        isChannelsCollapsed: true,
      });

      assert.deepEqual(
        groups.map(group => group.isCollapsed),
        [true, false, true],
      );
    });

    it('treats a channel in a deleted section as unsectioned, not hidden', () => {
      const { groups } = layout({
        channels: [channel('orphan', { sectionId: 'gone' })],
        sections: [section('a')],
      });

      assert.deepEqual(ids(groups, 1), ['orphan']);
    });

    it('drops sections under a filter chip and answers one flat list', () => {
      const { groups } = layout({
        channels,
        sections: [section('checkout'), section('design')],
        filter: 'starred',
      });

      assert.equal(groups.length, 1);
      assert.equal(groups[0]?.kind, 'flat');
      assert.deepEqual(ids(groups), ['payments']);
    });
  });

  describe("a group's saved filter and sort", () => {
    const recent = NOW - 1;
    const stale = NOW - ACTIVE_WINDOW_MS - 1;

    it('Active only drops channels quiet for 30 days, and keeps the header', () => {
      const { groups } = layout({
        channels: [channel('stale', { sectionId: 's', lastActivityAtMs: stale })],
        sections: [section('s', { filterMode: ChannelFilterMode.ACTIVE })],
      });

      assert.equal(groups[0]?.id, 's');
      assert.deepEqual(ids(groups), []);
    });

    it('sorts a section alphabetically, unread first', () => {
      const { groups } = layout({
        channels: [
          channel('b', { sectionId: 's', lastActivityAtMs: recent }),
          channel('c', { sectionId: 's', unreadCount: 1, lastActivityAtMs: recent }),
          channel('a', { sectionId: 's', lastActivityAtMs: recent }),
        ],
        sections: [section('s', { sortOrder: ChannelSortOrder.ALPHABETICAL })],
      });

      assert.deepEqual(ids(groups), ['c', 'a', 'b']);
    });

    it('filters Channels by its own preference, keeping the header when nothing is left', () => {
      const { groups } = layout({
        channels: [channel('quiet', { lastActivityAtMs: recent, lastViewedAt: recent })],
        sections: [section('s')],
        channelsPreference: {
          filterMode: ChannelFilterMode.UNREADS,
          sortOrder: ChannelSortOrder.RECENCY,
        },
      });

      assert.equal(groups[1]?.id, 'channels');
      assert.deepEqual(ids(groups, 1), []);
    });

    it("reads Mentions from the sidebar's wider mention set", () => {
      const { groups } = layout({
        channels: [channel('replied', { hasGroupMention: true }), channel('other')],
        channelsPreference: {
          filterMode: ChannelFilterMode.MENTIONS,
          sortOrder: ChannelSortOrder.RECENCY,
        },
      });

      assert.deepEqual(ids(groups), ['replied']);
    });
  });

  describe('filters and counts', () => {
    const channels = [
      channel('a', { unreadCount: 3, hasUnread: true, isMentioned: true, isStarred: true }),
      channel('b', { unreadCount: 1, hasUnread: true }),
      // Unread with nothing countable: still unread.
      channel('e', { hasUnread: true }),
      // A mention already read is not waiting on anyone.
      channel('c', { isMentioned: true }),
      channel('d', { isStarred: true }),
    ];

    it('counts each chip over the unfiltered list', () => {
      assert.deepEqual(countChannels(channels), { all: 5, unread: 3, mentions: 1, starred: 2 });
    });

    it('scopes Mentions to unread mentions', () => {
      const { groups } = layout({ channels, filter: 'mentions' });

      assert.deepEqual(ids(groups), ['a']);
    });

    it('returns the same counts whichever chip is active', () => {
      const all = layout({ channels });
      const unread = layout({ channels, filter: 'unread' });

      assert.deepEqual(all.counts, unread.counts);
    });
  });
});
