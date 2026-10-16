import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildChannelLayout,
  countChannels,
  type ChannelRowData,
  type ChannelSectionData,
} from '@/src/features/channels/model/layout';

function channel(id: string, overrides: Partial<ChannelRowData> = {}): ChannelRowData {
  return {
    id,
    name: id,
    isPrivate: false,
    unreadCount: 0,
    hasUnread: false,
    messageUnreadCount: 0,
    isMentioned: false,
    isStarred: false,
    lastActivityAtMs: 0,
    sectionId: null,
    sectionPosition: '',
    ...overrides,
  };
}

const section = (id: string, isCollapsed = false): ChannelSectionData => ({
  id,
  name: id,
  isCollapsed,
});

const ids = (groups: ReturnType<typeof buildChannelLayout>['groups'], index = 0): string[] =>
  groups[index]?.channelIds ?? [];

describe('buildChannelLayout', () => {
  describe('with no sections', () => {
    it('lists every channel under one headerless group', () => {
      const { groups } = buildChannelLayout({
        channels: [channel('a'), channel('b')],
        sections: [],
        filter: 'all',
        isChannelsCollapsed: false,
      });

      assert.equal(groups.length, 1);
      assert.equal(groups[0]?.kind, 'flat');
    });

    it('keeps starred channels on top, then unread, then most recent', () => {
      const { groups } = buildChannelLayout({
        channels: [
          channel('old', { lastActivityAtMs: 1 }),
          channel('recent', { lastActivityAtMs: 9 }),
          channel('unread', { unreadCount: 2, hasUnread: true, lastActivityAtMs: 2 }),
          channel('starred', { isStarred: true, lastActivityAtMs: 0 }),
        ],
        sections: [],
        filter: 'all',
        isChannelsCollapsed: false,
      });

      assert.deepEqual(ids(groups), ['starred', 'unread', 'recent', 'old']);
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
      const { groups } = buildChannelLayout({
        channels,
        sections: [section('checkout'), section('design'), section('empty')],
        filter: 'all',
        isChannelsCollapsed: false,
      });

      assert.deepEqual(
        groups.map(group => group.id),
        ['checkout', 'design', 'empty', 'channels'],
      );
      assert.deepEqual(ids(groups, 3), ['random']);
    });

    it('orders a section by position, not by star', () => {
      const { groups } = buildChannelLayout({
        channels,
        sections: [section('checkout')],
        filter: 'all',
        isChannelsCollapsed: false,
      });

      assert.deepEqual(ids(groups), ['releases', 'payments']);
    });

    it('keeps an empty section and skips an empty Channels group', () => {
      const { groups } = buildChannelLayout({
        channels: [channel('only', { sectionId: 'a' })],
        sections: [section('a'), section('b')],
        filter: 'all',
        isChannelsCollapsed: false,
      });

      assert.deepEqual(
        groups.map(group => group.id),
        ['a', 'b'],
      );
    });

    it("carries each group's collapsed state", () => {
      const { groups } = buildChannelLayout({
        channels,
        sections: [section('checkout', true), section('design')],
        filter: 'all',
        isChannelsCollapsed: true,
      });

      assert.deepEqual(
        groups.map(group => group.isCollapsed),
        [true, false, true],
      );
    });

    it('treats a channel in a deleted section as unsectioned, not hidden', () => {
      const { groups } = buildChannelLayout({
        channels: [channel('orphan', { sectionId: 'gone' })],
        sections: [section('a')],
        filter: 'all',
        isChannelsCollapsed: false,
      });

      assert.deepEqual(ids(groups, 1), ['orphan']);
    });

    it('drops sections under a filter and answers one flat list', () => {
      const { groups } = buildChannelLayout({
        channels,
        sections: [section('checkout'), section('design')],
        filter: 'starred',
        isChannelsCollapsed: false,
      });

      assert.equal(groups.length, 1);
      assert.equal(groups[0]?.kind, 'flat');
      assert.deepEqual(ids(groups), ['payments']);
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
      const { groups } = buildChannelLayout({
        channels,
        sections: [],
        filter: 'mentions',
        isChannelsCollapsed: false,
      });

      assert.deepEqual(ids(groups), ['a']);
    });

    it('returns the same counts whichever chip is active', () => {
      const all = buildChannelLayout({
        channels,
        sections: [],
        filter: 'all',
        isChannelsCollapsed: false,
      });
      const unread = buildChannelLayout({
        channels,
        sections: [],
        filter: 'unread',
        isChannelsCollapsed: false,
      });

      assert.deepEqual(all.counts, unread.counts);
    });
  });
});
