import { getBoolean, setBoolean } from './localStorage';

/**
 * The two groups the channels list always shows but the user never creates:
 * starred channels, and everything that is not in a custom section.
 *
 * A custom section persists `isCollapsed` on its own row, so these two are the
 * only groups that need a local preference.
 */
export type ChannelBuiltInGroup = 'starred' | 'channels';

const KEY_BY_GROUP: Record<ChannelBuiltInGroup, string> = {
  starred: 'lotus.channels.group.starred.collapsed',
  channels: 'lotus.channels.group.channels.collapsed',
};

export function readGroupCollapsed(group: ChannelBuiltInGroup): boolean {
  return getBoolean(KEY_BY_GROUP[group]) ?? false;
}

export function writeGroupCollapsed(group: ChannelBuiltInGroup, value: boolean): void {
  setBoolean(KEY_BY_GROUP[group], value);
}
