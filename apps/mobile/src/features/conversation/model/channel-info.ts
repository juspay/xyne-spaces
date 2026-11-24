import { ChannelScopeType, NotificationLevel } from '@xyne/shared';

import { dayMonthOf } from './message-time';
import type { RoomKind } from './room-title';

/** The quick actions under the name, in Figma's order. */
export type ChannelInfoActionId = 'search' | 'call' | 'mute' | 'add';

/** The rows of "In this channel", in Figma's order (Threads has no screen yet). */
export type ChannelInfoContentRowId = 'files' | 'tickets' | 'pinned' | 'canvas' | 'links';

/** Same wording as the room header: "1 member", "34 members". */
export function memberCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'member' : 'members'}`;
}

/**
 * The caption under the name: "Channel · 34 members". A one-to-one chat has no
 * member count to give, so it just says what it is.
 */
export function channelInfoSubtitle(
  kind: RoomKind,
  isPrivate: boolean,
  memberCount: number,
): string {
  if (kind === 'dm') return 'Direct message';
  const what = kind === 'group' ? 'Group' : isPrivate ? 'Private channel' : 'Channel';
  return memberCount > 0 ? `${what} · ${memberCountLabel(memberCount)}` : what;
}

/**
 * The members row: up to two first names, then how many more ("Kunal, Arjun
 * and 32 others"). Falls back to the bare count while the names are loading.
 */
export function membersSummary(names: readonly string[], total: number): string {
  const firstNames = names
    .map(name => name.trim().split(/\s+/)[0] ?? '')
    .filter(name => name.length > 0)
    .slice(0, 2);
  if (firstNames.length === 0) return memberCountLabel(total);
  const others = Math.max(0, total - firstNames.length);
  if (others === 0) return firstNames.join(' and ');
  return `${firstNames.join(', ')} and ${others} ${others === 1 ? 'other' : 'others'}`;
}

/**
 * "Created 4 Feb by Arjun Kapoor"; the year only when it isn't this one, and
 * the creator only once known.
 */
export function createdLine(
  createdAt: number | null | undefined,
  creatorName: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  const day = dayMonthOf(date);
  const when = date.getFullYear() === now.getFullYear() ? day : `${day} ${date.getFullYear()}`;
  const by = creatorName?.trim();
  return by ? `Created ${when} by ${by}` : `Created ${when}`;
}

/**
 * Which quick actions show. Add follows the classic screen's permission; Mute
 * needs the user's own notification settings, which only a member has.
 */
export function channelInfoActions(args: {
  canAddPeople: boolean;
  canMute: boolean;
}): ChannelInfoActionId[] {
  const actions: ChannelInfoActionId[] = ['search', 'call'];
  if (args.canMute) actions.push('mute');
  if (args.canAddPeople) actions.push('add');
  return actions;
}

/** Tickets only where the classic screen shows them (its gate decides). */
export function channelInfoContentRows(showTickets: boolean): ChannelInfoContentRowId[] {
  return showTickets
    ? ['files', 'tickets', 'pinned', 'canvas', 'links']
    : ['files', 'pinned', 'canvas', 'links'];
}

/** Sections hold channels only; DMs and group chats live on their own tab. */
export function canPickSection(scopeType: string | null | undefined, isMember: boolean): boolean {
  return isMember && scopeType === ChannelScopeType.DEFAULT;
}

/** The section's name, or "None" when the channel sits in no section. */
export function sectionLabel(
  sections: readonly { id: string; name: string }[],
  sectionId: string | null | undefined,
): string {
  if (!sectionId) return 'None';
  return sections.find(section => section.id === sectionId)?.name ?? 'None';
}

/**
 * Muted means neither the desktop nor the phone delivers anything: both of
 * the Settings screen's switches off.
 */
export function isChannelMuted(
  stored: {
    desktopNotificationLevel?: string | null;
    mobileNotificationLevel?: string | null;
  } | null,
): boolean {
  return (
    stored?.desktopNotificationLevel === NotificationLevel.NONE &&
    stored?.mobileNotificationLevel === NotificationLevel.NONE
  );
}
