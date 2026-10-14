/**
 * Maps call hits to `CallLogItem` rows outside the request, so a user or channel that
 * syncs late relabels rows already on screen without another search.
 */

import { useMemo } from 'react';
import { useSelector } from '@xstate/react';

import { useAuth } from '@/src/contexts/AuthContext';
import { stateMachineActor } from '@/src/machines/appStateMachine';
import type { DisplaySearchResult } from '@/src/types/search';
import {
  buildCallChannelsById,
  EMPTY_CALL_CHANNELS,
  EMPTY_CALL_USERS,
  type CallChannelLike,
  type CallUserLike,
} from '@/src/utils/callDisplayData';
import {
  mapVespaCallResultsToDisplay,
  type CallSearchResultItem,
} from '../utils/map-vespa-call-result';

function selectUsers(state: { context: { users: unknown[] } }): readonly CallUserLike[] {
  return (state.context.users as CallUserLike[] | undefined) ?? EMPTY_CALL_USERS;
}

function selectAllChannels(state: {
  context: { allChannels: unknown[] };
}): readonly CallChannelLike[] {
  return (state.context.allChannels as CallChannelLike[] | undefined) ?? EMPTY_CALL_CHANNELS;
}

export function useCallResults(raw: readonly DisplaySearchResult[]): CallSearchResultItem[] {
  const { user } = useAuth();
  const currentUserId = user?.user_id ?? '';

  const users = useSelector(stateMachineActor, selectUsers);
  const channels = useSelector(stateMachineActor, selectAllChannels);

  const channelsById = useMemo(() => buildCallChannelsById(channels), [channels]);

  return useMemo(
    () =>
      mapVespaCallResultsToDisplay(
        raw as DisplaySearchResult[],
        currentUserId,
        users,
        channelsById,
      ),
    [channelsById, currentUserId, raw, users],
  );
}
