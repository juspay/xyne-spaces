import type { ChannelFilter, ChannelFilterCounts } from './filter';

/**
 * One channel, as the list needs it. Flat and serialisable so a row subscribes
 * to its leaves, and so the layout below is a pure function of plain data.
 */
export type ChannelRowData = {
  id: string;
  name: string;
  isPrivate: boolean;
  /**
   * Unread activity the server counts — mentions and the like. This is the
   * number the badge shows, and it is what the web dashboard shows. Plain
   * messages in a channel create no activity for members who were not
   * mentioned, so a channel can be unread with this at zero.
   */
  unreadCount: number;
  /**
   * Anything new here: counted activity, an unread mention, or activity since
   * the channel was last viewed. Distinct from `unreadCount` because the
   * synced data has no per-message counter for channels, so "unread, no
   * number" is a real state and the row must still read as unread.
   */
  hasUnread: boolean;
  /** An unread mention is waiting here. */
  isMentioned: boolean;
  isStarred: boolean;
  lastActivityAtMs: number;
  /** The server's own counter, which the chat route needs to land on the first unread. */
  messageUnreadCount: number;
  lastViewedAt?: number | undefined;
  lastViewedConversationId?: string | undefined;
  sectionId: string | null;
  /** Orders a channel inside its section. */
  sectionPosition: string;
};

export type ChannelSectionData = {
  id: string;
  name: string;
  isCollapsed: boolean;
};

/**
 * `flat` has no header and is never collapsible: it is the whole list when the
 * user has no sections, or when a filter is active. `channels` is the
 * catch-all that appears beside sections, for channels in none of them.
 */
export type ChannelGroupKind = 'flat' | 'section' | 'channels';

export type ChannelGroup = {
  /** The section's id; `channels` and `flat` for the built-ins. */
  id: string;
  kind: ChannelGroupKind;
  title: string;
  isCollapsed: boolean;
  channelIds: string[];
};

export type ChannelLayoutInput = {
  channels: readonly ChannelRowData[];
  /** In the user's order. */
  sections: readonly ChannelSectionData[];
  filter: ChannelFilter;
  isChannelsCollapsed: boolean;
};

export type ChannelLayout = {
  groups: ChannelGroup[];
  counts: ChannelFilterCounts;
};

export const CHANNELS_GROUP_ID = 'channels';
export const FLAT_GROUP_ID = 'flat';

const isUnread = (channel: ChannelRowData): boolean => channel.hasUnread;

/**
 * A mention you have already read is not waiting on you, so Mentions stays
 * scoped to unread ones — the same rule the classic list applies.
 */
const isUnreadMention = (channel: ChannelRowData): boolean =>
  channel.isMentioned && isUnread(channel);

const PREDICATES: Record<ChannelFilter, (channel: ChannelRowData) => boolean> = {
  all: () => true,
  unread: isUnread,
  mentions: isUnreadMention,
  starred: channel => channel.isStarred,
};

/**
 * Starred on top, then unread, then most recent.
 *
 * Starred first is the design's rule for the ungrouped list (a starred channel
 * "remains at top"). Unread before read within each band is the existing
 * channels ordering, kept so a channel does not sink below read ones when it
 * gets a message.
 */
export function compareChannels(a: ChannelRowData, b: ChannelRowData): number {
  if (a.isStarred !== b.isStarred) return a.isStarred ? -1 : 1;
  if (isUnread(a) !== isUnread(b)) return isUnread(a) ? -1 : 1;
  if (a.lastActivityAtMs !== b.lastActivityAtMs) return b.lastActivityAtMs - a.lastActivityAtMs;
  return a.name.localeCompare(b.name);
}

function bySectionPosition(a: ChannelRowData, b: ChannelRowData): number {
  if (a.sectionPosition !== b.sectionPosition)
    return a.sectionPosition < b.sectionPosition ? -1 : 1;
  return a.name.localeCompare(b.name);
}

export function countChannels(channels: readonly ChannelRowData[]): ChannelFilterCounts {
  let unread = 0;
  let mentions = 0;
  let starred = 0;

  for (const channel of channels) {
    if (isUnread(channel)) unread += 1;
    if (isUnreadMention(channel)) mentions += 1;
    if (channel.isStarred) starred += 1;
  }

  return { all: channels.length, unread, mentions, starred };
}

/**
 * Lays the screen out.
 *
 * - A filter, or no sections: one headerless list.
 * - Sections and All: each section in order, then `Channels` for the rest.
 *   A section keeps its header when empty — it is where channels are moved
 *   into it from — but `Channels` is skipped when nothing is left in it.
 *
 * Sections are hidden under a filter on purpose: a filter answers "which
 * channels", and breaking the answer into groups with most of them empty reads
 * as noise.
 */
export function buildChannelLayout({
  channels,
  sections,
  filter,
  isChannelsCollapsed,
}: ChannelLayoutInput): ChannelLayout {
  const counts = countChannels(channels);

  if (filter !== 'all' || sections.length === 0) {
    const matching = channels.filter(PREDICATES[filter]).sort(compareChannels);
    return {
      counts,
      groups: [
        {
          id: FLAT_GROUP_ID,
          kind: 'flat',
          title: '',
          isCollapsed: false,
          channelIds: matching.map(channel => channel.id),
        },
      ],
    };
  }

  const bySection = new Map<string, ChannelRowData[]>(sections.map(section => [section.id, []]));
  const unsectioned: ChannelRowData[] = [];

  for (const channel of channels) {
    // A section id that no longer exists leaves the channel unsectioned rather
    // than invisible.
    const bucket = channel.sectionId === null ? undefined : bySection.get(channel.sectionId);
    if (bucket) bucket.push(channel);
    else unsectioned.push(channel);
  }

  const groups: ChannelGroup[] = sections.map(section => ({
    id: section.id,
    kind: 'section',
    title: section.name,
    isCollapsed: section.isCollapsed,
    channelIds: (bySection.get(section.id) ?? [])
      .sort(bySectionPosition)
      .map(channel => channel.id),
  }));

  if (unsectioned.length > 0) {
    groups.push({
      id: CHANNELS_GROUP_ID,
      kind: 'channels',
      title: 'Channels',
      isCollapsed: isChannelsCollapsed,
      channelIds: unsectioned.sort(compareChannels).map(channel => channel.id),
    });
  }

  return { counts, groups };
}
