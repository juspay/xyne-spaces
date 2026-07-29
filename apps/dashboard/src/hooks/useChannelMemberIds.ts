import { useMemo } from 'react';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';

/**
 * Participant user IDs for a channel, for ranking/gating assignee lists.
 *
 * Returns an empty set with `loaded: false` when no channelId is given or the
 * participants haven't loaded yet, so callers can treat "no data" as
 * "don't reorder". Mirrors the participant lookup in useChannelAssignGate.
 */
export function useChannelMemberIds(channelId: string | undefined): {
  memberIds: Set<string>;
  loaded: boolean;
} {
  const [participants] = useCachedQuery(
    queries.channelParticipants({ channelId: channelId || '' }),
    { enabled: !!channelId },
  );
  const memberIds = useMemo(() => new Set((participants ?? []).map(p => p.userId)), [participants]);
  return { memberIds, loaded: participants !== undefined };
}
