import { useEffect, useMemo, useRef } from 'react';

import { useAuth } from '@/src/contexts/AuthContext';
import { useEmailChannels, useUserChannelStatuses } from '@/src/hooks/useChannels';
import { useFallbackHydratedQuery } from '@/src/hooks/useFallbackHydratedQuery';
import { withFallbackHydratedQueryArgs } from '@/src/hooks/with-fallback-hydrated-query-args';
import { stateMachineActor } from '@/src/machines/appStateMachine';
import { filterAllChannelsForWorkspace } from '@/src/providers/initialStateLoaderUtils';
import { queries } from '@/src/zero/queries';

import { getDesksPaintCache, setDesksPaintCache } from '../utils';
import type { DeskListItemData } from '../types';
import { mapEmailChannelsToListItems } from '../utils';

export type UseDesksListDataReturn = {
  items: DeskListItemData[];
  isEmpty: boolean;
};

/**
 * Desk channels list — local-first / optimistic:
 * - useEmailChannels: joined desks (Zero) + public not-joined desks (allChannels)
 * - useUserChannelStatuses: membership from state machine
 * - paint cache: warm process reopen without empty flash
 *
 * Mobile startup only hydrates joined `userVisibleChannelsV2`, so `allChannels`
 * stays empty until something loads `userAllChannels` (search or this screen).
 * Without that catalog, not-joined public desks never appear.
 */
export function useDesksListData(): UseDesksListDataReturn {
  const { workspaceSessionKey: sessionKey, user } = useAuth();
  const workspaceId = user?.workspaceId;

  // Materialize ACL-visible channels into Zero SQLite (join mutators need the row)
  // and feed the state-machine catalog that useEmailChannels merges for not-joined.
  const channelsQuery = useMemo(() => withFallbackHydratedQueryArgs(queries.userAllChannels()), []);
  const [allChannelRows, channelsDetails] = useFallbackHydratedQuery(channelsQuery, {
    enabled: true,
  });

  useEffect(() => {
    if (!workspaceId || channelsDetails.type !== 'complete') return;

    const workspaceChannels = filterAllChannelsForWorkspace(allChannelRows, workspaceId);
    stateMachineActor.send({
      type: 'ADD_ALL_CHANNELS',
      channels: workspaceChannels,
    });
  }, [allChannelRows, channelsDetails.type, workspaceId]);

  const emailChannels = useEmailChannels();
  const userChannelStatuses = useUserChannelStatuses();

  const joinedChannelIds = useMemo(() => {
    const ids = new Set<string>();
    for (const status of userChannelStatuses) {
      ids.add(status.channelId);
    }
    return ids;
  }, [userChannelStatuses]);

  const paintSeed = useMemo(() => getDesksPaintCache(sessionKey), [sessionKey]);
  const lastGoodRef = useRef<DeskListItemData[]>(paintSeed);

  const liveItems = useMemo(
    () => mapEmailChannelsToListItems(emailChannels, joinedChannelIds),
    [emailChannels, joinedChannelIds],
  );

  useEffect(() => {
    if (liveItems.length === 0) return;
    lastGoodRef.current = liveItems;
    setDesksPaintCache(sessionKey, liveItems);
  }, [liveItems, sessionKey]);

  // Optimistic: keep last good / paint while Zero/SM still settling to empty.
  const awaitingLocal =
    liveItems.length === 0 && lastGoodRef.current.length === 0 && paintSeed.length > 0;
  const fallback = lastGoodRef.current.length > 0 ? lastGoodRef.current : paintSeed;

  const items =
    liveItems.length > 0 ? liveItems : awaitingLocal || fallback.length > 0 ? fallback : liveItems;

  // Prefer live empty once we have a confirmed empty emailChannels array and no statuses race.
  // useEmailChannels returns [] both while loading and when truly empty; paint cache covers warm path.
  const isEmpty = items.length === 0;

  return { items, isEmpty };
}
