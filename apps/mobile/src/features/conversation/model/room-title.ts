import { ChannelScopeType } from '@xyne/shared';

export type RoomKind = 'channel' | 'dm' | 'group';

export function roomKindOf(scopeType: string | null | undefined): RoomKind {
  if (scopeType === ChannelScopeType.DM) return 'dm';
  if (scopeType === ChannelScopeType.GROUP_DM) return 'group';
  return 'channel';
}

/**
 * A channel reads "#name", or just "name" when it is private (its lock stands
 * in for the "#"); people and group chats read as their own name.
 */
export function roomTitle(name: string, kind: RoomKind, isPrivate = false): string {
  return kind === 'channel' && !isPrivate ? `#${name}` : name;
}

/** Whether a DM's members (its comma-separated name) are only the current user. */
export function isSelfDmName(channelName: string | null | undefined, userId: string): boolean {
  if (!channelName || !userId) return false;
  const members = channelName
    .split(',')
    .map(member => member.trim())
    .filter(Boolean);
  return members.length === 1 && members[0] === userId;
}

/**
 * The typing bar's placeholder: "Message #channel", "Message Priya" (first
 * name), the group's name, or a note to self in your own DM.
 */
export function composerPlaceholder(
  name: string,
  kind: RoomKind,
  options: { isPrivate?: boolean; isSelfDm?: boolean } = {},
): string {
  if (kind === 'dm' && options.isSelfDm) return 'Jot something down';
  const target =
    kind === 'dm' ? (name.trim().split(/\s+/)[0] ?? '') : roomTitle(name, kind, options.isPrivate);
  return `Message ${target}`;
}
