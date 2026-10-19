import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ChannelSection } from '@xyne/shared';
import type { VisibleChannel } from '@/src/machines/stateMachine';
import type { ChannelListChannelRow, ChannelListRow } from '@/src/types/channel-list';
import {
  buildGroupedChannelRows,
  type SectionBucket,
} from '@/src/components/chat/channel-list/section-utils';

const mkChannel = (id: string): VisibleChannel => ({ id, name: id }) as unknown as VisibleChannel;

const mkSection = (id: string, isCollapsed = false): ChannelSection =>
  ({ id, name: id, isCollapsed }) as unknown as ChannelSection;

const mkBucket = (section: ChannelSection, channels: VisibleChannel[]): SectionBucket => ({
  section,
  channels,
});

const toChannelRow = (channel: VisibleChannel): ChannelListChannelRow => ({
  kind: 'channel',
  id: channel.id,
  data: {
    id: channel.id,
    name: channel.name,
    visibility: 'public' as ChannelListChannelRow['data']['visibility'],
    unreadCount: 0,
  },
});

type BuildOverrides = Partial<Parameters<typeof buildGroupedChannelRows>[0]>;

const build = (overrides: BuildOverrides = {}): ChannelListRow[] =>
  buildGroupedChannelRows({
    starred: [],
    sectioned: [],
    unsectioned: [],
    unreadCounts: new Map(),
    isStarredCollapsed: false,
    isChannelsCollapsed: false,
    toChannelRow,
    ...overrides,
  });

/** `header-x` for a group header, otherwise the channel id. */
const ids = (rows: readonly ChannelListRow[]): string[] => rows.map(row => row.id);

const firstGroupFlags = (rows: readonly ChannelListRow[]): boolean[] =>
  rows.filter(row => row.kind === 'section-header').map(row => row.isFirstGroup);

describe('buildGroupedChannelRows', () => {
  it('orders the groups Starred, then sections, then Channels', () => {
    const rows = build({
      starred: [mkChannel('announcements')],
      sectioned: [mkBucket(mkSection('s1'), [mkChannel('general')])],
      unsectioned: [mkChannel('random')],
    });

    assert.deepEqual(ids(rows), [
      'header-starred',
      'announcements',
      'header-s1',
      'general',
      'header-channels',
      'random',
    ]);
  });

  it('skips the Starred header when nothing is starred', () => {
    const rows = build({ unsectioned: [mkChannel('random')] });

    assert.deepEqual(ids(rows), ['header-channels', 'random']);
  });

  it('skips the Channels header when every channel is sectioned', () => {
    const rows = build({
      sectioned: [mkBucket(mkSection('s1'), [mkChannel('general')])],
    });

    assert.deepEqual(ids(rows), ['header-s1', 'general']);
  });

  it('keeps a section header even when the section has no channels', () => {
    const rows = build({ sectioned: [mkBucket(mkSection('s1'), [])] });

    assert.deepEqual(ids(rows), ['header-s1']);
    assert.equal(rows[0]?.kind === 'section-header' && rows[0].channelCount, 0);
  });

  it('emits a collapsed group as its header alone', () => {
    const rows = build({
      starred: [mkChannel('announcements')],
      sectioned: [mkBucket(mkSection('s1', true), [mkChannel('general')])],
      unsectioned: [mkChannel('random')],
      isStarredCollapsed: true,
      isChannelsCollapsed: true,
    });

    assert.deepEqual(ids(rows), ['header-starred', 'header-s1', 'header-channels']);
  });

  it('reports the channel count of a collapsed group', () => {
    const [header] = build({
      unsectioned: [mkChannel('a'), mkChannel('b')],
      isChannelsCollapsed: true,
    });

    assert.equal(header?.kind === 'section-header' && header.channelCount, 2);
  });

  it('sums the unread counts of a group onto its header', () => {
    const rows = build({
      sectioned: [mkBucket(mkSection('s1'), [mkChannel('general'), mkChannel('brand')])],
      unreadCounts: new Map([
        ['general', 3],
        ['brand', 4],
      ]),
    });

    assert.equal(rows[0]?.kind === 'section-header' && rows[0].unreadCount, 7);
  });

  it('carries the section on a section header and a title on a built-in one', () => {
    const section = mkSection('s1');
    const rows = build({
      starred: [mkChannel('announcements')],
      sectioned: [mkBucket(section, [])],
    });

    const starredHeader = rows.find(row => row.id === 'header-starred');
    const sectionHeader = rows.find(row => row.id === 'header-s1');

    assert.equal(
      starredHeader?.kind === 'section-header' && starredHeader.group !== 'section'
        ? starredHeader.title
        : null,
      'Starred',
    );
    assert.equal(
      sectionHeader?.kind === 'section-header' && sectionHeader.group === 'section'
        ? sectionHeader.section
        : null,
      section,
    );
  });

  it('marks only the leading header as first, whichever group leads', () => {
    const rows = build({
      starred: [mkChannel('announcements')],
      sectioned: [
        mkBucket(mkSection('s1'), [mkChannel('general')]),
        mkBucket(mkSection('s2'), [mkChannel('brand')]),
      ],
      unsectioned: [mkChannel('random')],
    });

    assert.deepEqual(firstGroupFlags(rows), [true, false, false, false]);
  });

  it('marks a lone header as first', () => {
    const rows = build({ unsectioned: [mkChannel('random')] });

    assert.deepEqual(firstGroupFlags(rows), [true]);
  });

  it('promotes the leading section when nothing is starred', () => {
    const rows = build({
      sectioned: [mkBucket(mkSection('s1'), [mkChannel('general')])],
      unsectioned: [mkChannel('random')],
    });

    assert.deepEqual(firstGroupFlags(rows), [true, false]);
  });

  it('does not mark a later header as first just because a group before it is collapsed', () => {
    // A collapsed leading group still contributes its header, so the group
    // after it is never the first — a flag keyed on row count alone would slip
    // here if the collapsed group emitted nothing at all.
    const rows = build({
      starred: [mkChannel('announcements')],
      isStarredCollapsed: true,
      unsectioned: [mkChannel('random')],
    });

    assert.deepEqual(ids(rows), ['header-starred', 'header-channels', 'random']);
    assert.deepEqual(firstGroupFlags(rows), [true, false]);
  });

  it('floats unread channels to the top within the Channels group', () => {
    const rows = build({
      unsectioned: [mkChannel('read'), mkChannel('unread')],
      toChannelRow: channel => ({
        ...toChannelRow(channel),
        data: { ...toChannelRow(channel).data, unreadCount: channel.id === 'unread' ? 2 : 0 },
      }),
    });

    assert.deepEqual(ids(rows), ['header-channels', 'unread', 'read']);
  });
});
