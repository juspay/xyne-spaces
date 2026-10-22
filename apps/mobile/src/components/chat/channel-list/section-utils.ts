import type { ChannelSection, ChannelUserStatus } from '@xyne/shared';
import type { VisibleChannel } from '@/src/machines/stateMachine';
import type { ChannelListChannelRow, ChannelListRow } from '@/src/types/channel-list';
import { sortChannelRowsByUnread } from './channel-list.utils';

export type SectionBucket = {
  section: ChannelSection;
  channels: VisibleChannel[];
};

let positionSequence = 0;

export const keyBetween = (a: string | null, _b: string | null): string => {
  const stamp = Date.now().toString(36);
  const seq = (positionSequence++).toString(36).padStart(3, '0');
  let key = `${stamp}${seq}`;
  if (a !== null && key <= a) {
    key = `${a}1`;
  }
  return key;
};

export const sumSectionUnread = (
  channels: readonly VisibleChannel[],
  unreadCounts: ReadonlyMap<string, number>,
): number => channels.reduce((total, channel) => total + (unreadCounts.get(channel.id) ?? 0), 0);

export const bucketChannelsBySection = (
  channels: VisibleChannel[],
  allChannelsUserStatus: readonly ChannelUserStatus[],
  sections: readonly ChannelSection[],
): { sectioned: SectionBucket[]; unsectioned: VisibleChannel[] } => {
  const statusByChannelId = new Map<string, ChannelUserStatus>();
  for (const status of allChannelsUserStatus) {
    statusByChannelId.set(status.channelId, status);
  }

  const validSectionIds = new Set(sections.map(s => s.id));
  const channelsBySectionId = new Map<string, VisibleChannel[]>();
  const unsectioned: VisibleChannel[] = [];

  for (const channel of channels) {
    const sectionId = statusByChannelId.get(channel.id)?.sectionId;
    if (sectionId && validSectionIds.has(sectionId)) {
      const existing = channelsBySectionId.get(sectionId);
      if (existing) {
        existing.push(channel);
      } else {
        channelsBySectionId.set(sectionId, [channel]);
      }
    } else {
      unsectioned.push(channel);
    }
  }

  const bySectionPosition = (a: VisibleChannel, b: VisibleChannel): number => {
    const pa = statusByChannelId.get(a.id)?.sectionPosition ?? '';
    const pb = statusByChannelId.get(b.id)?.sectionPosition ?? '';
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  };

  const sectioned: SectionBucket[] = sections.map(section => ({
    section,
    channels: [...(channelsBySectionId.get(section.id) ?? [])].sort(bySectionPosition),
  }));

  return { sectioned, unsectioned };
};

export type GroupedChannelRowsInput = {
  starred: readonly VisibleChannel[];
  sectioned: readonly SectionBucket[];
  unsectioned: readonly VisibleChannel[];
  unreadCounts: ReadonlyMap<string, number>;
  isStarredCollapsed: boolean;
  isChannelsCollapsed: boolean;
  toChannelRow: (channel: VisibleChannel) => ChannelListChannelRow;
};

/**
 * Lays the All tab out as Slack does: Starred, then one group per section the
 * user created, then Channels for everything left over. Each group is one
 * header row followed by its channels, and a collapsed group contributes its
 * header alone.
 *
 * A built-in group with nothing in it is skipped entirely — a header opening
 * onto no rows reads as a bug. A *section* with no channels keeps its header,
 * because that header is where the user drops channels into it from.
 */
export const buildGroupedChannelRows = ({
  starred,
  sectioned,
  unsectioned,
  unreadCounts,
  isStarredCollapsed,
  isChannelsCollapsed,
  toChannelRow,
}: GroupedChannelRowsInput): ChannelListRow[] => {
  const rows: ChannelListRow[] = [];

  if (starred.length > 0) {
    rows.push({
      kind: 'section-header',
      group: 'starred',
      id: 'header-starred',
      title: 'Starred',
      unreadCount: sumSectionUnread(starred, unreadCounts),
      channelCount: starred.length,
      isCollapsed: isStarredCollapsed,
      isFirstGroup: rows.length === 0,
    });

    if (!isStarredCollapsed) {
      rows.push(...starred.map(toChannelRow));
    }
  }

  for (const bucket of sectioned) {
    rows.push({
      kind: 'section-header',
      group: 'section',
      id: `header-${bucket.section.id}`,
      section: bucket.section,
      unreadCount: sumSectionUnread(bucket.channels, unreadCounts),
      channelCount: bucket.channels.length,
      isCollapsed: bucket.section.isCollapsed,
      isFirstGroup: rows.length === 0,
    });

    if (!bucket.section.isCollapsed) {
      rows.push(...bucket.channels.map(toChannelRow));
    }
  }

  if (unsectioned.length > 0) {
    rows.push({
      kind: 'section-header',
      group: 'channels',
      id: 'header-channels',
      title: 'Channels',
      unreadCount: sumSectionUnread(unsectioned, unreadCounts),
      channelCount: unsectioned.length,
      isCollapsed: isChannelsCollapsed,
      isFirstGroup: rows.length === 0,
    });

    if (!isChannelsCollapsed) {
      rows.push(...sortChannelRowsByUnread(unsectioned.map(toChannelRow)));
    }
  }

  return rows;
};
