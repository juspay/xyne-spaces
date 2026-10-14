import type { DeskListItemData } from '../types';
import { mapDeskListItem } from './map-desk-list-item';

export type DeskChannelLike = {
  id: string;
  name?: string | null;
  type?: string | null;
  description?: string | null | undefined;
};

/** Pure map — joined = presence of channel_user_status (dashboard parity). */
export function mapEmailChannelsToListItems(
  channels: readonly DeskChannelLike[] | null | undefined,
  joinedChannelIds: ReadonlySet<string>,
): DeskListItemData[] {
  const items: DeskListItemData[] = [];

  for (const channel of channels ?? []) {
    if (!channel.id) continue;
    items.push(
      mapDeskListItem({
        id: channel.id,
        name: channel.name ?? '',
        type: channel.type ?? '',
        description: channel.description,
        isJoined: joinedChannelIds.has(channel.id),
      }),
    );
  }

  // Stable: joined first, then name (useEmailChannels already sorts by name).
  items.sort((a, b) => {
    if (a.isJoined !== b.isJoined) return a.isJoined ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return items;
}
