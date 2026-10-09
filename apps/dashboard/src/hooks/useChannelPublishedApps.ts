import { useMemo } from 'react';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';

const EMPTY: readonly string[] = [];

/**
 * The app ids published to a channel, DM, group DM or desk, in display order
 * (channel_published_tabs, synced by Zero — so a publish or unpublish anywhere
 * reaches every open view on its own).
 *
 * The returned array keeps its identity until the ids themselves change, so it
 * is safe in memo/effect dependencies: Zero hands back fresh row objects on
 * unrelated updates, and every channel tab memo would otherwise rerun.
 */
export const useChannelPublishedApps = (
  channelId: string | null | undefined,
): readonly string[] => {
  const [rows] = useCachedQuery(queries.channelPublishedApps({ channelId: channelId ?? '' }), {
    enabled: !!channelId,
  });
  const key = (rows ?? []).map(row => row.entityId).join('\n');
  return useMemo(() => (key ? key.split('\n') : EMPTY), [key]);
};
