/**
 * Where a related item lives, as people read it: `#channel` for a channel, and for a
 * DM or group DM the other people in it by display name — the way the sidebar names
 * them — rather than the search index's comma-joined usernames.
 */
import { useMemo } from 'react';

import { useChannel } from '../../../hooks/useChannels';
import { useUsersById } from '../../../hooks/useUsers';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { parseDMParticipantIds } from '../ChatDirectory/ChatDirectory.utils';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import type { RelatedItem } from '../../../types/search';
import { channelOf, plain, whereOf } from './relatedContextDisplay';

/** Two names at most, then how many more: "Arjun Rao, Mei Tanaka +3". */
export const peopleLabel = (names: string[], total: number): string => {
  const shown = names.slice(0, 2);
  // Everyone not named, including anyone whose name hasn't synced yet.
  const hidden = total - shown.length;
  return hidden > 0 ? `${shown.join(', ')} +${hidden}` : shown.join(', ');
};

const isDmScope = (scopeType: string | undefined): boolean =>
  scopeType === 'DM' || scopeType === 'GROUP_DM';

/** The channel an item lives in: `#name`, or the other people in a DM. */
export function useChannelLabel(item: RelatedItem): string {
  const context = item.result.searchContext;
  const isDm = isDmScope(context?.scopeType);
  const channel = useChannel(isDm ? (context?.channelId ?? '') : '');
  const usersById = useUsersById();
  const { userID } = useAuthContextValues();

  return useMemo(() => {
    if (!isDm) {
      return channelOf(item);
    }
    const ids = channel ? parseDMParticipantIds(channel) : [];
    const others = ids.filter(id => id !== userID);
    if (ids.length > 0 && others.length === 0) {
      return 'You';
    }
    const names = others
      .map(id => usersById.get(id))
      .filter((user): user is NonNullable<typeof user> => Boolean(user))
      .map(user => getUserDisplayName(user));
    if (names.length > 0) {
      return peopleLabel(names, others.length);
    }
    // Not synced yet: fall back to the names the search index stored, still capped.
    const me = usersById.get(userID);
    const mine = new Set([me?.name, me && getUserDisplayName(me)].filter(Boolean));
    const fromIndex = plain(context?.channelTitle ?? item.result.metadata.channelName)
      .split(',')
      .map(name => name.trim())
      .filter(name => name && !mine.has(name));
    return peopleLabel(fromIndex, fromIndex.length);
  }, [isDm, channel, usersById, userID, item, context?.channelTitle]);
}

/** `whereOf`, with DMs named by their people. */
export function useWhereOf(item: RelatedItem): string {
  const channelLabel = useChannelLabel(item);
  return item.kind === 'thread' ? channelLabel : whereOf(item);
}
