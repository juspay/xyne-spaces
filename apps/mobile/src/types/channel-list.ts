import type { ChannelSection, ChannelVisibility } from '@xyne/shared';

export interface ChannelListItemData {
  id: string;
  name: string;
  visibility: ChannelVisibility;
  /** Activity-derived count shown in the channel directory, matching desktop. */
  unreadCount: number;
  /** Message count used only to preserve the in-chat unread landing contract. */
  messageUnreadCount?: number;
  lastViewedAt?: number;
  lastViewedConversationId?: string;
  lastActivityAt?: number;
  highlightQuery?: string;
}

/**
 * Every channel on the All tab sits under a group header: the two built-in
 * groups the list always offers, and one per section the user created.
 */
export type ChannelListGroupKind = 'starred' | 'section' | 'channels';

type ChannelListGroupHeaderBase = {
  kind: 'section-header';
  id: string;
  unreadCount: number;
  channelCount: number;
  isCollapsed: boolean;
  /**
   * Drives the group's divider. Every header is preceded by one rule, which
   * closes off whatever came before it — so the first header, having nothing
   * above it but the filter tabs, draws none. Nothing draws a rule below
   * itself, which leaves the bottom of the list open and means two rules can
   * never stack.
   */
  isFirstGroup: boolean;
};

/**
 * Discriminated on `group` so only a custom section can be asked for its
 * `ChannelSection` — the built-in groups have no row to rename or delete.
 */
export type ChannelListSectionHeaderRow =
  | (ChannelListGroupHeaderBase & { group: 'section'; section: ChannelSection })
  | (ChannelListGroupHeaderBase & { group: 'starred' | 'channels'; title: string });

export type ChannelListChannelRow = {
  kind: 'channel';
  id: string;
  data: ChannelListItemData;
};

export type ChannelListRow = ChannelListSectionHeaderRow | ChannelListChannelRow;
