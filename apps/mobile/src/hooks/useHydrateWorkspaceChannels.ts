import { useEffect, useMemo } from 'react';

import { useAuth } from '@/src/contexts/AuthContext';
import { stateMachineActor } from '@/src/machines/appStateMachine';
import { filterAllChannelsForWorkspace } from '@/src/providers/initialStateLoaderUtils';
import { queries } from '@/src/zero/queries';

import { useFallbackHydratedQuery } from './useFallbackHydratedQuery';
import { withFallbackHydratedQueryArgs } from './with-fallback-hydrated-query-args';

/**
 * Startup only syncs channels the user has joined. Public channels they have
 * not followed, including Xyne Desk channels, live in `userAllChannels`.
 */
export function useHydrateWorkspaceChannels(): void {
  const { user } = useAuth();
  const workspaceId = user?.workspaceId;

  const channelsQuery = useMemo(() => withFallbackHydratedQueryArgs(queries.userAllChannels()), []);
  const [allChannelRows, channelsDetails] = useFallbackHydratedQuery(channelsQuery, {
    enabled: true,
  });

  useEffect(() => {
    if (!workspaceId || channelsDetails.type !== 'complete') return;

    stateMachineActor.send({
      type: 'ADD_ALL_CHANNELS',
      channels: filterAllChannelsForWorkspace(allChannelRows, workspaceId),
    });
  }, [allChannelRows, channelsDetails.type, workspaceId]);
}
