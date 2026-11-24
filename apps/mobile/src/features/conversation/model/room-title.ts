import { ChannelScopeType } from '@xyne/shared';

export type RoomKind = 'channel' | 'dm' | 'group';

export function roomKindOf(scopeType: string | null | undefined): RoomKind {
  if (scopeType === ChannelScopeType.DM) return 'dm';
  if (scopeType === ChannelScopeType.GROUP_DM) return 'group';
  return 'channel';
}

/** A channel reads "#name"; people and group chats read as their own name. */
export function roomTitle(name: string, kind: RoomKind): string {
  return kind === 'channel' ? `#${name}` : name;
}

/** The typing bar's placeholder: "Message #channel", "Message Priya" (first name) or the group's name. */
export function composerPlaceholder(name: string, kind: RoomKind): string {
  const target = kind === 'dm' ? (name.trim().split(/\s+/)[0] ?? '') : roomTitle(name, kind);
  return `Message ${target}`;
}
