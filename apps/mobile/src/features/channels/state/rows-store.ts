import { batch, observable, type Observable } from '@legendapp/state';

import type { ChannelGroup, ChannelRowData, ChannelSectionData } from '../model/layout';

type ChannelRowsStore = {
  /** The screen's structure. Changes when channels move, never on a message. */
  groups: ChannelGroup[];
  /** Row data, keyed by channel id. One subscribable node per row. */
  byId: Record<string, ChannelRowData>;
  /** Every channel regardless of filter, for the new-section picker. */
  allIds: string[];
  /** Every section, even when a filter has hidden the groups. */
  sections: ChannelSectionData[];
  /** Which workspace the rows describe. */
  scope: string | null;
};

/**
 * The channel list, as independently observable parts.
 *
 * Keyed by id for the reason `rows-store` in DMs is: a read receipt changes one
 * row's `unreadCount` and re-renders that row's badge — not the row, not the
 * group, not the list.
 */
const channelRows$ = observable<ChannelRowsStore>({
  groups: [],
  byId: {},
  allIds: [],
  sections: [],
  scope: null,
});

export const channelGroups$ = channelRows$.groups;
export const channelAllIds$ = channelRows$.allIds;
export const channelSections$ = channelRows$.sections;

/**
 * The node for one channel. A Legend State node exists for any key whether or
 * not a value was written, so the non-null assertion narrows a typing artifact
 * of `noUncheckedIndexedAccess`, not a real case.
 */
export function channelRow$(id: string): Observable<ChannelRowData> {
  return channelRows$.byId[id]!;
}

function sameList<T>(a: readonly T[], b: readonly T[], same: (x: T, y: T) => boolean): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!same(a[i]!, b[i]!)) return false;
  }
  return true;
}

const sameString = (a: string, b: string): boolean => a === b;

const NO_IDS: readonly string[] = [];

function sameGroup(a: ChannelGroup, b: ChannelGroup): boolean {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.title === b.title &&
    a.isCollapsed === b.isCollapsed &&
    a.isCollapsible === b.isCollapsible &&
    sameList(a.channelIds, b.channelIds, sameString)
  );
}

function sameSection(a: ChannelSectionData, b: ChannelSectionData): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.isCollapsed === b.isCollapsed &&
    a.filterMode === b.filterMode &&
    a.sortOrder === b.sortOrder
  );
}

/**
 * Pushes a freshly derived list into the store, writing only what moved.
 *
 * Groups that are structurally unchanged keep their previous object, so a group
 * component memoised on its prop does not re-render for a sync that touched
 * some other group.
 */
export function syncChannelRows(
  channels: readonly ChannelRowData[],
  groups: readonly ChannelGroup[],
  sections: readonly ChannelSectionData[],
  scope: string | null,
): void {
  batch(() => {
    if (channelRows$.scope.peek() !== scope) {
      channelRows$.byId.set({});
      channelRows$.groups.set([]);
      channelRows$.allIds.set([]);
      channelRows$.sections.set([]);
      channelRows$.scope.set(scope);
    }

    const nextIds: string[] = [];
    const present = new Set<string>();

    for (const channel of channels) {
      nextIds.push(channel.id);
      present.add(channel.id);
      const node$ = channelRow$(channel.id);
      const current = node$.peek();
      if (current === undefined) {
        node$.set(channel);
      } else if (!sameRow(current, channel)) {
        // Keep the avatar ids' reference while they are unchanged, so a DM's
        // unread change does not hand its avatar a fresh array.
        node$.set(
          current.avatarUserIds !== undefined &&
            channel.avatarUserIds !== undefined &&
            sameList(current.avatarUserIds, channel.avatarUserIds, sameString)
            ? { ...channel, avatarUserIds: current.avatarUserIds }
            : channel,
        );
      }
    }

    for (const id of Object.keys(channelRows$.byId.peek())) {
      if (!present.has(id)) channelRow$(id).delete();
    }

    if (!sameList(channelRows$.allIds.peek(), nextIds, sameString)) {
      channelRows$.allIds.set(nextIds);
    }

    if (!sameList(channelRows$.sections.peek(), sections, sameSection)) {
      channelRows$.sections.set([...sections]);
    }

    const previous = channelRows$.groups.peek();
    const nextGroups = groups.map((group, index) => {
      const before = previous[index];
      return before !== undefined && sameGroup(before, group) ? before : group;
    });
    const unchanged =
      previous.length === nextGroups.length && nextGroups.every((g, i) => g === previous[i]);
    if (!unchanged) channelRows$.groups.set(nextGroups);
  });
}

function sameRow(a: ChannelRowData, b: ChannelRowData): boolean {
  return (
    a.name === b.name &&
    a.isPrivate === b.isPrivate &&
    a.unreadCount === b.unreadCount &&
    a.hasUnread === b.hasUnread &&
    a.messageUnreadCount === b.messageUnreadCount &&
    a.isMentioned === b.isMentioned &&
    a.hasGroupMention === b.hasGroupMention &&
    a.isMuted === b.isMuted &&
    a.isStarred === b.isStarred &&
    a.lastActivityAtMs === b.lastActivityAtMs &&
    a.lastViewedAt === b.lastViewedAt &&
    a.lastViewedConversationId === b.lastViewedConversationId &&
    a.sectionId === b.sectionId &&
    a.sectionPosition === b.sectionPosition &&
    a.isDm === b.isDm &&
    sameList(a.avatarUserIds ?? NO_IDS, b.avatarUserIds ?? NO_IDS, sameString)
  );
}
