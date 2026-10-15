import { useMemo, type ReactElement, type ReactNode } from 'react';

import { useAllChannels } from '@/src/hooks/useChannels';
import { useUserGroups } from '@/src/hooks/useUserGroups';
import { useUsers } from '@/src/hooks/useUsers';
import { FlowNormalizationOptionsContext } from '@/src/contexts/FlowNormalizationOptionsContext';
import {
  getCachedChannelNames,
  getCachedGroupNames,
  getCachedUserNames,
} from '@/src/utils/flowNormalizationOptions';
import type { FlowTextNormalizationOptions } from '@/src/utils/flowJsonMarkdown';

/**
 * Computes shared identity maps at the app boundary. Chat/thread message rows must
 * read this via context — calling `useUsers` / `useUserGroups` per bubble
 * re-renders every row on directory updates and was part of the Android OOM.
 */
export const FlowNormalizationOptionsProvider = ({
  children,
}: {
  children: ReactNode;
}): ReactElement => {
  const users = useUsers();
  const channels = useAllChannels();
  const groups = useUserGroups();
  const value = useMemo<FlowTextNormalizationOptions>(
    () => ({
      userNames: getCachedUserNames(users),
      channelNames: getCachedChannelNames(channels),
      groupNames: getCachedGroupNames(groups),
    }),
    [users, channels, groups],
  );

  return (
    <FlowNormalizationOptionsContext.Provider value={value}>
      {children}
    </FlowNormalizationOptionsContext.Provider>
  );
};
